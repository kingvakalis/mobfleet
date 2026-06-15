-- ════════════════════════════════════════════════════════════════════════════
-- Server-side authorization guards for team_members / team_invites
-- ════════════════════════════════════════════════════════════════════════════
-- The base RLS only asks "are you an admin of this team?" (is_team_admin). That
-- is too coarse: the anti-escalation, last-owner, and owner-only-grants-owner
-- invariants lived ONLY in the React client (src/lib/authorization), so a
-- malicious member with the anon key + their JWT could call PostgREST directly to
-- self-promote to owner, demote/suspend/remove the last owner, grant themselves
-- permission overrides, or edit peer admins. Since the client cannot be trusted,
-- we mirror those invariants into the DB boundary the app relies on.
--
-- Enforcement is a BEFORE INSERT/UPDATE/DELETE TRIGGER (RLS WITH CHECK cannot
-- compare the actor's rank to the target row, nor diff OLD vs NEW). Trusted
-- definer paths (owner bootstrap, invite redemption) set a transaction-local flag
-- to bypass it, and service-role/SQL (auth.uid() IS NULL — migrations, seed,
-- admin tasks) bypasses it too.
-- ════════════════════════════════════════════════════════════════════════════

-- Authority rank by role, mirroring src/lib/authorization/roles.ts.
create or replace function public.role_rank(r public.team_role)
returns int
language sql immutable
as $$
  select case r
    when 'owner' then 100
    when 'admin' then 80
    when 'manager' then 60
    when 'operator' then 40
    when 'viewer' then 20
    else 0
  end;
$$;

-- Does the caller have ANY membership (regardless of status)? Used to distinguish
-- a genuine first-login (provision a team) from a suspended/removed member (must
-- NOT provision — otherwise suspension is escaped by auto-creating a new team).
-- SECURITY DEFINER so it sees rows that the suspended caller's own RLS hides.
create or replace function public.has_any_membership()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.team_members where user_id = auth.uid());
$$;
grant execute on function public.has_any_membership() to authenticated;

-- The guard. Raises on any end-user write that would violate an invariant.
create or replace function public.guard_team_member_write()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_actor public.team_role;
  v_actor_rank int;
  v_active_owners int;
begin
  -- Service role / SQL / seed (no end-user identity) is trusted.
  if auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- Trusted definer paths (handle_new_team, accept_invite) validate themselves.
  if coalesce(current_setting('mobfleet.skip_member_guard', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- Caller's authority in the affected team (NULL if not an ACTIVE member).
  v_actor := public.team_role_of(coalesce(old.team_id, new.team_id));
  if v_actor is null then
    raise exception 'not authorized to manage this team''s members' using errcode = 'P0001';
  end if;
  v_actor_rank := public.role_rank(v_actor);

  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id or new.team_id <> old.team_id then
      raise exception 'user_id and team_id are immutable' using errcode = 'P0001';
    end if;
    -- Non-owner may never modify an owner's row.
    if old.role = 'owner' and v_actor <> 'owner' then
      raise exception 'only an owner may modify an owner' using errcode = 'P0001';
    end if;
    -- Must strictly outrank the target (owners exempt — they may manage owners).
    if v_actor <> 'owner' and public.role_rank(old.role) >= v_actor_rank then
      raise exception 'cannot modify a member at or above your authority' using errcode = 'P0001';
    end if;
    if new.role <> old.role then
      if new.role = 'owner' and v_actor <> 'owner' then
        raise exception 'only an owner may grant the owner role' using errcode = 'P0001';
      end if;
      if v_actor <> 'owner' and public.role_rank(new.role) >= v_actor_rank then
        raise exception 'cannot assign a role at or above your authority' using errcode = 'P0001';
      end if;
    end if;
    -- No self-escalation.
    if new.user_id = auth.uid() and public.role_rank(new.role) > public.role_rank(old.role) then
      raise exception 'you cannot raise your own role' using errcode = 'P0001';
    end if;
    -- Last-owner protection: cannot demote or suspend the sole active owner.
    if old.role = 'owner' and (new.role <> 'owner' or new.status <> 'active') then
      select count(*) into v_active_owners
        from public.team_members where team_id = old.team_id and role = 'owner' and status = 'active';
      if v_active_owners <= 1 then
        raise exception 'the last owner cannot be demoted or suspended' using errcode = 'P0001';
      end if;
    end if;
    return new;

  elsif tg_op = 'DELETE' then
    if old.role = 'owner' and v_actor <> 'owner' then
      raise exception 'only an owner may remove an owner' using errcode = 'P0001';
    end if;
    if v_actor <> 'owner' and public.role_rank(old.role) >= v_actor_rank then
      raise exception 'cannot remove a member at or above your authority' using errcode = 'P0001';
    end if;
    if old.role = 'owner' then
      select count(*) into v_active_owners
        from public.team_members where team_id = old.team_id and role = 'owner' and status = 'active';
      if v_active_owners <= 1 then
        raise exception 'the last owner cannot be removed' using errcode = 'P0001';
      end if;
    end if;
    return old;

  else -- INSERT (direct admin add; the self-service paths bypass via the flag)
    if new.role = 'owner' and v_actor <> 'owner' then
      raise exception 'only an owner may grant the owner role' using errcode = 'P0001';
    end if;
    if v_actor <> 'owner' and public.role_rank(new.role) >= v_actor_rank then
      raise exception 'cannot assign a role at or above your authority' using errcode = 'P0001';
    end if;
    return new;
  end if;
end;
$$;

create trigger trg_guard_team_member_write
  before insert or update or delete on public.team_members
  for each row execute function public.guard_team_member_write();

-- Owner-bootstrap trigger: set the bypass flag so the auto-created owner row
-- passes the guard (the creating user isn't yet a member).
create or replace function public.handle_new_team()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_email text;
  v_name  text;
begin
  perform set_config('mobfleet.skip_member_guard', 'on', true);
  select u.email,
         coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', u.email)
    into v_email, v_name
  from auth.users u
  where u.id = new.owner_user_id;

  insert into public.team_members (team_id, user_id, role, status, email, name, scope_type, joined_at)
  values (new.id, new.owner_user_id, 'owner', 'active', v_email, v_name, 'workspace', now())
  on conflict (team_id, user_id) do nothing;
  return new;
end;
$$;

-- Invites cannot mint a role at/above the inviter's authority (owner-invites only
-- by owners) — mirrors assignableRoles() server-side.
drop policy if exists team_invites_insert on public.team_invites;
create policy team_invites_insert on public.team_invites
  for insert with check (
    public.is_team_admin(team_id)
    and invited_by = auth.uid()
    and (
      public.role_rank(role) < public.role_rank(public.team_role_of(team_id))
      or (role = 'owner' and public.team_role_of(team_id) = 'owner')
    )
  );

-- Harden accept_invite: bypass the guard for the self-insert, but DON'T silently
-- reactivate a suspended member or overwrite a deliberately-set role/scope on an
-- existing membership.
create or replace function public.accept_invite(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite     public.team_invites%rowtype;
  v_uid        uuid := auth.uid();
  v_email      text;
  v_confirmed  timestamptz;
  v_name       text;
  v_scope      text;
  v_team_name  text;
  v_existing   text;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = 'P0001';
  end if;

  select u.email, u.email_confirmed_at,
         coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', u.email)
    into v_email, v_confirmed, v_name
  from auth.users u
  where u.id = v_uid;

  if v_confirmed is null then
    raise exception 'confirm your email before accepting this invitation' using errcode = 'P0001';
  end if;

  select * into v_invite from public.team_invites where token = p_token for update;
  if not found then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;
  if v_invite.status <> 'pending' then
    raise exception 'invitation is no longer valid' using errcode = 'P0002';
  end if;
  if v_invite.expires_at <= now() then
    update public.team_invites set status = 'expired' where id = v_invite.id;
    raise exception 'invitation has expired' using errcode = 'P0002';
  end if;
  if lower(v_invite.email) <> lower(coalesce(v_email, '')) then
    raise exception 'this invitation was sent to a different email address' using errcode = 'P0003';
  end if;

  select status into v_existing from public.team_members
    where team_id = v_invite.team_id and user_id = v_uid;

  if found then
    -- Already a member: do NOT let invite acceptance resurrect a suspended account
    -- or silently change a configured role/scope.
    if v_existing = 'suspended' then
      raise exception 'your membership is suspended; ask an admin to reinstate you' using errcode = 'P0004';
    end if;
    -- Active member → idempotent accept (role/scope unchanged).
  else
    v_scope := case
      when v_invite.role in ('owner', 'admin') then 'workspace'
      when v_invite.role = 'operator' then 'assigned_phones'
      else 'assigned_groups'
    end;
    perform set_config('mobfleet.skip_member_guard', 'on', true);
    insert into public.team_members (team_id, user_id, role, status, email, name, invited_by, scope_type, joined_at)
    values (v_invite.team_id, v_uid, v_invite.role, 'active', v_email, v_name, v_invite.invited_by, v_scope, now());
  end if;

  update public.team_invites set status = 'accepted', accepted_at = now() where id = v_invite.id;
  select name into v_team_name from public.teams where id = v_invite.team_id;
  return json_build_object('team_id', v_invite.team_id, 'role', v_invite.role, 'team_name', v_team_name);
end;
$$;

grant execute on function public.accept_invite(text) to authenticated;

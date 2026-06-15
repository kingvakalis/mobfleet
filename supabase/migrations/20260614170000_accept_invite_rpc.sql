-- ════════════════════════════════════════════════════════════════════════════
-- accept_invite(token) — redeem a team invitation (SECURITY DEFINER)
-- ════════════════════════════════════════════════════════════════════════════
-- The member-insert RLS policy forbids a user inserting their OWN membership (an
-- invitee isn't an admin yet), so acceptance MUST go through this definer-rights
-- function. It validates the token, requires the caller's email to match the
-- invite and be confirmed, inserts the membership (with the role's default
-- scope), and marks the invite accepted. Idempotent: re-accepting just refreshes
-- the existing membership. Raises on bad/expired token or email mismatch.
-- ════════════════════════════════════════════════════════════════════════════

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
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = 'P0001';
  end if;

  -- Resolve the caller's identity from the auth schema (definer rights).
  select u.email, u.email_confirmed_at,
         coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', u.email)
    into v_email, v_confirmed, v_name
  from auth.users u
  where u.id = v_uid;

  if v_confirmed is null then
    raise exception 'confirm your email before accepting this invitation' using errcode = 'P0001';
  end if;

  -- Look up + lock the invite row.
  select * into v_invite
  from public.team_invites
  where token = p_token
  for update;

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
  -- The invite is addressed to a specific email — the redeemer must be that user.
  if lower(v_invite.email) <> lower(coalesce(v_email, '')) then
    raise exception 'this invitation was sent to a different email address' using errcode = 'P0003';
  end if;

  -- Default access scope mirrors the app's role→scope convention.
  v_scope := case
    when v_invite.role in ('owner', 'admin') then 'workspace'
    when v_invite.role = 'operator' then 'assigned_phones'
    else 'assigned_groups'
  end;

  insert into public.team_members (team_id, user_id, role, status, email, name, invited_by, scope_type, joined_at)
  values (v_invite.team_id, v_uid, v_invite.role, 'active', v_email, v_name, v_invite.invited_by, v_scope, now())
  on conflict (team_id, user_id) do update
    set role = excluded.role, status = 'active', email = excluded.email, name = coalesce(public.team_members.name, excluded.name);

  update public.team_invites
    set status = 'accepted', accepted_at = now()
  where id = v_invite.id;

  select name into v_team_name from public.teams where id = v_invite.team_id;

  return json_build_object('team_id', v_invite.team_id, 'role', v_invite.role, 'team_name', v_team_name);
end;
$$;

grant execute on function public.accept_invite(text) to authenticated;

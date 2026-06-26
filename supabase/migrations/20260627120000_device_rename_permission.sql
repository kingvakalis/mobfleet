-- ════════════════════════════════════════════════════════════════════════════
-- Device rename + the `phones.rename` permission (RBAC), enforced server-side.
-- ════════════════════════════════════════════════════════════════════════════
-- Product rule: Owner/Admin may rename any phone by default; other members
-- (manager/operator/viewer) may rename ONLY if granted the `phones.rename`
-- permission. Grants are the EXISTING per-member override mechanism already
-- persisted in team_members.overrides (jsonb of permission_key -> 'allow'|'deny',
-- edited by the Team → Access UI via setMemberOverrides). Explicit 'deny' always
-- wins; suspended members get nothing — mirroring the client effective-access
-- engine (lib/authorization/effective-access.ts) so the UI and the server agree.
--
-- Enforcement is independent of HOW the update arrives:
--   • rename_device() RPC  — the clean, typed entry the UI calls.
--   • a BEFORE UPDATE trigger on devices that blocks ANY name change lacking the
--     permission — so the existing devices_update RLS (can_write_team, which also
--     lets operators write) can't be used to sneak a rename past the check.
--
-- No service-role secret is used; everything runs under the caller's JWT
-- (auth.uid()). SECURITY DEFINER is used only so the team_members lookup isn't
-- blocked by team_members' own RLS — same pattern as is_team_member/team_role_of.
-- Idempotent (create or replace / drop trigger if exists) — safe to re-run.

-- ── Permission predicate ─────────────────────────────────────────────────────
-- Rename is a TEAM-LEVEL permission (not per-phone scoped) — same granularity as
-- the existing devices_update RLS (can_write_team) and devices_delete (is_team_admin);
-- the UI gates rename on can(member,'phones.rename') to match this exactly.
-- True when the caller may rename devices in the team: an ACTIVE member who is
-- owner/admin OR has an explicit `phones.rename` = 'allow' override, and is NOT
-- explicitly denied. auth.uid() IS NULL → service-role / SQL (migrations, seed)
-- bypass, consistent with the other helper functions in this schema.
create or replace function public.can_rename_device(p_team_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select tm.status = 'active'
       and coalesce(tm.overrides ->> 'phones.rename', '') <> 'deny'
       and (tm.role in ('owner', 'admin') or tm.overrides ->> 'phones.rename' = 'allow')
    from public.team_members tm
    where tm.team_id = p_team_id and tm.user_id = auth.uid()
    limit 1
  ), false)
  or auth.uid() is null;
$$;

-- ── Validation + permission trigger (the real guard, covers every write path) ──
create or replace function public.enforce_device_rename()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Only engage when the display name actually changes; status/group/heartbeat
  -- updates (including the device agent's) pass through untouched.
  if new.name is distinct from old.name then
    if not public.can_rename_device(new.team_id) then
      raise exception 'permission denied: the phones.rename permission is required to rename a device'
        using errcode = '42501';
    end if;
    -- Validate USER-driven renames only. Service / agent paths run with auth.uid()
    -- IS NULL (e.g. claim_device re-pair upserts the name) and are trusted — they
    -- preserved their own behaviour before this trigger, so the length/empty checks
    -- must not retroactively reject a re-pair. The permission check above already
    -- bypasses for auth.uid() IS NULL via can_rename_device.
    if auth.uid() is not null then
      new.name := btrim(coalesce(new.name, ''));
      if char_length(new.name) = 0 then
        raise exception 'device name cannot be empty' using errcode = '23514';
      end if;
      if char_length(new.name) > 64 then
        raise exception 'device name is too long (maximum 64 characters)' using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_device_rename on public.devices;
create trigger trg_enforce_device_rename
  before update on public.devices
  for each row execute function public.enforce_device_rename();

-- ── Typed RPC the UI calls ───────────────────────────────────────────────────
-- Resolves the device's team, hides cross-team / unknown devices behind a single
-- "not found" (no existence probing), then performs the update — the trigger above
-- enforces the rename permission and validates the name, so its exception surfaces
-- here as a clean error. Returns the updated row for an optimistic UI update
-- (Realtime also broadcasts the change to every subscribed surface).
create or replace function public.rename_device(p_device_id uuid, p_name text)
returns public.devices
language plpgsql security definer set search_path = public
as $$
declare
  v_team uuid;
  v_row  public.devices;
begin
  select team_id into v_team from public.devices where id = p_device_id;
  if v_team is null or not public.is_team_member(v_team) then
    raise exception 'device not found' using errcode = 'P0002';
  end if;

  update public.devices set name = p_name where id = p_device_id returning * into v_row;
  return v_row;
end;
$$;

-- ── Grants — RLS / the trigger decide permission; these grant EXECUTE only. ───
grant execute on function public.can_rename_device(uuid) to authenticated;
grant execute on function public.rename_device(uuid, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- Member suspension (Supabase plane)
-- ════════════════════════════════════════════════════════════════════════════
-- A suspended team member must lose ALL access immediately — not just have
-- buttons hidden. We add a status column to team_members and rewire the
-- SECURITY DEFINER membership helpers so a non-active row is treated as if the
-- membership did not exist. Because every RLS policy is expressed in terms of
-- is_team_member() / team_role_of() (and can_write_team()/is_team_admin() derive
-- from team_role_of), excluding suspended rows here cascades to SELECT, INSERT,
-- UPDATE, and DELETE on teams, team_members, devices, and automation_jobs.
--
-- Suspension is reversible (set status back to 'active') and preserves the row
-- for history/audit.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.team_members
  add column if not exists status text not null default 'active';

alter table public.team_members
  drop constraint if exists team_members_status_check;
alter table public.team_members
  add constraint team_members_status_check check (status in ('active', 'suspended'));

-- A member is "in" the team only while ACTIVE. A suspended member fails this,
-- so they can no longer even SELECT their team's rows.
create or replace function public.is_team_member(p_team_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = auth.uid() and status = 'active'
  );
$$;

-- Role resolves to NULL for a suspended member, so can_write_team() and
-- is_team_admin() (which test team_role_of() against a set) both deny.
create or replace function public.team_role_of(p_team_id uuid)
returns public.team_role
language sql stable security definer set search_path = public
as $$
  select role from public.team_members
  where team_id = p_team_id and user_id = auth.uid() and status = 'active'
$$;

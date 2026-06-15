-- ════════════════════════════════════════════════════════════════════════════
-- Multi-tenant phone farm — initial schema (Supabase / Postgres + RLS)
-- ════════════════════════════════════════════════════════════════════════════
-- Tenancy model: every row carries team_id. Row-Level Security restricts every
-- row to members of that team (auth.uid() ∈ team_members), so the DATABASE
-- enforces isolation — the client may talk to Supabase (PostgREST) directly and
-- still never see another team's data. UUID primary keys; foreign keys with
-- cascade; indexes on team_id and (team_id, status).
--
-- Apply with:  supabase db reset   (local, also runs supabase/seed.sql)
--          or  supabase db push    (remote)
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto; -- gen_random_uuid(), crypt() (seed)

-- ── Enums ────────────────────────────────────────────────────────────────────
-- Idempotent: Postgres has no `create type if not exists`, so guard each with a
-- duplicate_object catch. This tolerates enum types left behind by a prior
-- partial/manual apply (the remote can have the types without the tables) while
-- staying correct on a truly fresh database. NOTE: tables below are deliberately
-- NOT guarded — a pre-existing table should fail loudly (it implies real schema).
do $$ begin
  create type public.team_role as enum ('owner', 'admin', 'operator', 'viewer');
exception when duplicate_object then null;
end $$;
do $$ begin
  create type public.device_status as enum ('online', 'offline', 'error', 'busy', 'warming');
exception when duplicate_object then null;
end $$;
-- automation_jobs.status wasn't given an explicit enum in the spec; a small,
-- closed set keeps job state honest and indexable. Adjust as the runner evolves.
do $$ begin
  create type public.job_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');
exception when duplicate_object then null;
end $$;

-- ── teams ────────────────────────────────────────────────────────────────────
create table public.teams (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  owner_user_id uuid not null references auth.users (id) on delete restrict,
  created_at    timestamptz not null default now()
);

-- ── team_members ───────────────────────────────────────────────────────────--
create table public.team_members (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.team_role not null default 'viewer',
  invited_at timestamptz,
  joined_at  timestamptz,
  -- a user belongs to a given team at most once
  unique (team_id, user_id)
);

-- ── devices ──────────────────────────────────────────────────────────────────
create table public.devices (
  id             uuid primary key default gen_random_uuid(),
  team_id        uuid not null references public.teams (id) on delete cascade,
  name           text not null,
  udid           text,
  platform       text not null default 'ios',
  os_version     text,
  status         public.device_status not null default 'offline',
  ip_address     inet,
  wda_port       integer,
  last_heartbeat timestamptz,
  created_at     timestamptz not null default now(),
  -- a UDID is unique within a team (different teams may register the same hw)
  unique (team_id, udid)
);

-- ── automation_jobs ──────────────────────────────────────────────────────────
create table public.automation_jobs (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  device_id   uuid references public.devices (id) on delete set null,
  type        text not null,
  status      public.job_status not null default 'queued',
  config      jsonb not null default '{}'::jsonb,
  started_at  timestamptz,
  finished_at timestamptz,
  error       text,
  created_at  timestamptz not null default now()
);

-- ── Indexes (team_id + status, plus the FK/lookup columns RLS leans on) ──────--
create index idx_team_members_team   on public.team_members (team_id);
create index idx_team_members_user   on public.team_members (user_id);
-- UNIQUE: at most one auto-provisioned team per owner. This is the deterministic
-- backstop for the first-login provisioning race — a second concurrent INSERT
-- (StrictMode double-invoke / remount) fails with 23505, which useTeam treats as
-- "already provisioned" and re-reads, instead of creating a duplicate workspace.
-- (A unique index also serves the owner_user_id FK lookup, so no separate index.)
create unique index uniq_team_owner  on public.teams (owner_user_id);
create index idx_devices_team        on public.devices (team_id);
create index idx_devices_team_status on public.devices (team_id, status);
create index idx_jobs_team           on public.automation_jobs (team_id);
create index idx_jobs_team_status    on public.automation_jobs (team_id, status);
create index idx_jobs_device         on public.automation_jobs (device_id);

-- ════════════════════════════════════════════════════════════════════════════
-- Membership helpers (SECURITY DEFINER)
-- ════════════════════════════════════════════════════════════════════════════
-- These run as the function owner and therefore BYPASS RLS, which is what lets
-- a policy on team_members ask "is the caller a member?" without recursing into
-- its own RLS. `stable` + indexed lookups keep them cheap.

create or replace function public.is_team_member(p_team_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = auth.uid()
  );
$$;

create or replace function public.team_role_of(p_team_id uuid)
returns public.team_role
language sql stable security definer set search_path = public
as $$
  select role from public.team_members
  where team_id = p_team_id and user_id = auth.uid()
$$;

-- True when the caller can WRITE fleet data for the team (any non-viewer).
create or replace function public.can_write_team(p_team_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.team_role_of(p_team_id) in ('owner', 'admin', 'operator');
$$;

-- True when the caller administers the team (owner or admin).
create or replace function public.is_team_admin(p_team_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.team_role_of(p_team_id) in ('owner', 'admin');
$$;

-- New team → its creator becomes the first OWNER member automatically (bypasses
-- RLS via SECURITY DEFINER, so the bootstrap can't be blocked by the member
-- policies it later relies on).
create or replace function public.handle_new_team()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.team_members (team_id, user_id, role, joined_at)
  values (new.id, new.owner_user_id, 'owner', now())
  on conflict (team_id, user_id) do nothing;
  return new;
end;
$$;

create trigger trg_team_created
  after insert on public.teams
  for each row execute function public.handle_new_team();

-- ════════════════════════════════════════════════════════════════════════════
-- Row-Level Security
-- ════════════════════════════════════════════════════════════════════════════
alter table public.teams           enable row level security;
alter table public.team_members    enable row level security;
alter table public.devices         enable row level security;
alter table public.automation_jobs enable row level security;

-- ── teams ──────────────────────────────────────────────────────────────────--
create policy teams_select on public.teams
  for select using (public.is_team_member(id));
-- You may create a team only with yourself as owner; the trigger then makes you
-- its first owner-member.
create policy teams_insert on public.teams
  for insert with check (owner_user_id = auth.uid());
create policy teams_update on public.teams
  for update using (public.is_team_admin(id)) with check (public.is_team_admin(id));
-- Only the owner can delete the whole workspace.
create policy teams_delete on public.teams
  for delete using (owner_user_id = auth.uid());

-- ── team_members ─────────────────────────────────────────────────────────────
-- Members see their co-members; admins/owner manage the roster. (Self-service
-- invite acceptance — a user adding their OWN row — should go through a
-- SECURITY DEFINER RPC or the server, since an invitee isn't yet an admin.)
create policy team_members_select on public.team_members
  for select using (public.is_team_member(team_id));
create policy team_members_insert on public.team_members
  for insert with check (public.is_team_admin(team_id));
create policy team_members_update on public.team_members
  for update using (public.is_team_admin(team_id)) with check (public.is_team_admin(team_id));
create policy team_members_delete on public.team_members
  for delete using (public.is_team_admin(team_id));

-- ── devices ──────────────────────────────────────────────────────────────────
create policy devices_select on public.devices
  for select using (public.is_team_member(team_id));
create policy devices_insert on public.devices
  for insert with check (public.can_write_team(team_id));
create policy devices_update on public.devices
  for update using (public.can_write_team(team_id)) with check (public.can_write_team(team_id));
-- Retiring hardware is an admin action.
create policy devices_delete on public.devices
  for delete using (public.is_team_admin(team_id));

-- ── automation_jobs ──────────────────────────────────────────────────────────
create policy jobs_select on public.automation_jobs
  for select using (public.is_team_member(team_id));
create policy jobs_insert on public.automation_jobs
  for insert with check (public.can_write_team(team_id));
create policy jobs_update on public.automation_jobs
  for update using (public.can_write_team(team_id)) with check (public.can_write_team(team_id));
create policy jobs_delete on public.automation_jobs
  for delete using (public.can_write_team(team_id));

-- ════════════════════════════════════════════════════════════════════════════
-- Grants — RLS decides ROWS; these grant the authenticated role TABLE access.
-- `anon` (unauthenticated) gets nothing, so every row requires a logged-in user.
-- ════════════════════════════════════════════════════════════════════════════
grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.teams, public.team_members, public.devices, public.automation_jobs
  to authenticated;
grant execute on function
  public.is_team_member(uuid), public.team_role_of(uuid),
  public.can_write_team(uuid), public.is_team_admin(uuid)
  to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- Realtime — stream row changes for live dashboards. RLS still applies, so a
-- subscriber only receives changes for rows they're allowed to read.
-- ════════════════════════════════════════════════════════════════════════════
alter publication supabase_realtime add table public.devices;
alter publication supabase_realtime add table public.automation_jobs;

-- Real Supabase-backed surfaces for Fleet groups, Activity, Automations, and
-- metadata-only account records. Additive and RLS-scoped; no plaintext secrets.

create extension if not exists pgcrypto;

-- Fleet grouping. The existing devices table remains canonical for phones.
alter table public.devices
  add column if not exists group_name text not null default 'Unassigned';

create table if not exists public.device_groups (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  color text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, name)
);

create index if not exists idx_device_groups_team on public.device_groups(team_id);

-- Real operational/security event feed.
create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  category text not null default 'operational'
    check (category in ('operational', 'security')),
  action text not null,
  target_id text,
  target_label text,
  result text not null default 'success'
    check (result in ('success', 'denied', 'error', 'info')),
  detail text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_activity_events_team_created on public.activity_events(team_id, created_at desc);
create index if not exists idx_activity_events_team_category on public.activity_events(team_id, category, created_at desc);

-- Saved automation definitions. Runs continue to use automation_jobs.
create table if not exists public.automations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null,
  description text not null default '',
  task_type text not null,
  steps jsonb not null default '[]'::jsonb,
  paused boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_automations_team on public.automations(team_id, created_at desc);

-- Metadata-only social account database. No passwords, recovery codes, cookies,
-- tokens, or plaintext credentials live here.
create table if not exists public.account_records (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  platform text not null check (platform in ('Instagram', 'TikTok')),
  handle text not null,
  username text not null default '',
  email text not null default '',
  status text not null default 'warming'
    check (status in ('active', 'flagged', 'banned', 'warming')),
  assigned_device_id uuid references public.devices(id) on delete set null,
  group_name text not null default 'Unassigned',
  owner_user_id uuid references auth.users(id) on delete set null,
  two_fa boolean not null default false,
  tags text[] not null default '{}'::text[],
  followers integer not null default 0 check (followers >= 0),
  notes text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_account_records_team on public.account_records(team_id, created_at desc);
create index if not exists idx_account_records_team_status on public.account_records(team_id, status);
-- Username is unique per team ONLY for non-blank usernames. The column defaults to ''
-- (metadata-only records may have no username), and a plain unique(team_id, username)
-- would reject a second blank-username record. A partial unique index enforces real
-- uniqueness without colliding on the '' default.
create unique index if not exists uq_account_records_team_username
  on public.account_records(team_id, username) where username <> '';

-- Shared updated_at helper.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_device_groups_touch on public.device_groups;
create trigger trg_device_groups_touch
  before update on public.device_groups
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_automations_touch on public.automations;
create trigger trg_automations_touch
  before update on public.automations
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_account_records_touch on public.account_records;
create trigger trg_account_records_touch
  before update on public.account_records
  for each row execute function public.touch_updated_at();

-- Client-callable event logger for UI actions that do not naturally have a DB
-- trigger. RLS still requires the caller to be a team member.
create or replace function public.log_activity_event(
  p_team_id uuid,
  p_action text,
  p_category text default 'operational',
  p_target_id text default null,
  p_target_label text default null,
  p_result text default 'success',
  p_detail text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_team_member(p_team_id) then
    raise exception 'not a member of team %', p_team_id using errcode = '42501';
  end if;

  insert into public.activity_events (
    team_id, actor_user_id, category, action, target_id, target_label, result, detail, metadata
  )
  values (
    p_team_id, auth.uid(), p_category, p_action, p_target_id, p_target_label, p_result, p_detail,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Trigger logger for important persisted actions.
create or replace function public.log_row_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_action text;
  v_label text;
  v_target text;
begin
  v_team_id := coalesce(new.team_id, old.team_id);

  if tg_table_name = 'devices' then
    v_action := case tg_op when 'INSERT' then 'device.paired' when 'UPDATE' then 'device.updated' else 'device.deleted' end;
    v_label := coalesce(new.name, old.name);
    v_target := coalesce(new.id::text, old.id::text);
  elsif tg_table_name = 'device_groups' then
    v_action := case tg_op when 'INSERT' then 'group.created' when 'UPDATE' then 'group.updated' else 'group.deleted' end;
    v_label := coalesce(new.name, old.name);
    v_target := coalesce(new.id::text, old.id::text);
  elsif tg_table_name = 'automations' then
    v_action := case tg_op when 'INSERT' then 'automation.created' when 'UPDATE' then 'automation.updated' else 'automation.deleted' end;
    v_label := coalesce(new.name, old.name);
    v_target := coalesce(new.id::text, old.id::text);
  elsif tg_table_name = 'automation_jobs' then
    v_action := case tg_op when 'INSERT' then 'automation.run.created' when 'UPDATE' then 'automation.run.updated' else 'automation.run.deleted' end;
    v_label := coalesce(new.type, old.type);
    v_target := coalesce(new.id::text, old.id::text);
  elsif tg_table_name = 'agent_commands' then
    v_action := case tg_op when 'INSERT' then 'device.command.queued' when 'UPDATE' then 'device.command.updated' else 'device.command.deleted' end;
    v_label := coalesce(new.action, old.action);
    v_target := coalesce(new.id::text, old.id::text);
  elsif tg_table_name = 'team_invites' then
    v_action := case tg_op when 'INSERT' then 'invite.created' when 'UPDATE' then 'invite.updated' else 'invite.deleted' end;
    v_label := coalesce(new.email, old.email);
    v_target := coalesce(new.id::text, old.id::text);
  elsif tg_table_name = 'team_members' then
    v_action := case tg_op when 'INSERT' then 'member.joined' when 'UPDATE' then 'member.updated' else 'member.removed' end;
    v_label := coalesce(new.email, old.email, new.user_id::text, old.user_id::text);
    v_target := coalesce(new.id::text, old.id::text);
  elsif tg_table_name = 'account_records' then
    v_action := case tg_op when 'INSERT' then 'account.created' when 'UPDATE' then 'account.updated' else 'account.deleted' end;
    v_label := coalesce(new.handle, old.handle);
    v_target := coalesce(new.id::text, old.id::text);
  else
    return coalesce(new, old);
  end if;

  insert into public.activity_events (
    team_id, actor_user_id, category, action, target_id, target_label, result, metadata
  )
  values (
    v_team_id,
    auth.uid(),
    case when tg_table_name in ('team_members', 'account_records') then 'security' else 'operational' end,
    v_action,
    v_target,
    v_label,
    'success',
    jsonb_build_object('table', tg_table_name, 'op', tg_op)
  );

  return coalesce(new, old);
end;
$$;

-- RLS.
alter table public.device_groups enable row level security;
alter table public.activity_events enable row level security;
alter table public.automations enable row level security;
alter table public.account_records enable row level security;

drop policy if exists device_groups_select on public.device_groups;
create policy device_groups_select on public.device_groups for select using (public.is_team_member(team_id));
drop policy if exists device_groups_insert on public.device_groups;
create policy device_groups_insert on public.device_groups for insert with check (public.can_write_team(team_id));
drop policy if exists device_groups_update on public.device_groups;
create policy device_groups_update on public.device_groups for update using (public.can_write_team(team_id)) with check (public.can_write_team(team_id));
drop policy if exists device_groups_delete on public.device_groups;
create policy device_groups_delete on public.device_groups for delete using (public.is_team_admin(team_id));

drop policy if exists activity_events_select on public.activity_events;
create policy activity_events_select on public.activity_events for select using (public.is_team_member(team_id));
drop policy if exists activity_events_insert on public.activity_events;
create policy activity_events_insert on public.activity_events for insert with check (public.is_team_member(team_id));

drop policy if exists automations_select on public.automations;
create policy automations_select on public.automations for select using (public.is_team_member(team_id));
drop policy if exists automations_insert on public.automations;
create policy automations_insert on public.automations for insert with check (public.can_write_team(team_id));
drop policy if exists automations_update on public.automations;
create policy automations_update on public.automations for update using (public.can_write_team(team_id)) with check (public.can_write_team(team_id));
drop policy if exists automations_delete on public.automations;
create policy automations_delete on public.automations for delete using (public.can_write_team(team_id));

drop policy if exists account_records_select on public.account_records;
create policy account_records_select on public.account_records for select using (public.is_team_member(team_id));
drop policy if exists account_records_insert on public.account_records;
create policy account_records_insert on public.account_records for insert with check (public.can_write_team(team_id));
drop policy if exists account_records_update on public.account_records;
create policy account_records_update on public.account_records for update using (public.can_write_team(team_id)) with check (public.can_write_team(team_id));
drop policy if exists account_records_delete on public.account_records;
create policy account_records_delete on public.account_records for delete using (public.is_team_admin(team_id));

grant select, insert, update, delete on
  public.device_groups, public.activity_events, public.automations, public.account_records
  to authenticated;
grant execute on function public.log_activity_event(uuid, text, text, text, text, text, text, jsonb) to authenticated;

-- Realtime streams.
alter publication supabase_realtime add table public.device_groups;
alter publication supabase_realtime add table public.activity_events;
alter publication supabase_realtime add table public.automations;
alter publication supabase_realtime add table public.account_records;

-- Activity triggers.
drop trigger if exists trg_devices_activity on public.devices;
create trigger trg_devices_activity after insert or update or delete on public.devices
  for each row execute function public.log_row_activity();

drop trigger if exists trg_device_groups_activity on public.device_groups;
create trigger trg_device_groups_activity after insert or update or delete on public.device_groups
  for each row execute function public.log_row_activity();

drop trigger if exists trg_automations_activity on public.automations;
create trigger trg_automations_activity after insert or update or delete on public.automations
  for each row execute function public.log_row_activity();

drop trigger if exists trg_automation_jobs_activity on public.automation_jobs;
create trigger trg_automation_jobs_activity after insert or update or delete on public.automation_jobs
  for each row execute function public.log_row_activity();

drop trigger if exists trg_agent_commands_activity on public.agent_commands;
create trigger trg_agent_commands_activity after insert or update or delete on public.agent_commands
  for each row execute function public.log_row_activity();

drop trigger if exists trg_team_invites_activity on public.team_invites;
create trigger trg_team_invites_activity after insert or update or delete on public.team_invites
  for each row execute function public.log_row_activity();

drop trigger if exists trg_team_members_activity on public.team_members;
create trigger trg_team_members_activity after insert or update or delete on public.team_members
  for each row execute function public.log_row_activity();

drop trigger if exists trg_account_records_activity on public.account_records;
create trigger trg_account_records_activity after insert or update or delete on public.account_records
  for each row execute function public.log_row_activity();

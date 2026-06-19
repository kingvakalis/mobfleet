-- ════════════════════════════════════════════════════════════════════════════
-- Agent device runtime — command 'running' state + device sessions + heartbeat
-- ════════════════════════════════════════════════════════════════════════════
-- Builds on 20260619140000_agent_command_channel. Additive + reversible:
--   • agent_commands gains a 'running' status + started_at (agent "ack start").
--   • device_sessions table tracks each agent connection (+ last telemetry).
--   • device-key RPCs for the agent: start_agent_command, device_session_start,
--     device_heartbeat, device_session_end. Operators read sessions via RLS.
-- Reverse: drop the 4 functions + device_sessions; restore the old status check;
-- drop started_at. (No data migration; all new objects.)
-- ════════════════════════════════════════════════════════════════════════════

-- ── command 'running' state (agent reports start) ────────────────────────────
alter table public.agent_commands drop constraint if exists agent_commands_status_check;
alter table public.agent_commands add constraint agent_commands_status_check
  check (status in ('pending','delivered','running','acked','failed','expired'));
alter table public.agent_commands add column if not exists started_at timestamptz;

create or replace function public.start_agent_command(p_device_key text, p_command_id uuid)
returns void language plpgsql security definer set search_path = public, extensions
as $$
declare v_device_id uuid;
begin
  select device_id into v_device_id from public.device_agent_keys
    where key_hash = encode(extensions.digest(p_device_key,'sha256'),'hex');
  if v_device_id is null then raise exception 'invalid device key' using errcode='P0001'; end if;
  update public.agent_commands set status='running', started_at=now()
    where id=p_command_id and device_id=v_device_id and status in ('pending','delivered');
end $$;
grant execute on function public.start_agent_command(text,uuid) to anon, authenticated;

-- ── device sessions (one per agent connection) ───────────────────────────────
create table if not exists public.device_sessions (
  id                uuid primary key default gen_random_uuid(),
  device_id         uuid not null references public.devices (id) on delete cascade,
  team_id           uuid not null references public.teams (id) on delete cascade,
  agent_version     text,
  started_at        timestamptz not null default now(),
  last_heartbeat_at timestamptz not null default now(),
  ended_at          timestamptz,
  battery           int,
  cpu_usage         int,
  memory_usage      int
);
create index if not exists idx_device_sessions_device on public.device_sessions (device_id, started_at desc);
alter table public.device_sessions enable row level security;
create policy device_sessions_select on public.device_sessions
  for select using (public.is_team_member(team_id));
grant select on public.device_sessions to authenticated;

create or replace function public.device_session_start(p_device_key text, p_agent_version text default null)
returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare v_device_id uuid; v_team_id uuid; v_session_id uuid;
begin
  select device_id, team_id into v_device_id, v_team_id from public.device_agent_keys
    where key_hash = encode(extensions.digest(p_device_key,'sha256'),'hex');
  if v_device_id is null then raise exception 'invalid device key' using errcode='P0001'; end if;
  insert into public.device_sessions (device_id, team_id, agent_version)
    values (v_device_id, v_team_id, p_agent_version) returning id into v_session_id;
  update public.devices set status='online', last_heartbeat=now() where id=v_device_id;
  update public.device_agent_keys set last_seen_at=now() where device_id=v_device_id;
  return v_session_id;
end $$;
grant execute on function public.device_session_start(text,text) to anon, authenticated;

create or replace function public.device_heartbeat(p_device_key text, p_session_id uuid, p_status text default 'online', p_battery int default null, p_cpu int default null, p_mem int default null)
returns void language plpgsql security definer set search_path = public, extensions
as $$
declare v_device_id uuid; v_status public.device_status;
begin
  select device_id into v_device_id from public.device_agent_keys
    where key_hash = encode(extensions.digest(p_device_key,'sha256'),'hex');
  if v_device_id is null then raise exception 'invalid device key' using errcode='P0001'; end if;
  v_status := case when p_status in ('online','offline','error','busy','warming')
                   then p_status::public.device_status else 'online'::public.device_status end;
  update public.devices set status=v_status, last_heartbeat=now() where id=v_device_id;
  update public.device_agent_keys set last_seen_at=now() where device_id=v_device_id;
  if p_session_id is not null then
    update public.device_sessions
      set last_heartbeat_at=now(),
          battery=coalesce(p_battery,battery), cpu_usage=coalesce(p_cpu,cpu_usage), memory_usage=coalesce(p_mem,memory_usage)
      where id=p_session_id and device_id=v_device_id and ended_at is null;
  end if;
end $$;
grant execute on function public.device_heartbeat(text,uuid,text,int,int,int) to anon, authenticated;

create or replace function public.device_session_end(p_device_key text, p_session_id uuid)
returns void language plpgsql security definer set search_path = public, extensions
as $$
declare v_device_id uuid;
begin
  select device_id into v_device_id from public.device_agent_keys
    where key_hash = encode(extensions.digest(p_device_key,'sha256'),'hex');
  if v_device_id is null then raise exception 'invalid device key' using errcode='P0001'; end if;
  update public.device_sessions set ended_at=now() where id=p_session_id and device_id=v_device_id and ended_at is null;
  update public.devices set status='offline' where id=v_device_id;
end $$;
grant execute on function public.device_session_end(text,uuid) to anon, authenticated;

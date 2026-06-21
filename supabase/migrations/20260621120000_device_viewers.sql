-- ════════════════════════════════════════════════════════════════════════════
-- Device viewers — viewer-presence so the agent streams ONLY when someone watches
-- ════════════════════════════════════════════════════════════════════════════
-- Builds on 20260619140000_agent_command_channel + 20260619150000_agent_device_runtime
-- + 20260620140000_device_screenshots. Powers Stage-1 "GO LIVE": a dashboard viewer
-- marks itself active (+ a desired fps) for a device; the agent (device-key) asks whether
-- a recent viewer wants frames and at what rate, and runs its continuous capture loop
-- accordingly. No viewer → the agent does NOT continuously capture (bounds DB/CPU load).
--
-- Auth model (identical to the agent_command_channel / device_screenshots RPCs):
--   • Dashboard users (Supabase JWT, team members) call mark_device_viewer (membership
--     checked inside the SECURITY DEFINER fn) and may READ presence via RLS.
--   • The AGENT has no JWT — it holds the per-device KEY and calls device_viewer_fps,
--     which validates sha256(key) against device_agent_keys.
--   • No service-role key; writes are RPC-only (REVOKE on the table).
--
-- ADDITIVE + REVERSIBLE. Touches nothing else. One row PER DEVICE (PK device_id).
-- Reverse: drop function device_viewer_fps; drop function mark_device_viewer; drop table device_viewers.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.device_viewers (
  device_id    uuid primary key references public.devices (id) on delete cascade,
  team_id      uuid not null references public.teams (id) on delete cascade,
  -- the latest fps a viewer asked for (0 = present but not live-streaming, e.g. snapshot mode).
  target_fps   int  not null default 0,
  last_seen_at timestamptz not null default now()
);
create index if not exists idx_device_viewers_team on public.device_viewers (team_id);
alter table public.device_viewers enable row level security;

-- Supabase auto-grants DML to anon/authenticated on new public tables; REVOKE then
-- re-grant ONLY select to authenticated. Writes happen exclusively through the RPCs.
revoke all on public.device_viewers from anon, authenticated;
create policy device_viewers_select on public.device_viewers
  for select using (public.is_team_member(team_id));
grant select on public.device_viewers to authenticated;

-- ── a dashboard viewer marks itself active for a device (JWT auth → membership check) ──
-- p_fps is the desired live frame rate (0 when Phone Control is open but not GO LIVE).
-- Clamped to [0, 15] so a client can never request an abusive rate.
create or replace function public.mark_device_viewer(p_device_id uuid, p_fps int default 0)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_team uuid;
begin
  select team_id into v_team from public.devices where id = p_device_id;
  if v_team is null then raise exception 'unknown device' using errcode = 'P0001'; end if;
  if not public.is_team_member(v_team) then raise exception 'not a team member' using errcode = 'P0001'; end if;
  insert into public.device_viewers (device_id, team_id, target_fps, last_seen_at)
    values (p_device_id, v_team, greatest(0, least(coalesce(p_fps, 0), 15)), now())
    on conflict (device_id) do update
      set target_fps = greatest(0, least(coalesce(p_fps, 0), 15)),
          last_seen_at = now();
end $$;
grant execute on function public.mark_device_viewer(uuid, int) to authenticated;

-- ── the agent (device-key auth) asks: does a recent viewer want frames, at what fps? ──
-- Returns the requested fps if a viewer was seen within p_window_secs, else 0. The agent
-- treats 0 as "do not continuously capture". p_window_secs gives a viewer-heartbeat grace.
create or replace function public.device_viewer_fps(p_device_key text, p_window_secs int default 12)
returns int
language plpgsql security definer set search_path = public, extensions
as $$
declare v_device uuid; v_fps int;
begin
  select device_id into v_device from public.device_agent_keys
    where key_hash = encode(extensions.digest(p_device_key, 'sha256'), 'hex');
  if v_device is null then raise exception 'invalid device key' using errcode = 'P0001'; end if;
  select case
           when last_seen_at > now() - make_interval(secs => greatest(1, coalesce(p_window_secs, 12)))
           then target_fps else 0
         end
    into v_fps
    from public.device_viewers where device_id = v_device;
  return coalesce(v_fps, 0);
end $$;
grant execute on function public.device_viewer_fps(text, int) to anon, authenticated;

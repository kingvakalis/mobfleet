-- ════════════════════════════════════════════════════════════════════════════
-- Real installed-app inventory + per-user visibility + launch/terminate/refresh
-- ════════════════════════════════════════════════════════════════════════════
-- Builds on agent_command_channel / agent_device_runtime. Additive + reversible.
--   • device_apps                  — real installed-app inventory per device (agent-written)
--   • user_device_app_preferences  — per-user, per-device show/hide
--   • put_device_apps(...)         — device-key RPC the agent upserts detected apps through
--   • agent_commands.action gains 'terminate' + 'refresh_apps' (CHECK broadened — additive)
--
-- Auth: members READ their team's inventory (RLS, suspended/anon/cross-team excluded via
-- is_team_member); a user manages ONLY their own visibility prefs; the AGENT writes inventory
-- ONLY through the SECURITY DEFINER device-key RPC (no client write path). No service-role key.
-- Reverse: restore the old action CHECK; drop the function + the two tables.
-- ════════════════════════════════════════════════════════════════════════════

-- ── installed-app inventory (one row per device+bundle; agent-written) ────────
create table if not exists public.device_apps (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  device_id   uuid not null references public.devices (id) on delete cascade,
  bundle_id   text not null,
  name        text not null,
  abbr        text,
  icon_color  text,
  -- TRUE only when the agent CONFIRMED the app is on the device; unknown/unavailable
  -- states stay false (never fake-installed). The UI only ever shows installed = true.
  installed   boolean not null default true,
  source      text not null default 'detected' check (source in ('detected', 'manual', 'system')),
  detected_at timestamptz not null default now(),
  unique (device_id, bundle_id)
);
create index if not exists idx_device_apps_device on public.device_apps (device_id, installed);
alter table public.device_apps enable row level security;
-- Supabase auto-grants DML on new public tables → revoke, then re-grant only SELECT.
revoke all on public.device_apps from anon, authenticated;
drop policy if exists device_apps_select on public.device_apps;
create policy device_apps_select on public.device_apps
  for select using (public.is_team_member(team_id));
grant select on public.device_apps to authenticated;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'device_apps') then
    alter publication supabase_realtime add table public.device_apps;
  end if;
end $$;

-- ── per-user, per-device app visibility preferences ──────────────────────────
create table if not exists public.user_device_app_preferences (
  user_id    uuid not null references auth.users (id) on delete cascade,
  team_id    uuid not null references public.teams (id) on delete cascade,
  device_id  uuid not null references public.devices (id) on delete cascade,
  bundle_id  text not null,
  visible    boolean not null default true,
  sort_order int,
  updated_at timestamptz not null default now(),
  primary key (user_id, device_id, bundle_id)
);
alter table public.user_device_app_preferences enable row level security;
revoke all on public.user_device_app_preferences from anon, authenticated;
-- A user reads/writes ONLY their own prefs, and only for a team they ACTIVELY belong to
-- (is_team_member is false for suspended/anon/other teams). Insert also pins the device to
-- the team so a forged team_id can't slip a pref past the check.
drop policy if exists udap_select on public.user_device_app_preferences;
create policy udap_select on public.user_device_app_preferences
  for select using (user_id = auth.uid() and public.is_team_member(team_id));
drop policy if exists udap_insert on public.user_device_app_preferences;
create policy udap_insert on public.user_device_app_preferences
  for insert with check (
    user_id = auth.uid() and public.is_team_member(team_id)
    and exists (select 1 from public.devices d where d.id = device_id and d.team_id = user_device_app_preferences.team_id)
  );
drop policy if exists udap_update on public.user_device_app_preferences;
create policy udap_update on public.user_device_app_preferences
  for update using (user_id = auth.uid() and public.is_team_member(team_id))
  with check (user_id = auth.uid() and public.is_team_member(team_id));
drop policy if exists udap_delete on public.user_device_app_preferences;
create policy udap_delete on public.user_device_app_preferences
  for delete using (user_id = auth.uid() and public.is_team_member(team_id));
grant select, insert, update, delete on public.user_device_app_preferences to authenticated;

-- ── agent uploads the detected inventory (device-key auth; SECURITY DEFINER) ──
create or replace function public.put_device_apps(p_device_key text, p_apps jsonb)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_device_id uuid; v_team_id uuid;
begin
  select device_id, team_id into v_device_id, v_team_id from public.device_agent_keys
    where key_hash = encode(extensions.digest(p_device_key, 'sha256'), 'hex');
  if v_device_id is null then raise exception 'invalid device key' using errcode = 'P0001'; end if;
  if p_apps is null or jsonb_typeof(p_apps) <> 'array' then
    raise exception 'apps must be a json array' using errcode = 'P0001';
  end if;
  insert into public.device_apps (team_id, device_id, bundle_id, name, abbr, icon_color, installed, source, detected_at)
  select v_team_id, v_device_id,
         a.bundle_id, coalesce(nullif(a.name, ''), a.bundle_id), a.abbr, a.icon_color,
         coalesce(a.installed, false),
         case when a.source in ('detected', 'manual', 'system') then a.source else 'detected' end,
         now()
  from jsonb_to_recordset(p_apps) as a(bundle_id text, name text, abbr text, icon_color text, installed boolean, source text)
  where a.bundle_id is not null and length(a.bundle_id) > 0
  on conflict (device_id, bundle_id) do update set
    name        = excluded.name,
    abbr        = excluded.abbr,
    icon_color  = excluded.icon_color,
    installed   = excluded.installed,
    source      = excluded.source,
    detected_at = now();
  update public.device_agent_keys set last_seen_at = now() where device_id = v_device_id;
end $$;
grant execute on function public.put_device_apps(text, jsonb) to anon, authenticated;

-- ── broaden the command vocabulary (ADDITIVE — only adds allowed values) ──────
-- 'terminate' = close an app by bundle id; 'refresh_apps' = agent re-detects inventory.
alter table public.agent_commands drop constraint if exists agent_commands_action_check;
alter table public.agent_commands add constraint agent_commands_action_check
  check (action in (
    'tap','swipe','type','home','back','switcher','lock','unlock','launch','install','reboot','screenshot','terminate','refresh_apps'
  ));

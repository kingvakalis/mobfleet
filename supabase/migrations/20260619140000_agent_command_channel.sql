-- ════════════════════════════════════════════════════════════════════════════
-- Agent command channel — Supabase-authoritative device control
-- ════════════════════════════════════════════════════════════════════════════
-- Lets the dashboard queue commands for a device and a hardware agent (Appium/WDA)
-- drain + ack them, ALL on Supabase (no Prisma/me-mode backend, no disjoint team id).
--
-- Auth model:
--   • Dashboard users (Supabase JWT, team members) enqueue/read via RLS.
--   • The AGENT has no JWT — it holds a per-device KEY (minted at claim, stored only
--     as a sha256 hash) and calls SECURITY DEFINER RPCs that validate that key. This
--     mirrors accept_invite(): a bearer secret redeemed through a definer function.
-- No plaintext secret is ever stored (only the hash); the key is returned once at claim.
-- ════════════════════════════════════════════════════════════════════════════

-- ── per-device agent key (hash only) ─────────────────────────────────────────
create table if not exists public.device_agent_keys (
  device_id    uuid primary key references public.devices (id) on delete cascade,
  team_id      uuid not null references public.teams (id) on delete cascade,
  key_hash     text not null,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz
);
alter table public.device_agent_keys enable row level security;
-- Admins may see THAT a device is provisioned (never the hash is useful); writes are RPC-only.
create policy device_agent_keys_select on public.device_agent_keys
  for select using (public.is_team_admin(team_id));
grant select on public.device_agent_keys to authenticated;

-- ── pairing tokens (admin mints; agent redeems via claim_device) ──────────────
create table if not exists public.device_pairing_tokens (
  token      text primary key default encode(extensions.gen_random_bytes(24), 'hex'),
  team_id    uuid not null references public.teams (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  used_at    timestamptz
);
alter table public.device_pairing_tokens enable row level security;
create policy dpt_select on public.device_pairing_tokens
  for select using (public.is_team_member(team_id));
create policy dpt_insert on public.device_pairing_tokens
  for insert with check (public.can_write_team(team_id) and created_by = auth.uid());
grant select, insert on public.device_pairing_tokens to authenticated;

-- ── command queue ────────────────────────────────────────────────────────────
create table if not exists public.agent_commands (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams (id) on delete cascade,
  device_id    uuid not null references public.devices (id) on delete cascade,
  action       text not null check (action in ('tap','swipe','type','home','back','switcher','lock','unlock','launch','install','reboot','screenshot')),
  payload      jsonb not null default '{}'::jsonb,
  status       text not null default 'pending' check (status in ('pending','delivered','acked','failed','expired')),
  issued_by    uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  delivered_at timestamptz,
  acked_at     timestamptz,
  success      boolean,
  error        text
);
create index if not exists idx_agent_commands_device on public.agent_commands (device_id, status);
create index if not exists idx_agent_commands_team   on public.agent_commands (team_id, created_at desc);
alter table public.agent_commands enable row level security;
-- Members see their team's commands; writers enqueue ONLY for a device in their team.
create policy ac_select on public.agent_commands
  for select using (public.is_team_member(team_id));
create policy ac_insert on public.agent_commands
  for insert with check (
    public.can_write_team(team_id)
    and issued_by = auth.uid()
    and exists (select 1 from public.devices d where d.id = device_id and d.team_id = agent_commands.team_id)
  );
grant select, insert on public.agent_commands to authenticated;

-- ── RPCs (device-key auth; SECURITY DEFINER) ─────────────────────────────────
-- Agent self-provisions with a pairing token → creates/【upserts】its device row and
-- gets a one-time device key (only the hash is stored).
create or replace function public.claim_device(p_token text, p_udid text, p_name text default null, p_model text default null, p_os text default null)
returns json
language plpgsql security definer set search_path = public, extensions
as $$
declare v_tok public.device_pairing_tokens%rowtype; v_device public.devices%rowtype; v_key text;
begin
  select * into v_tok from public.device_pairing_tokens where token = p_token for update;
  if not found then raise exception 'invalid pairing token' using errcode = 'P0002'; end if;
  if v_tok.used_at is not null then raise exception 'pairing token already used' using errcode = 'P0002'; end if;
  if v_tok.expires_at <= now() then raise exception 'pairing token expired' using errcode = 'P0002'; end if;

  insert into public.devices (team_id, name, udid, platform, status)
    values (v_tok.team_id, coalesce(p_name, p_udid), p_udid, 'ios', 'offline')
    on conflict (team_id, udid) do update set name = coalesce(excluded.name, public.devices.name)
    returning * into v_device;

  v_key := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.device_agent_keys (device_id, team_id, key_hash)
    values (v_device.id, v_tok.team_id, encode(extensions.digest(v_key, 'sha256'), 'hex'))
    on conflict (device_id) do update set key_hash = excluded.key_hash, created_at = now();

  update public.device_pairing_tokens set used_at = now() where token = p_token;
  return json_build_object('device_id', v_device.id, 'device_key', v_key, 'team_id', v_tok.team_id);
end $$;
grant execute on function public.claim_device(text,text,text,text,text) to anon, authenticated;

-- Agent drains its queue: validate key → return pending commands + mark delivered.
create or replace function public.claim_device_commands(p_device_key text)
returns setof public.agent_commands
language plpgsql security definer set search_path = public, extensions
as $$
declare v_device_id uuid;
begin
  select device_id into v_device_id from public.device_agent_keys
    where key_hash = encode(extensions.digest(p_device_key, 'sha256'), 'hex');
  if v_device_id is null then raise exception 'invalid device key' using errcode = 'P0001'; end if;
  update public.device_agent_keys set last_seen_at = now() where device_id = v_device_id;
  return query
    update public.agent_commands set status = 'delivered', delivered_at = now()
    where device_id = v_device_id and status = 'pending'
    returning *;
end $$;
grant execute on function public.claim_device_commands(text) to anon, authenticated;

-- Agent reports a result for one command it owns.
create or replace function public.ack_agent_command(p_device_key text, p_command_id uuid, p_success boolean, p_error text default null)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_device_id uuid;
begin
  select device_id into v_device_id from public.device_agent_keys
    where key_hash = encode(extensions.digest(p_device_key, 'sha256'), 'hex');
  if v_device_id is null then raise exception 'invalid device key' using errcode = 'P0001'; end if;
  update public.agent_commands
    set status = case when p_success then 'acked' else 'failed' end,
        acked_at = now(), success = p_success, error = left(p_error, 500)
    where id = p_command_id and device_id = v_device_id;
end $$;
grant execute on function public.ack_agent_command(text,uuid,boolean,text) to anon, authenticated;

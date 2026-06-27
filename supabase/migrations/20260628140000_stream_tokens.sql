-- ════════════════════════════════════════════════════════════════════════════
-- Stage 2A live MJPEG — short-lived, device-scoped STREAM TOKENS (no video in PG)
-- ════════════════════════════════════════════════════════════════════════════
-- Video frames never touch Postgres. This only mints/validates the ACCESS token a browser
-- presents to the hosted MJPEG relay, and lets the relay authenticate the agent publisher —
-- all metadata. Three SECURITY DEFINER functions mirror the existing device-key/pairing-token
-- patterns (device_agent_keys.key_hash, device_pairing_tokens):
--   • mint_stream_token(device)      — an authorized team member mints a ~60s device-scoped token.
--   • redeem_stream_token(token,dev)  — the relay validates a VIEWER's token (device-scoped, unexpired).
--   • resolve_stream_publisher(key)   — the relay authenticates the AGENT publisher by its device-key.
-- Idempotent (create or replace / if not exists). No service-role key is used anywhere.

-- ── token table (metadata only) ──────────────────────────────────────────────
create table if not exists public.stream_tokens (
  token       uuid primary key default gen_random_uuid(),
  device_id   uuid not null references public.devices(id) on delete cascade,
  team_id     uuid not null,
  issued_by   uuid,                                   -- auth.uid() of the minter
  expires_at  timestamptz not null default now() + interval '60 seconds',
  created_at  timestamptz not null default now()
);
create index if not exists stream_tokens_device_idx on public.stream_tokens(device_id);
create index if not exists stream_tokens_expires_idx on public.stream_tokens(expires_at);
-- RLS ON with NO policies → no direct table access; the SECURITY DEFINER RPCs are the only path.
alter table public.stream_tokens enable row level security;

-- ── mint: an authorized team member gets a short-lived, device-scoped token ───
-- Authorization == team membership (same granularity as viewing the device / its screenshots).
-- A token for one device can NEVER be used for another (redeem checks device_id).
create or replace function public.mint_stream_token(p_device_id uuid)
returns table(token uuid, expires_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare v_team uuid;
begin
  select team_id into v_team from public.devices where id = p_device_id;
  if v_team is null or not public.is_team_member(v_team) then
    raise exception 'device not found' using errcode = 'P0002';   -- no existence probing
  end if;
  -- opportunistic housekeeping (tiny table): drop long-expired tokens.
  delete from public.stream_tokens st where st.expires_at < now() - interval '5 minutes';
  return query
    insert into public.stream_tokens (device_id, team_id, issued_by)
    values (p_device_id, v_team, auth.uid())
    returning stream_tokens.token, stream_tokens.expires_at;
end $$;
grant execute on function public.mint_stream_token(uuid) to authenticated;

-- ── redeem: the RELAY validates a viewer's token (anon key) ───────────────────
-- Returns the scoped {device,team} only for a valid, UNEXPIRED, device-MATCHING token; otherwise
-- raises. Not deleted on redeem (a stream may reconnect within the TTL); the short TTL bounds reuse.
create or replace function public.redeem_stream_token(p_token uuid, p_device_id uuid)
returns table(device_id uuid, team_id uuid)
language plpgsql security definer set search_path = public
as $$
declare v_dev uuid; v_team uuid; v_exp timestamptz;
begin
  select st.device_id, st.team_id, st.expires_at into v_dev, v_team, v_exp
    from public.stream_tokens st where st.token = p_token;
  if v_dev is null then raise exception 'invalid stream token' using errcode = 'P0001'; end if;
  if v_exp < now() then raise exception 'stream token expired' using errcode = 'P0001'; end if;
  if v_dev <> p_device_id then raise exception 'stream token device mismatch' using errcode = 'P0001'; end if;
  return query select v_dev, v_team;
end $$;
grant execute on function public.redeem_stream_token(uuid, uuid) to anon, authenticated;

-- ── resolve publisher: the RELAY authenticates the AGENT by its device-key ────
-- Mirrors claim_device_commands' key check. Returns the device_id the key owns, or raises. Safe to
-- expose to anon: an attacker without the device-key learns nothing; with it they already hold the agent.
create or replace function public.resolve_stream_publisher(p_device_key text)
returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_device_id uuid;
begin
  select device_id into v_device_id from public.device_agent_keys
    where key_hash = encode(extensions.digest(p_device_key, 'sha256'), 'hex');
  if v_device_id is null then raise exception 'invalid device key' using errcode = 'P0001'; end if;
  update public.device_agent_keys set last_seen_at = now() where device_id = v_device_id;
  return v_device_id;
end $$;
grant execute on function public.resolve_stream_publisher(text) to anon, authenticated;

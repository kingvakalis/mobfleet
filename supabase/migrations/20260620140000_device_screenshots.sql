-- ════════════════════════════════════════════════════════════════════════════
-- Device screenshots — truthful live-frame transport for Phone Control
-- ════════════════════════════════════════════════════════════════════════════
-- Builds on 20260619140000_agent_command_channel + 20260619150000_agent_device_runtime.
-- The hardware agent (Appium/WDA) captures a REAL screenshot when it executes a
-- `screenshot` command and uploads the PNG bytes here so the dashboard can render
-- the actual device screen (replacing the mock LivePhone frame in supabase-mode).
--
-- Auth model (identical to the agent_command_channel RPCs):
--   • The AGENT has no JWT — it holds the per-device KEY and calls a SECURITY DEFINER
--     RPC (put_device_screenshot) that validates the sha256(key) against device_agent_keys.
--   • Dashboard users (Supabase JWT, team members) READ the latest frame via RLS.
--   • No service-role key; no plaintext key stored; writes are RPC-only.
--
-- ADDITIVE + REVERSIBLE. It does NOT touch agent_commands (it only references it via a
-- nullable FK that is SET NULL on delete), so Fleet's useAgentCommands is unaffected.
-- Reverse: drop function put_device_screenshot; drop table device_screenshots.
-- One row PER DEVICE (PK device_id), upserted on each capture — bounds storage to the
-- latest frame per device.
-- ════════════════════════════════════════════════════════════════════════════

-- ── latest captured frame, one row per device ────────────────────────────────
create table if not exists public.device_screenshots (
  device_id    uuid primary key references public.devices (id) on delete cascade,
  team_id      uuid not null references public.teams (id) on delete cascade,
  -- the command this frame answered (nullable; kept for provenance only).
  command_id   uuid references public.agent_commands (id) on delete set null,
  -- allow-listed at the boundary: this value is interpolated into a data:image/<format>
  -- URL in the dashboard, so it must never carry an arbitrary MIME token.
  format       text not null default 'png' check (format in ('png', 'jpeg', 'webp')),
  -- device LOGICAL size (points, from WDA window rect) so the UI can map a tap on
  -- the displayed frame back to device coordinates. Null when unknown.
  width        int,
  height       int,
  image_base64 text not null,
  captured_at  timestamptz not null default now()
);
create index if not exists idx_device_screenshots_team on public.device_screenshots (team_id, captured_at desc);
alter table public.device_screenshots enable row level security;
-- Supabase auto-grants DML on new public tables to anon/authenticated via default
-- privileges, so REVOKE everything first and re-grant ONLY select to authenticated.
-- Writes happen exclusively through the SECURITY DEFINER RPC below (device-key auth);
-- the RPC runs as its owner so the revoke never blocks the agent's upload.
revoke all on public.device_screenshots from anon, authenticated;
-- Members READ their team's latest device frame (RLS); no client write path exists.
create policy device_screenshots_select on public.device_screenshots
  for select using (public.is_team_member(team_id));
grant select on public.device_screenshots to authenticated;

-- ── agent uploads a captured frame (device-key auth; SECURITY DEFINER) ─────────
create or replace function public.put_device_screenshot(
  p_device_key text,
  p_command_id uuid,
  p_image_base64 text,
  p_format text default 'png',
  p_width int default null,
  p_height int default null
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_device_id uuid; v_team_id uuid;
begin
  select device_id, team_id into v_device_id, v_team_id from public.device_agent_keys
    where key_hash = encode(extensions.digest(p_device_key, 'sha256'), 'hex');
  if v_device_id is null then raise exception 'invalid device key' using errcode = 'P0001'; end if;
  if p_image_base64 is null or length(p_image_base64) = 0 then
    raise exception 'empty screenshot' using errcode = 'P0001';
  end if;
  -- Sanity bound: a native iPhone PNG screenshot base64 is well under this. Guards
  -- against a malformed/abusive payload bloating the table.
  if length(p_image_base64) > 20000000 then
    raise exception 'screenshot too large' using errcode = 'P0001';
  end if;
  -- Only accept a command_id that belongs to THIS device (else store null provenance);
  -- never let one device attribute a frame to another device's command.
  if p_command_id is not null and not exists (
    select 1 from public.agent_commands ac where ac.id = p_command_id and ac.device_id = v_device_id
  ) then
    p_command_id := null;
  end if;
  insert into public.device_screenshots (device_id, team_id, command_id, format, width, height, image_base64, captured_at)
    values (v_device_id, v_team_id, p_command_id,
            case when p_format in ('png', 'jpeg', 'webp') then p_format else 'png' end,
            p_width, p_height, p_image_base64, now())
    on conflict (device_id) do update set
      command_id   = excluded.command_id,
      format       = excluded.format,
      width        = excluded.width,
      height       = excluded.height,
      image_base64 = excluded.image_base64,
      captured_at  = now();
  update public.device_agent_keys set last_seen_at = now() where device_id = v_device_id;
end $$;
grant execute on function public.put_device_screenshot(text, uuid, text, text, int, int) to anon, authenticated;

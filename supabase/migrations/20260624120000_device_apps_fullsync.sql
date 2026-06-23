-- ════════════════════════════════════════════════════════════════════════════
-- put_device_apps → authoritative FULL-SYNC (kills stale-bundle-id duplicates)
-- ════════════════════════════════════════════════════════════════════════════
-- Builds on 20260622120000_device_apps. Additive + idempotent: only `create or replace`s the
-- put_device_apps RPC — no schema/policy/grant changes, no data migration.
--
-- WHY: the agent uploads its COMPLETE probe set (every supported bundle id, installed true/false) on
-- each detect. The old RPC upserted by (device_id, bundle_id) but never RETIRED rows that stopped being
-- reported. So when a catalog bundle id changed (observed: a typo'd Telegram id `ph.telegra.Telegraph`
-- vs the canonical `ph.telegram.Telegraph`), the previous row lingered installed=true → the UI showed
-- TWO "Telegram" entries. Making the upload AUTHORITATIVE (anything agent-managed not in this batch →
-- installed=false) means the inventory always reflects exactly the latest detection: no duplicates, no
-- ghosts, idempotent across repeated Refresh Apps. 'manual' rows (future user-added) are preserved.
-- Reverse: restore the prior body from 20260622120000_device_apps.sql (no other objects touched).
-- ════════════════════════════════════════════════════════════════════════════

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
  -- Canonical identity = (device_id, bundle_id). Upsert the reported inventory.
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
  -- FULL-SYNC: retire any AGENT-managed row (detected/system) for this device that the agent did NOT
  -- report in this batch → it is no longer present, so it must not keep showing (kills the stale-bundle
  -- duplicate). 'manual' rows are left untouched. The UI only ever shows installed = true.
  update public.device_apps d set installed = false
   where d.device_id = v_device_id and d.installed = true and d.source <> 'manual'
     and not exists (
       select 1 from jsonb_to_recordset(p_apps) as a(bundle_id text)
       where a.bundle_id is not null and length(a.bundle_id) > 0 and a.bundle_id = d.bundle_id
     );
  update public.device_agent_keys set last_seen_at = now() where device_id = v_device_id;
end $$;
grant execute on function public.put_device_apps(text, jsonb) to anon, authenticated;

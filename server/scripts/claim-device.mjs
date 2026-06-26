#!/usr/bin/env node
/**
 * claim-device — redeem a MobFleet pairing token for a KNOWN physical device and print the
 * { device_id, device_key } plus a ready-to-paste AGENT_DEVICES entry. This is the piece the Mac
 * operator needs: the agent's PAIRING_TOKEN+UDID auto-claim path provisions a device but never
 * surfaces the device_key, so a STABLE AGENT_DEVICES entry was impossible to build by hand.
 *
 * Pairing model (unchanged): an ADMIN mints a one-time token in MobFleet → "Pair device"
 * (RLS-gated insert into device_pairing_tokens). That token — NOT a locally-invented string — is
 * what claim_device expects; it is a stored secret row, looked up by value (not a signed/format
 * value), single-use, 15-min default expiry. A made-up token fails with "invalid pairing token".
 *
 * Auth: anon key + the token only. NEVER needs the service-role key. The device_key is returned
 * ONCE (only its sha256 hash is stored); treat it like a credential and keep it off shared logs.
 *
 * Usage (run on the Mac, same env as the agent):
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... \
 *   node server/scripts/claim-device.mjs --token <PAIRING_TOKEN> --udid <UDID> [--name N] [--model M] [--os iOS]
 *
 * Then append the printed entry to AGENT_DEVICES (comma-separated; existing devices untouched) and
 * restart the agent.
 */
// Inlined to match server/src/agent/supabase-agent-transport.ts rpcRequest() — keeps this helper a
// zero-dependency plain-node script (no tsx / TS import) the operator can run as-is.
function rpcRequest(baseUrl, anonKey, fn, args) {
  return {
    url: `${baseUrl.replace(/\/+$/, '')}/rest/v1/rpc/${fn}`,
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  }
}

function arg(name) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined }
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
const token = arg('token') || process.env.PAIRING_TOKEN
const udid = arg('udid') || process.env.UDID
const name = arg('name'), model = arg('model'), os = arg('os')

function die(msg) { console.error(`✗ ${msg}`); process.exit(2) }
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) die('set SUPABASE_URL and SUPABASE_ANON_KEY (the same values the agent uses)')
if (!token) die('missing --token (mint one in MobFleet → Pair device; do NOT invent a token)')
if (!udid) die('missing --udid (e.g. 00008140-000934890C10801C)')

const r = rpcRequest(SUPABASE_URL, SUPABASE_ANON_KEY, 'claim_device', { p_token: token, p_udid: udid, p_name: name ?? null, p_model: model ?? null, p_os: os ?? null })
const res = await fetch(r.url, { method: 'POST', headers: r.headers, body: r.body })
const text = await res.text()
if (!res.ok) {
  let hint = ''
  if (/invalid pairing token/.test(text)) hint = ' → the token does not exist. Mint a fresh one in MobFleet → Pair device.'
  else if (/already used/.test(text)) hint = ' → this token was already redeemed. Mint a new one.'
  else if (/expired/.test(text)) hint = ' → the token expired (15-min default). Mint a new one and claim promptly.'
  die(`claim_device failed: HTTP ${res.status} ${text.slice(0, 160)}${hint}`)
}
const v = JSON.parse(text)
const entry = `${udid}=${v.device_id}:${v.device_key}`
console.log('✓ device claimed')
console.log(`  device_id : ${v.device_id}`)
console.log(`  device_key: ${v.device_key}`)
console.log(`  team_id   : ${v.team_id}`)
console.log('\nAdd this to the agent (append to AGENT_DEVICES, comma-separated — existing devices stay):')
console.log(`  AGENT_DEVICES="...existing...,${entry}"`)
console.log('\nThen restart the single managed agent. Keep device_key secret (only its hash is stored server-side).')

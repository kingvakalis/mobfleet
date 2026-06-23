/**
 * Rolled-back validation of supabase/migrations/20260624120000_device_apps_fullsync.sql against the LIVE
 * database. One transaction: apply the migration (create or replace put_device_apps), exercise the
 * authoritative full-sync behaviour with synthetic rows, then ALWAYS ROLLBACK. Nothing is committed.
 *
 * Proves: a changed catalog bundle id (the duplicate-Telegram bug) RETIRES the old row (no duplicate);
 * repeated identical uploads are idempotent (no new rows, stable installed set); installed=false in the
 * batch is honoured; 'manual' rows are preserved across detection syncs; invalid key rejected.
 *
 * Run: node scripts/validate-device-apps-fullsync-migration.mjs
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Client } = require('pg')
function readDatabaseUrl() {
  const raw = readFileSync('server/.env', 'utf8').replace(/^﻿/, '')
  for (const line of raw.split(/\r?\n/)) { const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+)\s*$/); if (m) return m[1].replace(/^["']|["']$/g, '').trim() }
  throw new Error('DATABASE_URL not found in server/.env')
}
let pass = 0, fail = 0
const is = (label, actual, expected) => actual === expected ? (pass++, console.log(`  ✓ ${label} (${JSON.stringify(actual)})`)) : (fail++, console.log(`  ✗ ${label} — got ${JSON.stringify(actual)} expected ${JSON.stringify(expected)}`))
// REAL Telegram iOS bundle id (reverse-DNS of Telegram's telegra.ph; confirmed by an on-device
// queryAppState probe). TG_OLD is the typo'd id (extra "m") the repo catalog used to carry, which left a
// stale installed row that the old RPC never retired → the duplicate "Telegram" in the UI.
const TG_REAL = 'ph.telegra.Telegraph', TG_OLD = 'ph.telegram.Telegraph'

async function main() {
  const migration = readFileSync('supabase/migrations/20260624120000_device_apps_fullsync.sql', 'utf8')
  const c = new Client({ connectionString: readDatabaseUrl(), ssl: { rejectUnauthorized: false }, statement_timeout: 30000 })
  await c.connect()
  console.log('connected — rolled-back full-sync validation\n')
  const put = (key, apps) => c.query(`select public.put_device_apps($1,$2::jsonb)`, [key, JSON.stringify(apps)])
  const installedCount = async (devId, name) => (await c.query(`select count(*)::int n from public.device_apps where device_id=$1 and installed=true${name ? ' and name=$2' : ''}`, name ? [devId, name] : [devId])).rows[0].n
  const rowsFor = async (devId, bundle) => (await c.query(`select installed from public.device_apps where device_id=$1 and bundle_id=$2`, [devId, bundle])).rows[0]?.installed
  const totalRows = async (devId) => (await c.query(`select count(*)::int n from public.device_apps where device_id=$1`, [devId])).rows[0].n
  try {
    await c.query('BEGIN')
    await c.query(migration); console.log('  ✓ full-sync migration applied (create or replace)'); pass++
    await c.query(migration); console.log('  ✓ idempotent (second apply ok)'); pass++

    const s = Math.random().toString(36).slice(2)
    const uOwner = (await c.query(`insert into auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,confirmation_token,recovery_token,email_change,email_change_token_new,raw_app_meta_data,raw_user_meta_data) values (gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$1,crypt('x',gen_salt('bf')),now(),now(),now(),'','','','','{"provider":"email"}'::jsonb,'{}'::jsonb) returning id`, [`fs_${s}@mobfleet-test.com`])).rows[0].id
    const team = (await c.query(`insert into public.teams(name,owner_user_id) values('FS Co',$1) returning id`, [uOwner])).rows[0].id
    const dev = (await c.query(`insert into public.devices(team_id,name,udid,platform,status) values($1,'fs-dev',$2,'ios','online') returning id`, [team, 'fs-udid-' + s])).rows[0].id
    const KEY = 'FS_KEY_' + s
    await c.query(`insert into public.device_agent_keys(device_id,team_id,key_hash) values($1,$2,encode(extensions.digest($3,'sha256'),'hex'))`, [dev, team, KEY])

    // Batch 1: the OLD (typo) Telegram id + Instagram installed — models the stale 2026-06-22 row.
    await put(KEY, [
      { bundle_id: TG_OLD, name: 'Telegram', abbr: 'Te', installed: true, source: 'detected' },
      { bundle_id: 'com.burbn.instagram', name: 'Instagram', abbr: 'In', installed: true, source: 'detected' },
    ])
    is('batch 1 → installed Telegram = 1', await installedCount(dev, 'Telegram'), 1)
    is('batch 1 → old (typo) Telegram row installed', await rowsFor(dev, TG_OLD), true)

    // Batch 2: a REAL on-device probe now reports the REAL Telegram id (the catalog was corrected) +
    // Instagram. Full-sync must RETIRE the old typo row so only ONE Telegram is installed → no duplicate.
    await put(KEY, [
      { bundle_id: TG_REAL, name: 'Telegram', abbr: 'Te', installed: true, source: 'detected' },
      { bundle_id: 'com.burbn.instagram', name: 'Instagram', abbr: 'In', installed: true, source: 'detected' },
    ])
    is('batch 2 (real probe, changed bundle id) → installed Telegram STILL = 1 (no duplicate)', await installedCount(dev, 'Telegram'), 1)
    is('batch 2 → old typo Telegram row RETIRED (installed=false)', await rowsFor(dev, TG_OLD), false)
    is('batch 2 → real Telegram row installed', await rowsFor(dev, TG_REAL), true)
    is('batch 2 → Instagram still installed', await rowsFor(dev, 'com.burbn.instagram'), true)

    // Idempotency: repeat batch 2 → no new rows, same installed set
    const before = await totalRows(dev)
    await put(KEY, [
      { bundle_id: TG_REAL, name: 'Telegram', abbr: 'Te', installed: true, source: 'detected' },
      { bundle_id: 'com.burbn.instagram', name: 'Instagram', abbr: 'In', installed: true, source: 'detected' },
    ])
    is('repeated Refresh → no new rows (idempotent)', await totalRows(dev), before)
    is('repeated Refresh → installed Telegram = 1', await installedCount(dev, 'Telegram'), 1)

    // installed=false in batch → row set not-installed
    await put(KEY, [
      { bundle_id: TG_REAL, name: 'Telegram', abbr: 'Te', installed: false, source: 'detected' },
      { bundle_id: 'com.burbn.instagram', name: 'Instagram', abbr: 'In', installed: true, source: 'detected' },
    ])
    is('batch with installed:false → Telegram retired', await rowsFor(dev, TG_REAL), false)
    is('only Instagram installed now', await installedCount(dev), 1)

    // 'manual' rows are PRESERVED across a detection sync that omits them
    await c.query(`insert into public.device_apps(team_id,device_id,bundle_id,name,abbr,installed,source) values($1,$2,'com.user.manual','Manual App','Ma',true,'manual')`, [team, dev])
    await put(KEY, [{ bundle_id: 'com.burbn.instagram', name: 'Instagram', abbr: 'In', installed: true, source: 'detected' }])
    is("manual row PRESERVED (not retired by detection sync)", await rowsFor(dev, 'com.user.manual'), true)

    // invalid key still rejected
    await c.query('SAVEPOINT sp')
    try { await put('WRONG_KEY', [{ bundle_id: 'x', name: 'x', installed: true, source: 'detected' }]); await c.query('RELEASE SAVEPOINT sp'); fail++; console.log('  ✗ invalid key NOT rejected') }
    catch { await c.query('ROLLBACK TO SAVEPOINT sp'); pass++; console.log('  ✓ invalid device key rejected') }
  } finally {
    await c.query('ROLLBACK'); console.log('\nROLLBACK — nothing persisted')
    await c.end()
  }
  console.log(`\n==== DEVICE_APPS FULL-SYNC: ${pass} passed, ${fail} failed ${fail ? '❌' : '✅'} ====`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error('validation error:', e.message); process.exit(1) })

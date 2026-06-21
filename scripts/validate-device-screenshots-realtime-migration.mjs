/**
 * Rolled-back validation of supabase/migrations/20260621140000_device_screenshots_realtime.sql against
 * the LIVE database. Applies the migration in a transaction, asserts device_screenshots is in the
 * supabase_realtime publication + the migration is idempotent, then ALWAYS ROLLBACK. Nothing committed.
 * Run: node scripts/validate-device-screenshots-realtime-migration.mjs
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Client } = require('pg')

function readDatabaseUrl() {
  const raw = readFileSync('server/.env', 'utf8').replace(/^﻿/, '')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+)\s*$/)
    if (m) return m[1].replace(/^["']|["']$/g, '').trim()
  }
  throw new Error('DATABASE_URL not found in server/.env')
}
let pass = 0, fail = 0
const ok = (l) => { pass++; console.log(`  ✓ ${l}`) }
const bad = (l, d = '') => { fail++; console.log(`  ✗ ${l}${d ? ' — ' + d : ''}`) }

async function main() {
  const migration = readFileSync('supabase/migrations/20260621140000_device_screenshots_realtime.sql', 'utf8')
  const c = new Client({ connectionString: readDatabaseUrl(), ssl: { rejectUnauthorized: false }, statement_timeout: 30000 })
  await c.connect()
  console.log('connected — opening rolled-back validation transaction\n')
  const inPub = async () => (await c.query(
    `select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='device_screenshots'`,
  )).rowCount > 0
  try {
    ;(await c.query(`select 1 from pg_publication where pubname='supabase_realtime'`)).rowCount > 0
      ? ok('publication supabase_realtime exists')
      : bad('supabase_realtime publication missing — Realtime not enabled?')
    const before = await inPub()
    console.log(`  (device_screenshots already in publication before apply: ${before ? 'YES' : 'NO'})`)
    await c.query('BEGIN')
    await c.query(migration)
    ;(await inPub()) ? ok('after migration: device_screenshots IS in supabase_realtime') : bad('table not added to publication')
    await c.query(migration) // idempotent (guarded) — must not error
    ok('migration is idempotent (re-run does not error)')
    await c.query('ROLLBACK')
    console.log('\nROLLBACK issued — no changes persisted to the live database')
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    bad('migration threw', e.message)
  } finally {
    await c.end()
  }
  console.log(`\n==== DEVICE_SCREENSHOTS_REALTIME: ${pass} passed, ${fail} failed ${fail ? '❌' : '✅'} ====`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error('validation error:', e.message); process.exit(1) })

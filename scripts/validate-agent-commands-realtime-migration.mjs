/**
 * Rolled-back validation of supabase/migrations/20260628120000_agent_commands_realtime.sql against
 * the LIVE database. Opens ONE transaction, records whether agent_commands is already published,
 * applies the migration, asserts agent_commands is now in `supabase_realtime`, re-applies it (proves
 * idempotency), then ALWAYS ROLLBACK. After rollback it re-checks (outside the txn) that publication
 * membership is unchanged — proving nothing was persisted. Run:
 *   node scripts/validate-agent-commands-realtime-migration.mjs
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
const require = createRequire(pathToFileURL(join(process.cwd(), 'package.json')))
const { Client } = require('pg')

function readDatabaseUrl() {
  const raw = readFileSync('server/.env', 'utf8').replace(/^﻿/, '')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+)\s*$/)
    if (m) return m[1].replace(/^["']|["']$/g, '').trim()
  }
  throw new Error('DATABASE_URL not found in server/.env')
}
const ok = (l) => console.log(`  ✓ ${l}`)
const bad = (l, d) => { console.log(`  ✗ ${l}${d ? ' — ' + d : ''}`); process.exitCode = 1 }
const MIG = 'supabase/migrations/20260628120000_agent_commands_realtime.sql'
const isPublished = async (c) => (await c.query(
  `select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='agent_commands'`)).rowCount > 0

async function main() {
  const sql = readFileSync(MIG, 'utf8')
  const client = new Client({ connectionString: readDatabaseUrl(), ssl: { rejectUnauthorized: false }, statement_timeout: 30000 })
  await client.connect()
  console.log('connected — opening rolled-back validation transaction\n')
  const before = await isPublished(client)
  console.log(`  precondition: agent_commands currently in supabase_realtime = ${before}\n`)
  try {
    await client.query('BEGIN')
    await client.query(sql)
    ok('migration applied inside the transaction (no errors)')
    ;(await isPublished(client)) ? ok('agent_commands is now in supabase_realtime') : bad('agent_commands NOT added to publication')
    await client.query(sql) // idempotency
    ok('re-applying the migration is a no-op (idempotent)')
    ;(await isPublished(client)) ? ok('still published after re-apply') : bad('membership lost on re-apply')
  } finally {
    await client.query('ROLLBACK')
    console.log('\nROLLBACK issued — no changes persisted to the live database')
  }
  const after = await isPublished(client)
  after === before
    ? ok(`post-rollback publication membership unchanged (= ${after})`)
    : bad('publication membership CHANGED after rollback', `before=${before} after=${after}`)
  await client.end()
}
main().catch((e) => { console.error('validation error:', e.message); process.exit(1) })

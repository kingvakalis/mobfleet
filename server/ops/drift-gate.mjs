// FINAL PRODUCTION DRIFT GATE -- mandatory READ-ONLY check run immediately before the approved
// production migration window. It verifies the world still matches the plan and ABORTS on any
// mismatch. It performs NO writes. It never prints connection URLs or credentials.
//
// Modes:
//   node server/ops/drift-gate.mjs --repo-only   -> only the repo/code checks (safe anywhere; no DB).
//   node server/ops/drift-gate.mjs               -> full gate (requires the read-only inputs + acks).
//
// Inputs for the full gate (set only at the production window):
//   RAILWAY_RO_URL    required -- least-privilege READ-ONLY production Railway connection.
//   SUPABASE_RO_URL   required -- READ-ONLY Supabase connection (counts teams/team_members/invites).
//   APPROVED_COMMIT   required -- the reviewed git commit that must equal HEAD.
//   CONFIRM_VITE_AUTH_SOURCE_SUPABASE=1   operator attests prod frontend is still VITE_AUTH_SOURCE=supabase.
//   CONFIRM_VERIFIED_BACKUP=1             operator attests a verified backup/restore point exists.
//   CONFIRM_WRITE_FREEZE=1                operator attests team/onboarding/invite writes are frozen.
//
// It reads the committed audit fixture (step0-production-audit.json) and checksum manifest
// (migration-checksums.json) as the source of truth.

import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const serverDir = join(here, '..')
const migrationsDir = join(serverDir, 'prisma/migrations')
const EXPECTED_ORDER = ['00000000000000_baseline', '20260616110000_reconcile_legacy_objects', '20260616120000_add_migration_mapping_and_audit_schema']

const repoOnly = process.argv.includes('--repo-only')
const problems = []
const ok = []
const note = (cond, label) => { (cond ? ok : problems).push(label) }
const SAFE = (e) => String(e?.message ?? e).replace(/postgres(ql)?:\/\/[^\s]+/gi, '<redacted-url>')

// ---- Repo / code checks (no DB) ----
const activeDirs = readdirSync(migrationsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
note(JSON.stringify(activeDirs) === JSON.stringify(EXPECTED_ORDER), `active migration order == [${EXPECTED_ORDER.join(', ')}]`)

const manifest = JSON.parse(readFileSync(join(here, 'migration-checksums.json'), 'utf8')).migrations
let checksumsMatch = JSON.stringify(Object.keys(manifest).sort()) === JSON.stringify([...EXPECTED_ORDER].sort())
for (const name of EXPECTED_ORDER) {
  try {
    const sum = createHash('sha256').update(readFileSync(join(migrationsDir, name, 'migration.sql'))).digest('hex')
    if (sum !== manifest[name]) checksumsMatch = false
  } catch { checksumsMatch = false }
}
note(checksumsMatch, 'migration SQL checksums match the reviewed manifest')

const head = (() => { const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: serverDir, encoding: 'utf8' }); return (r.stdout ?? '').trim() })()
const approved = process.env.APPROVED_COMMIT
if (repoOnly && !approved) ok.push('deployed commit == APPROVED_COMMIT (skipped in --repo-only without APPROVED_COMMIT)')
else note(!!approved && !!head && head === approved, `deployed commit == APPROVED_COMMIT (HEAD=${head ? head.slice(0, 12) : 'unknown'})`)

if (!repoOnly) {
  // ---- Operator attestations (fail closed) ----
  note(process.env.CONFIRM_VITE_AUTH_SOURCE_SUPABASE === '1', 'attested: production VITE_AUTH_SOURCE=supabase')
  note(process.env.CONFIRM_VERIFIED_BACKUP === '1', 'attested: verified backup/restore point exists')
  note(process.env.CONFIRM_WRITE_FREEZE === '1', 'attested: production write freeze active')

  const railwayRo = process.env.RAILWAY_RO_URL
  const supabaseRo = process.env.SUPABASE_RO_URL
  if (!railwayRo) problems.push('RAILWAY_RO_URL not set (required for the full gate)')
  if (!supabaseRo) problems.push('SUPABASE_RO_URL not set (required for the full gate)')

  await runDbChecks(railwayRo, supabaseRo).catch((e) => problems.push('DB checks errored: ' + SAFE(e)))
}
finish()

async function runDbChecks(railwayRo, supabaseRo) {
  const pg = (await import('pg')).default
  if (railwayRo) {
    const c = new pg.Client({ connectionString: railwayRo })
    await c.connect()
    try {
      await c.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const audit = JSON.parse(readFileSync(join(here, 'step0-production-audit.json'), 'utf8'))
      const tables = (await c.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1`)).rows.map((r) => r.tablename)
      note(JSON.stringify(tables) === JSON.stringify([...audit.tables].sort()), 'Railway tables match audit fixture')
      let allZero = true
      for (const t of tables) { const n = (await c.query(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n; if (n !== 0) allZero = false }
      note(allZero, 'all Railway public tables still have 0 rows')
      const cols = (await c.query(`SELECT table_name, ordinal_position AS p, column_name, data_type, udt_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY 1,2`)).rows
      const cons = (await c.query(`SELECT conrelid::regclass::text AS tbl, conname, CASE contype WHEN 'p' THEN 'primary_key' WHEN 'u' THEN 'unique' WHEN 'f' THEN 'foreign_key' WHEN 'c' THEN 'check' ELSE contype::text END AS type, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE connamespace='public'::regnamespace`)).rows
      const idx = (await c.query(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public'`)).rows
      const fpLive = createHash('sha256').update(JSON.stringify({
        cols: cols.map((r) => [r.table_name, Number(r.p), r.column_name, r.udt_name, r.is_nullable, r.column_default ?? null]).sort(),
        cons: cons.map((r) => [r.tbl, r.conname, r.type, r.def]).sort(),
        idx: idx.map((r) => [r.indexname, r.indexdef]).sort(),
      })).digest('hex')
      const fpAudit = createHash('sha256').update(JSON.stringify({
        cols: audit.columns.map((x) => [x.table, x.position, x.column, x.udt_name, x.is_nullable, x.column_default ?? null]).sort(),
        cons: audit.constraints.map((x) => [x.table, x.name, x.type, x.definition]).sort(),
        idx: audit.indexes.map((x) => [x.name, x.definition]).sort(),
      })).digest('hex')
      note(fpLive === fpAudit, 'Railway schema fingerprint matches step0-production-audit.json')
      const pm = (await c.query(`SELECT to_regclass('public._prisma_migrations')::text AS t`)).rows[0].t
      note(pm === null, '_prisma_migrations remains absent')
      await c.query('ROLLBACK')
    } finally { await c.end() }
  }
  if (supabaseRo) {
    const c = new pg.Client({ connectionString: supabaseRo })
    await c.connect()
    try {
      await c.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const r = (await c.query(`SELECT (SELECT count(*) FROM public.teams) AS teams, (SELECT count(*) FROM public.team_members) AS members, (SELECT count(*) FROM public.team_invites) AS invites`)).rows[0]
      note(Number(r.teams) === 0 && Number(r.members) === 0 && Number(r.invites) === 0, `Supabase business tables empty (teams=${r.teams}, members=${r.members}, invites=${r.invites})`)
      await c.query('ROLLBACK')
    } finally { await c.end() }
  }
}

function finish() {
  console.log('===== DRIFT GATE =====')
  for (const o of ok) console.log(`  ok   ${o}`)
  for (const p of problems) console.log(`  FAIL ${p}`)
  if (problems.length) { console.error(`\nDRIFT GATE: ABORT -- ${problems.length} check(s) failed. Do NOT proceed with the migration.`); process.exit(1) }
  console.log(`\nDRIFT GATE: PASS${repoOnly ? ' (repo-only)' : ''} -- safe to proceed to the next runbook stage.`)
  process.exit(0)
}

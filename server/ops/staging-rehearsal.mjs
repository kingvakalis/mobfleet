// Railway STAGING migration rehearsal -- run by an operator against an ISOLATED staging database.
// It reproduces the exact production cutover sequence and emits REDACTED evidence. It NEVER prints
// connection URLs or credentials, and it REFUSES to run against the production fingerprint.
//
// Inputs (environment; set only for staging -- never production):
//   STAGING_MIGRATION_DATABASE_URL  required -- the staging MIGRATOR role (owns objects, DDL).
//   STAGING_DATABASE_URL            optional -- the staging RUNTIME role (DML only); if set, its
//                                               privileges are checked (must NOT have CREATE on public).
//   PROD_FINGERPRINT_HOST           optional -- production host to forbid (e.g. <id>.proxy.rlwy.net).
//   PROD_FINGERPRINT_DB             optional -- production database name to forbid (e.g. railway).
//                                               If RAILWAY_RO_URL is set, its host/db are ALSO forbidden
//                                               (parsed locally; never connected to).
//
// Preconditions: the staging DB must be FRESH/EMPTY (no baseline tables yet). The script applies the
// committed baseline, verifies parity vs server/ops/step0-production-audit.json, registers the
// baseline, runs `npm run migrate:deploy`, and verifies the completed schema + history.
//
// Usage:  node server/ops/staging-rehearsal.mjs    (from the repo root or server/)

import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))           // server/ops
const serverDir = join(here, '..')                            // server
const auditPath = join(here, 'step0-production-audit.json')
const baselinePath = join(serverDir, 'prisma/migrations/00000000000000_baseline/migration.sql')

const fail = (msg) => { console.error(`ABORT: ${msg}`); process.exit(1) }
const fingerprint = (u) => { try { const x = new URL(u); return `${x.hostname}:${x.port || '5432'}${x.pathname}` } catch { return '(unparseable)' } }
const evidence = {}

const migUrl = process.env.STAGING_MIGRATION_DATABASE_URL
if (!migUrl) fail('STAGING_MIGRATION_DATABASE_URL is required (the staging migrator role).')
const runUrl = process.env.STAGING_DATABASE_URL || null

// ---- Distinctness guard: never run against production ----
const forbidden = []
if (process.env.PROD_FINGERPRINT_HOST) forbidden.push({ host: process.env.PROD_FINGERPRINT_HOST, db: process.env.PROD_FINGERPRINT_DB })
if (process.env.RAILWAY_RO_URL) { try { const r = new URL(process.env.RAILWAY_RO_URL); forbidden.push({ host: r.hostname, db: r.pathname.replace(/^\//, '') }) } catch { /* ignore */ } }
const targets = [migUrl, runUrl].filter(Boolean).map((u) => { const x = new URL(u); return { host: x.hostname, db: x.pathname.replace(/^\//, '') } })
for (const t of targets) for (const f of forbidden) {
  if (f.host && t.host === f.host && (!f.db || t.db === f.db)) fail(`target matches a PRODUCTION fingerprint (${t.host}/${t.db}). Refusing.`)
}
evidence.fingerprints = { staging_migrator: fingerprint(migUrl), staging_runtime: runUrl ? fingerprint(runUrl) : null, forbidden_production: forbidden.map((f) => `${f.host}/${f.db ?? '*'}`) }
console.log(`[rehearsal] staging migrator = ${evidence.fingerprints.staging_migrator}`)
console.log(`[rehearsal] forbidden production = ${JSON.stringify(evidence.fingerprints.forbidden_production)}`)

const SAFE = (e) => String(e?.message ?? e).replace(/postgres(ql)?:\/\/[^\s]+/gi, '<redacted-url>')
function prisma(args, url) {
  const r = spawnSync('npx', ['prisma', ...args], { cwd: serverDir, encoding: 'utf8', env: { ...process.env, DATABASE_URL: url }, shell: process.platform === 'win32' })
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}
function migrateDeploy(url) {
  const r = spawnSync(process.execPath, ['scripts/migrate-deploy.mjs'], { cwd: serverDir, encoding: 'utf8', env: { ...process.env, MIGRATION_DATABASE_URL: url } })
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}
async function withClient(url, fn) { const c = new pg.Client({ connectionString: url }); await c.connect(); try { return await fn(c) } finally { await c.end() } }

const EXPECTED_ORDER = ['00000000000000_baseline', '20260616110000_reconcile_legacy_objects', '20260616120000_add_migration_mapping_and_audit_schema']

async function main() {
  await withClient(migUrl, async (c) => {
    // 2. Fresh/empty precondition + apply baseline.
    const pre = (await c.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'`)).rows[0].n
    if (pre !== 0) fail(`staging public schema is not empty (${pre} tables). Provide a FRESH staging database.`)
    await c.query(readFileSync(baselinePath, 'utf8'))

    // 3 (role) + 2 (parity): verify the migrator role is least-privilege, then parity vs the audit.
    const role = (await c.query(`SELECT current_user AS role, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
      FROM pg_roles WHERE rolname = current_user`)).rows[0]
    const roleOk = !role.rolsuper && !role.rolcreatedb && !role.rolcreaterole && !role.rolreplication && !role.rolbypassrls
      && (await c.query(`SELECT has_schema_privilege(current_user,'public','CREATE') AS c`)).rows[0].c === true
    evidence.migrator_role = { role: role.role, superuser: role.rolsuper, createdb: role.rolcreatedb, createrole: role.rolcreaterole, replication: role.rolreplication, bypassrls: role.rolbypassrls, create_on_public: true }
    if (!roleOk) fail('migrator role is not least-privilege (or lacks CREATE on public).')
    if (runUrl) {
      const rt = await withClient(runUrl, async (rc) => (await rc.query(`SELECT current_user AS role, has_schema_privilege(current_user,'public','CREATE') AS create_public`)).rows[0])
      evidence.runtime_role = { role: rt.role, create_on_public: rt.create_public, distinct_from_migrator: rt.role !== role.role }
      if (rt.create_public) fail('runtime role must NOT have CREATE (DDL) on public.')
      if (rt.role === role.role) fail('runtime role and migrator role must be distinct.')
    }
    await assertBaselineParity(c)
  })

  // 4. One-time bootstrap: register baseline (manual), then the SAME release command.
  const res = prisma(['migrate', 'resolve', '--applied', '00000000000000_baseline', '--schema=prisma/schema.postgres.prisma'], migUrl)
  if (res.code !== 0) fail(`baseline resolve failed: ${res.out.split('\n').slice(-3).join(' ')}`)
  const dep1 = migrateDeploy(migUrl)
  if (dep1.code !== 0) fail('migrate:deploy failed')
  if (dep1.out.includes('@')) { /* never expect creds; redact in evidence */ }
  evidence.deploy_applied = { reconcile: /20260616110000_reconcile_legacy_objects/.test(dep1.out), phase3a: /20260616120000_add_migration_mapping_and_audit_schema/.test(dep1.out) }
  if (!evidence.deploy_applied.reconcile || !evidence.deploy_applied.phase3a) fail('deploy did not apply reconcile + phase3a')
  const dep2 = migrateDeploy(migUrl)
  evidence.second_deploy_noop = dep2.code === 0 && /No pending migrations to apply/i.test(dep2.out)
  if (!evidence.second_deploy_noop) fail('second migrate:deploy was not a no-op')

  // 5. Verify completed schema + history.
  await withClient(migUrl, async (c) => { await assertCompletedSchema(c) })
  const diff = prisma(['migrate', 'diff', '--from-url', migUrl, '--to-schema-datamodel', 'prisma/schema.postgres.prisma', '--exit-code'], migUrl)
  evidence.final_diff_empty = diff.code === 0
  if (!evidence.final_diff_empty) fail(`final Prisma diff is NOT empty: ${diff.out.split('\n').slice(0, 6).join(' | ')}`)

  console.log('\n===== STAGING REHEARSAL EVIDENCE (redacted) =====')
  console.log(JSON.stringify(evidence, null, 2))
  console.log('===== RESULT: PASS =====')
}

async function assertBaselineParity(c) {
  const audit = JSON.parse(readFileSync(auditPath, 'utf8'))
  const tables = (await c.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1`)).rows.map((r) => r.tablename)
  const cols = (await c.query(`SELECT table_name, ordinal_position AS pos, column_name, data_type, udt_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY 1,2`)).rows
  const cons = (await c.query(`SELECT conrelid::regclass::text AS tbl, conname, CASE contype WHEN 'p' THEN 'primary_key' WHEN 'u' THEN 'unique' WHEN 'f' THEN 'foreign_key' WHEN 'c' THEN 'check' ELSE contype::text END AS type, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE connamespace='public'::regnamespace`)).rows
  const idx = (await c.query(`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public'`)).rows
  const norm = (a) => JSON.stringify(a)
  const diffs = []
  if (norm(tables) !== norm([...audit.tables].sort())) diffs.push('tables')
  const ec = new Map(audit.columns.map((x) => [`${x.table}.${x.column}`, x]))
  for (const r of cols) { const e = ec.get(`${r.table_name}.${r.column_name}`); if (!e || e.udt_name !== r.udt_name || e.is_nullable !== r.is_nullable || (e.column_default ?? null) !== (r.column_default ?? null) || e.position !== Number(r.pos)) diffs.push(`col ${r.table_name}.${r.column_name}`) }
  if (cols.length !== audit.columns.length) diffs.push('column count')
  const econ = new Map(audit.constraints.map((x) => [`${x.table}.${x.name}`, x]))
  for (const r of cons) { const e = econ.get(`${r.tbl}.${r.conname}`); if (!e || e.type !== r.type || e.definition !== r.def) diffs.push(`con ${r.conname}`) }
  if (cons.length !== audit.constraints.length) diffs.push('constraint count')
  const eidx = new Map(audit.indexes.map((x) => [x.name, x]))
  for (const r of idx) { const e = eidx.get(r.indexname); if (!e || e.definition !== r.indexdef) diffs.push(`idx ${r.indexname}`) }
  if (idx.length !== audit.indexes.length) diffs.push('index count')
  const counts = {}
  for (const t of tables) counts[t] = (await c.query(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n
  const allEmpty = Object.values(counts).every((n) => n === 0)
  const pmAbsent = (await c.query(`SELECT to_regclass('public._prisma_migrations')::text AS t`)).rows[0].t === null
  evidence.baseline = { tables: tables.length, columns: cols.length, constraints: cons.length, indexes: idx.length, all_empty: allEmpty, prisma_migrations_absent: pmAbsent, differences: diffs }
  if (diffs.length) fail(`baseline parity differences vs audit: ${diffs.join(', ')}`)
  if (!allEmpty) fail('baseline tables are not all empty')
  if (!pmAbsent) fail('_prisma_migrations must be absent before baseline registration')
}

async function assertCompletedSchema(c) {
  // Exclude Prisma's own bookkeeping table -- it is not one of the 15 application models.
  const tabs = (await c.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY 1`)).rows.map((r) => r.tablename)
  const want15 = ['AgentCommand', 'AuditLog', 'Automation', 'Device', 'DeviceApiKey', 'DevicePairingToken', 'DeviceSession', 'Invite', 'Job', 'Membership', 'MigrationRecord', 'Proxy', 'Team', 'TeamEmailSettings', 'User']
  const has = (t, col) => c.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`, [t, col]).then((r) => r.rowCount > 0)
  const conDef = (name) => c.query(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname=$1`, [name]).then((r) => r.rows[0]?.d ?? '')
  const idxNames = (await c.query(`SELECT indexname FROM pg_indexes WHERE schemaname='public'`)).rows.map((r) => r.indexname)
  const conNames = (await c.query(`SELECT conname FROM pg_constraint WHERE connamespace='public'::regnamespace`)).rows.map((r) => r.conname)
  const inviteNullable = (await c.query(`SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='Invite' AND column_name='invitedByUserId'`)).rows[0].is_nullable === 'YES'
  const inviteFk = await conDef('Invite_invitedByUserId_fkey')
  const hist = (await c.query(`SELECT migration_name, finished_at, rolled_back_at, applied_steps_count FROM "_prisma_migrations" ORDER BY started_at`)).rows
  const histNames = hist.map((r) => r.migration_name)
  // Clean = finished and not rolled back. (The baseline row, registered via `migrate resolve
  // --applied`, legitimately has applied_steps_count = 0; deployed migrations have >= 1.)
  const historyClean = hist.every((r) => r.finished_at !== null && r.rolled_back_at === null)

  const want = {
    fifteen_tables: JSON.stringify(tabs) === JSON.stringify(want15),
    membership_overrides: await has('Membership', 'overrides'),
    team_supabaseTeamId: await has('Team', 'supabaseTeamId'),
    team_supabaseTeamId_unique: idxNames.includes('Team_supabaseTeamId_key'),
    team_archivedAt: await has('Team', 'archivedAt'),
    invite_invitedByUserId_nullable: inviteNullable,
    invite_fk_set_null: /ON DELETE SET NULL/.test(inviteFk) && /ON UPDATE CASCADE/.test(inviteFk),
    agentcommand_ok: conNames.includes('AgentCommand_pkey') && conNames.includes('AgentCommand_teamId_fkey') && idxNames.includes('AgentCommand_teamId_deviceId_status_idx'),
    devicesession_ok: conNames.includes('DeviceSession_pkey') && conNames.includes('DeviceSession_teamId_fkey') && idxNames.includes('DeviceSession_deviceId_startedAt_idx') && idxNames.includes('DeviceSession_teamId_startedAt_idx'),
    teamemailsettings_ok: conNames.includes('TeamEmailSettings_pkey') && conNames.includes('TeamEmailSettings_teamId_fkey') && idxNames.includes('TeamEmailSettings_teamId_key'),
    migrationrecord_ok: conNames.includes('MigrationRecord_pkey') && idxNames.includes('MigrationRecord_batchId_idx') && idxNames.includes('MigrationRecord_entity_prismaId_idx'),
    history_exactly_three: JSON.stringify(histNames) === JSON.stringify(EXPECTED_ORDER),
    history_clean: historyClean,
  }
  evidence.completed_schema = want
  evidence.migration_history = histNames
  const failures = Object.entries(want).filter(([, v]) => !v).map(([k]) => k)
  if (failures.length) fail(`completed-schema checks failed: ${failures.join(', ')}`)
}

main().catch((e) => fail(SAFE(e)))

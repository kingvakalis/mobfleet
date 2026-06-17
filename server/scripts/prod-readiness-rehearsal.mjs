// 4th-migration production-readiness REHEARSAL — fully offline, fully disposable.
//
// Boots a throwaway embedded PostgreSQL cluster (no host Postgres, no network, no
// managed/production DB) and proves the `20260617120000_add_team_notification_prefs`
// release is safe two ways:
//
//   SCENARIO A (fresh database):
//     - `prisma migrate deploy` applies ALL FOUR committed migrations cleanly.
//     - A SECOND `prisma migrate deploy` is a NO-OP ("No pending migrations to apply").
//     - `prisma migrate diff --exit-code` (live DB vs schema datamodel) is EMPTY.
//
//   SCENARIO B (prod-shaped — data already exists before the 4th migration):
//     - Apply ONLY the first 3 migrations (the shape production is on today).
//     - Seed real Team rows (the additive column does not exist yet).
//     - Apply ONLY the 4th migration.
//     - The seeded rows SURVIVE and their new notificationPrefs is NULL (NULL == all
//       defaults; no backfill needed, running server unaffected).
//     - `prisma migrate diff --exit-code` is EMPTY.
//
// SAFETY: never connects to anything but the embedded cluster it owns; refuses if
// DATABASE_URL / MIGRATION_DATABASE_URL point anywhere non-local; sets its OWN
// DATABASE_URL for the prisma child processes; deletes the data dir on exit. It runs
// NO `db push`, no `--accept-data-loss`, no resolve against a real DB. Read-only of
// the committed migration files; mutates only the disposable cluster.
//
// Usage:  node scripts/prod-readiness-rehearsal.mjs        (from server/)

import { readFileSync, readdirSync, mkdtempSync, rmSync, mkdirSync, cpSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import EmbeddedPostgres from 'embedded-postgres'

const here = dirname(fileURLToPath(import.meta.url)) // server/scripts
const serverDir = join(here, '..') // server
const migrationsDir = join(serverDir, 'prisma/migrations')
const schemaPath = join(serverDir, 'prisma/schema.postgres.prisma')
const checksumsPath = join(serverDir, 'ops/migration-checksums.json')

const fail = (msg) => { console.error(`\nABORT: ${msg}`); process.exitCode = 1; throw new RehearsalAbort(msg) }
class RehearsalAbort extends Error {}
const log = (m) => console.log(`[rehearsal] ${m}`)
const SAFE = (e) => String(e?.message ?? e).replace(/postgres(ql)?:\/\/[^\s]+/gi, '<redacted-url>')

const EXPECTED_ORDER = [
  '00000000000000_baseline',
  '20260616110000_reconcile_legacy_objects',
  '20260616120000_add_migration_mapping_and_audit_schema',
  '20260617120000_add_team_notification_prefs',
]
const FOURTH = '20260617120000_add_team_notification_prefs'
const PORT = 59187 // high, fixed, local-only port for the disposable cluster
const PASS = 'rehearsal_disposable'

const evidence = { scenario_A: {}, scenario_B: {}, preflight: {} }

// ── Guard: never let a real/managed DB leak into this rehearsal ──────────────────
// We set DATABASE_URL ourselves, but if the operator exported one pointing at a real
// DB, refuse rather than risk a prisma child inheriting it.
for (const k of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'TEST_DATABASE_URL']) {
  const v = process.env[k]
  if (v && !/^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost|::1)[:/]/i.test(v)) {
    console.error(`ABORT: ${k} is set to a NON-local target. Unset it before the rehearsal (it must never touch a real DB).`)
    process.exit(1)
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────────
function sha256(p) { return createHash('sha256').update(readFileSync(p)).digest('hex') }

/** Run prisma against a specific migrations dir + DATABASE_URL. Returns {code,out}. */
function prisma(args, dbUrl, migDirOverride) {
  const env = { ...process.env, DATABASE_URL: dbUrl }
  // Prisma reads the schema's `migrations` location relative to the schema dir, so to
  // apply a SUBSET we temporarily point prisma at a schema whose folder holds only
  // the desired migrations (see stageSchema). args already carry --schema.
  const r = spawnSync('npx', ['prisma', ...args], {
    cwd: migDirOverride ?? serverDir, encoding: 'utf8', env, shell: process.platform === 'win32',
  })
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

/**
 * Build a disposable schema dir containing schema.postgres.prisma + a migrations/
 * folder holding ONLY `names` (in order) + the committed migration_lock.toml. Returns
 * the path to the staged schema file. Lets us deploy an exact subset of migrations.
 */
function stageSchema(names) {
  const root = mkdtempSync(join(tmpdir(), 'rehearsal-schema-'))
  const migOut = join(root, 'migrations')
  mkdirSync(migOut)
  const lock = join(migrationsDir, 'migration_lock.toml')
  if (existsSync(lock)) cpSync(lock, join(migOut, 'migration_lock.toml'))
  for (const n of names) cpSync(join(migrationsDir, n), join(migOut, n), { recursive: true })
  const schemaOut = join(root, 'schema.postgres.prisma')
  cpSync(schemaPath, schemaOut)
  return { schemaOut, root }
}

async function withFreshCluster(fn) {
  const dataDir = mkdtempSync(join(tmpdir(), 'rehearsal-pg-'))
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir, port: PORT, user: 'postgres', password: PASS,
    persistent: false, onLog: () => {}, onError: () => {},
  })
  await pg.initialise()
  await pg.start()
  const dbName = 'rehearsal'
  await pg.createDatabase(dbName)
  const url = `postgresql://postgres:${PASS}@127.0.0.1:${PORT}/${dbName}`
  const client = pg.getPgClient(dbName)
  await client.connect()
  try {
    return await fn({ url, client })
  } finally {
    try { await client.end() } catch { /* noop */ }
    try { await pg.stop() } catch { /* noop */ }
    try { rmSync(dataDir, { recursive: true, force: true }) } catch { /* noop */ }
  }
}

const tableCount = async (c) => (await c.query(`SELECT count(*)::int n FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`)).rows[0].n
const histNames = async (c) => (await c.query(`SELECT migration_name FROM "_prisma_migrations" ORDER BY started_at`)).rows.map((r) => r.migration_name)
const hasColumn = async (c, t, col) => (await c.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`, [t, col])).rowCount > 0

// ── PREFLIGHT: assert the 4th migration is EXACTLY the additive column ────────────
function preflight() {
  // (a) the four migrations exist in the expected lexical order.
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name).sort()
  if (JSON.stringify(dirs) !== JSON.stringify(EXPECTED_ORDER)) {
    fail(`migration dirs != expected order. got ${JSON.stringify(dirs)}`)
  }
  // (b) the 4th migration body contains ONLY the additive ALTER TABLE ... ADD COLUMN.
  const sql = readFileSync(join(migrationsDir, FOURTH, 'migration.sql'), 'utf8')
  const statements = sql
    .split('\n').map((l) => l.replace(/--.*$/, '')).join('\n') // strip line comments
    .split(';').map((s) => s.trim()).filter(Boolean)
  evidence.preflight.fourth_statements = statements
  if (statements.length !== 1) fail(`4th migration must be a SINGLE statement; found ${statements.length}: ${JSON.stringify(statements)}`)
  const stmt = statements[0].replace(/\s+/g, ' ')
  const ok = /^ALTER TABLE "Team" ADD COLUMN +"notificationPrefs" JSONB$/i.test(stmt)
  evidence.preflight.fourth_is_additive_only = ok
  evidence.preflight.fourth_normalized = stmt
  if (!ok) fail(`4th migration is NOT a sole additive JSONB column. normalized = "${stmt}"`)
  // No destructive verbs anywhere (defense in depth).
  if (/\b(DROP|TRUNCATE|DELETE|UPDATE|ALTER COLUMN|RENAME|NOT NULL|DEFAULT)\b/i.test(sql)) {
    fail('4th migration contains a forbidden/destructive or non-additive keyword')
  }
  // (c) checksum manifest matches the live files for all four migrations.
  const manifest = JSON.parse(readFileSync(checksumsPath, 'utf8')).migrations
  const mismatches = []
  for (const n of EXPECTED_ORDER) {
    const live = sha256(join(migrationsDir, n, 'migration.sql'))
    if (manifest[n] !== live) mismatches.push(n)
  }
  evidence.preflight.checksums_match = mismatches.length === 0
  if (mismatches.length) fail(`checksum manifest mismatch (CRLF? re-hash on LF): ${mismatches.join(', ')}`)
  log('preflight OK — 4th migration is additive-only; checksums match; order correct')
}

// ── SCENARIO A: fresh → all 4 apply, 2nd deploy no-op, diff empty ────────────────
async function scenarioA() {
  log('SCENARIO A: fresh database')
  await withFreshCluster(async ({ url, client }) => {
    const dep1 = prisma(['migrate', 'deploy', `--schema=${schemaPath}`], url)
    evidence.scenario_A.first_deploy_code = dep1.code
    if (dep1.code !== 0) fail(`A: first migrate deploy failed:\n${dep1.out}`)
    const applied = await histNames(client)
    evidence.scenario_A.history = applied
    evidence.scenario_A.all_four_applied = JSON.stringify(applied) === JSON.stringify(EXPECTED_ORDER)
    if (!evidence.scenario_A.all_four_applied) fail(`A: history != 4 expected migrations. got ${JSON.stringify(applied)}`)

    evidence.scenario_A.team_notificationPrefs_exists = await hasColumn(client, 'Team', 'notificationPrefs')
    if (!evidence.scenario_A.team_notificationPrefs_exists) fail('A: Team.notificationPrefs column missing after deploy')

    const dep2 = prisma(['migrate', 'deploy', `--schema=${schemaPath}`], url)
    evidence.scenario_A.second_deploy_noop = dep2.code === 0 && /No pending migrations to apply/i.test(dep2.out)
    if (!evidence.scenario_A.second_deploy_noop) fail(`A: second deploy was not a clean no-op:\n${dep2.out}`)

    const diff = prisma(['migrate', 'diff', '--from-url', url, '--to-schema-datamodel', schemaPath, '--exit-code'], url)
    evidence.scenario_A.diff_empty = diff.code === 0
    if (!evidence.scenario_A.diff_empty) fail(`A: prisma diff NOT empty (exit ${diff.code}):\n${diff.out}`)
    log('SCENARIO A: PASS')
  })
}

// ── SCENARIO B: prod-shaped → 3 migrations + data, then only the 4th ─────────────
async function scenarioB() {
  log('SCENARIO B: prod-shaped (data exists before the 4th migration)')
  const first3 = EXPECTED_ORDER.slice(0, 3)
  const staged3 = stageSchema(first3)
  const stagedAll = stageSchema(EXPECTED_ORDER)
  try {
    await withFreshCluster(async ({ url, client }) => {
      // 1) apply ONLY the first three migrations (today's production shape).
      const dep3 = prisma(['migrate', 'deploy', `--schema=${staged3.schemaOut}`], url)
      evidence.scenario_B.first3_deploy_code = dep3.code
      if (dep3.code !== 0) fail(`B: deploy of first 3 failed:\n${dep3.out}`)
      const h3 = await histNames(client)
      evidence.scenario_B.history_after_3 = h3
      if (JSON.stringify(h3) !== JSON.stringify(first3)) fail(`B: expected exactly first 3 applied, got ${JSON.stringify(h3)}`)
      // The additive column must NOT exist yet (prod's current shape).
      const colBefore = await hasColumn(client, 'Team', 'notificationPrefs')
      evidence.scenario_B.column_absent_before_4th = !colBefore
      if (colBefore) fail('B: notificationPrefs unexpectedly present before the 4th migration')

      // 2) seed real Team rows (no notificationPrefs column yet).
      const t1 = `team_${Date.now()}_a`
      const t2 = `team_${Date.now()}_b`
      await client.query(`INSERT INTO "Team" (id, name, "createdAt") VALUES ($1,$2,$3),($4,$5,$6)`,
        [t1, 'Rehearsal Alpha', Date.now(), t2, 'Rehearsal Beta', Date.now()])
      const seeded = (await client.query(`SELECT count(*)::int n FROM "Team"`)).rows[0].n
      evidence.scenario_B.seeded_team_rows = seeded
      if (seeded !== 2) fail(`B: expected 2 seeded teams, found ${seeded}`)

      // 3) apply ONLY the 4th migration (deploy of the full set now applies just the pending one).
      const dep4 = prisma(['migrate', 'deploy', `--schema=${stagedAll.schemaOut}`], url)
      evidence.scenario_B.fourth_deploy_code = dep4.code
      if (dep4.code !== 0) fail(`B: deploy of the 4th migration failed:\n${dep4.out}`)
      const applied4thOnly = /1 migration/i.test(dep4.out) || new RegExp(FOURTH).test(dep4.out)
      evidence.scenario_B.fourth_was_the_only_pending = applied4thOnly
      const hAll = await histNames(client)
      evidence.scenario_B.history_after_4 = hAll
      if (JSON.stringify(hAll) !== JSON.stringify(EXPECTED_ORDER)) fail(`B: history != all 4 after 4th. got ${JSON.stringify(hAll)}`)

      // 4) rows survived, column exists, and old rows have NULL notificationPrefs.
      const after = await client.query(`SELECT id, "notificationPrefs" FROM "Team" ORDER BY id`)
      evidence.scenario_B.rows_after = after.rowCount
      if (after.rowCount !== 2) fail(`B: seeded rows did NOT survive the 4th migration (found ${after.rowCount})`)
      const allNull = after.rows.every((r) => r.notificationPrefs === null)
      evidence.scenario_B.old_rows_notificationPrefs_all_null = allNull
      if (!allNull) fail('B: old rows did not have NULL notificationPrefs after the additive migration')
      // Column proven WRITABLE (so the running server's reads/writes work post-release).
      await client.query(`UPDATE "Team" SET "notificationPrefs" = $1::jsonb WHERE id = $2`,
        [JSON.stringify({ teamInvitesEnabled: true }), t1])
      const w = (await client.query(`SELECT "notificationPrefs" FROM "Team" WHERE id=$1`, [t1])).rows[0].notificationPrefs
      evidence.scenario_B.column_writable = w && w.teamInvitesEnabled === true

      // 5) final diff empty (live DB == schema datamodel).
      const diff = prisma(['migrate', 'diff', '--from-url', url, '--to-schema-datamodel', schemaPath, '--exit-code'], url)
      evidence.scenario_B.diff_empty = diff.code === 0
      if (!evidence.scenario_B.diff_empty) fail(`B: prisma diff NOT empty (exit ${diff.code}):\n${diff.out}`)
      log('SCENARIO B: PASS')
    })
  } finally {
    try { rmSync(staged3.root, { recursive: true, force: true }) } catch { /* noop */ }
    try { rmSync(stagedAll.root, { recursive: true, force: true }) } catch { /* noop */ }
  }
}

async function main() {
  preflight()
  await scenarioA()
  await scenarioB()
  console.log('\n===== PROD-READINESS REHEARSAL EVIDENCE (redacted) =====')
  console.log(JSON.stringify(evidence, null, 2))
  console.log('===== RESULT: PASS =====')
}

main().catch((e) => {
  if (!(e instanceof RehearsalAbort)) console.error(SAFE(e))
  console.log('\n===== REHEARSAL EVIDENCE (partial) =====')
  console.log(JSON.stringify(evidence, null, 2))
  console.log('===== RESULT: FAIL =====')
  process.exit(1)
})

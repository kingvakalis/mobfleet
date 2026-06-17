import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Pure guard (no DB) for the active migration lineage after Checkpoint 2:
//   1. 00000000000000_baseline
//   2. 20260616110000_reconcile_legacy_objects
//   3. 20260616120000_add_migration_mapping_and_audit_schema  (Phase 3A, unchanged)
// Also asserts the 5 SQLite-era migrations are archived out of the active dir, and that the
// reconcile migration is Postgres-dialect, additive-only, and stays in its lane (no Phase 3A objects).

const migrationsDir = fileURLToPath(new URL('../../prisma/migrations', import.meta.url))
const legacyDir = fileURLToPath(new URL('../../prisma/migrations_legacy_sqlite', import.meta.url))

const ACTIVE_ORDER = [
  '00000000000000_baseline',
  '20260616110000_reconcile_legacy_objects',
  '20260616120000_add_migration_mapping_and_audit_schema',
]
const ARCHIVED = [
  '20260611155542_init',
  '20260611222859_init',
  '20260615120000_add_team_email_settings',
  '20260615130000_add_device_sessions',
  '20260615140000_add_agent_command_result',
]

const dirsIn = (p: string): string[] =>
  readdirSync(p).filter((n) => { try { return statSync(`${p}/${n}`).isDirectory() } catch { return false } }).sort()

test('active migrations apply in exactly the audited order (baseline -> reconcile -> phase3a)', () => {
  assert.deepEqual(dirsIn(migrationsDir), ACTIVE_ORDER)
  // Prisma applies migrations in lexicographic directory order -> assert that order matches intent.
  assert.deepEqual([...ACTIVE_ORDER].sort(), ACTIVE_ORDER, 'lexical order == intended order')
})

test('the 5 SQLite-era migrations are archived, not active', () => {
  const active = new Set(dirsIn(migrationsDir))
  for (const a of ARCHIVED) assert.ok(!active.has(a), `${a} must NOT be in the active migrations dir`)
  assert.deepEqual(dirsIn(legacyDir), [...ARCHIVED].sort(), 'all 5 legacy migrations are archived')
})

test('reconcile migration: Postgres dialect, additive-only, stays in its lane', () => {
  const sql = readFileSync(`${migrationsDir}/20260616110000_reconcile_legacy_objects/migration.sql`, 'utf8')
  // Executable SQL only (strip "-- ..." comment lines) for the negative / lane scans.
  const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  // Adds exactly the intended objects.
  for (const needle of [
    'CREATE TABLE "AgentCommand"', 'CREATE TABLE "DeviceSession"', 'CREATE TABLE "TeamEmailSettings"',
    'ALTER TABLE "Membership" ADD COLUMN "overrides" JSONB',
    '"result" JSONB', // AgentCommand.result present from the start
    'CONSTRAINT "AgentCommand_pkey" PRIMARY KEY ("teamId", "id")',
    'CREATE UNIQUE INDEX "TeamEmailSettings_teamId_key"',
    'ON DELETE CASCADE ON UPDATE CASCADE',
  ]) assert.ok(code.includes(needle), `reconcile must include: ${needle}`)
  // Postgres dialect, not SQLite.
  assert.ok(code.includes('DOUBLE PRECISION') && code.includes('JSONB'), 'uses Postgres types')
  assert.ok(!/\bREAL\b/.test(code) && !/AUTOINCREMENT/i.test(code) && !/WITHOUT ROWID/i.test(code), 'no SQLite syntax')
  // Additive only -- no destructive / data-loss operations.
  for (const forbidden of ['DROP TABLE', 'DROP COLUMN', 'DROP CONSTRAINT', 'TRUNCATE', 'accept-data-loss', 'DELETE FROM']) {
    assert.ok(!code.toUpperCase().includes(forbidden.toUpperCase()), `reconcile must NOT contain: ${forbidden}`)
  }
  // Stays in its lane -- Phase 3A objects must NOT appear in executable reconcile SQL.
  for (const phase3a of ['supabaseTeamId', 'archivedAt', 'MigrationRecord', 'DROP NOT NULL', 'SET NULL']) {
    assert.ok(!code.includes(phase3a), `Phase 3A object must NOT be in reconcile: ${phase3a}`)
  }
})

test('Phase 3A migration remains present and unchanged in its lane (owns the 3A objects)', () => {
  const sql = readFileSync(`${migrationsDir}/20260616120000_add_migration_mapping_and_audit_schema/migration.sql`, 'utf8')
  for (const needle of [
    'ADD COLUMN     "supabaseTeamId" TEXT', 'ADD COLUMN     "archivedAt" DOUBLE PRECISION',
    'CREATE TABLE "MigrationRecord"', 'ALTER COLUMN "invitedByUserId" DROP NOT NULL',
    'ON DELETE SET NULL ON UPDATE CASCADE',
  ]) assert.ok(sql.includes(needle), `Phase 3A must still own: ${needle}`)
})

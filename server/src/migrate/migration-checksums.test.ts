import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

// Pure guard: the committed checksum manifest (ops/migration-checksums.json) must match the live
// active migration files exactly. The production drift gate compares the same way, so this keeps
// the reviewed manifest in sync -- any unreviewed edit to a migration.sql fails CI here.

const migrationsDir = fileURLToPath(new URL('../../prisma/migrations', import.meta.url))
const manifestPath = fileURLToPath(new URL('../../ops/migration-checksums.json', import.meta.url))
const EXPECTED_ORDER = ['00000000000000_baseline', '20260616110000_reconcile_legacy_objects', '20260616120000_add_migration_mapping_and_audit_schema', '20260617120000_add_team_notification_prefs']

test('migration-checksums.json lists exactly the active migrations, in order', () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { migrations: Record<string, string> }
  assert.deepEqual(Object.keys(manifest.migrations), EXPECTED_ORDER)
})

test('each active migration.sql matches its committed sha256', () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { migrations: Record<string, string> }
  const dirs = readdirSync(migrationsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
  assert.deepEqual(dirs, EXPECTED_ORDER, 'active migration dirs == expected order')
  for (const name of EXPECTED_ORDER) {
    const sum = createHash('sha256').update(readFileSync(`${migrationsDir}/${name}/migration.sql`)).digest('hex')
    assert.equal(sum, manifest.migrations[name], `${name} sha256 matches the manifest`)
  }
})

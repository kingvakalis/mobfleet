import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

// Pure guard: the committed checksum manifest (ops/migration-checksums.json) must match the live
// active migration files exactly. The production drift gate compares the same way, so this keeps
// the reviewed manifest in sync -- any unreviewed edit to a migration.sql fails CI here.
//
// The checksum is LINE-ENDING AGNOSTIC: CR bytes are stripped before hashing, so a Windows (CRLF)
// and a Linux (LF) checkout of the SAME bytes produce the SAME digest (deterministic across
// platforms). A real content change still changes the digest, so tampering still fails the guard.

const migrationsDir = fileURLToPath(new URL('../../prisma/migrations', import.meta.url))
const manifestPath = fileURLToPath(new URL('../../ops/migration-checksums.json', import.meta.url))
const EXPECTED_ORDER = ['00000000000000_baseline', '20260616110000_reconcile_legacy_objects', '20260616120000_add_migration_mapping_and_audit_schema', '20260617120000_add_team_notification_prefs']

/** Deterministic, EOL-agnostic sha256 of a migration file: strip CR (0x0d) bytes so
 *  the digest is identical whether the file was checked out CRLF or LF. Byte-exact
 *  equivalent of `tr -d '\r' | sha256sum`. Manifest values are the LF-normalized hashes. */
export function migrationChecksum(buf: Buffer): string {
  const lf = Buffer.from(buf.filter((b) => b !== 0x0d))
  return createHash('sha256').update(lf).digest('hex')
}

const readMigration = (name: string): Buffer => readFileSync(`${migrationsDir}/${name}/migration.sql`)

test('migration-checksums.json lists exactly the active migrations, in order', () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { migrations: Record<string, string> }
  assert.deepEqual(Object.keys(manifest.migrations), EXPECTED_ORDER)
})

test('each active migration.sql matches its committed (LF-normalized) sha256', () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { migrations: Record<string, string> }
  const dirs = readdirSync(migrationsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
  assert.deepEqual(dirs, EXPECTED_ORDER, 'active migration dirs == expected order')
  for (const name of EXPECTED_ORDER) {
    assert.equal(migrationChecksum(readMigration(name)), manifest.migrations[name], `${name} sha256 matches the manifest`)
  }
})

test('checksum is line-ending agnostic but content-sensitive', () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { migrations: Record<string, string> }
  const name = EXPECTED_ORDER[0]
  const lf = readMigration(name).toString('latin1').replace(/\r/g, '')
  const crlf = lf.replace(/\n/g, '\r\n')
  // Same content, different EOLs → identical digest (deterministic across platforms).
  assert.equal(
    migrationChecksum(Buffer.from(crlf, 'latin1')),
    migrationChecksum(Buffer.from(lf, 'latin1')),
    'CRLF and LF of identical content must hash equally',
  )
  assert.equal(migrationChecksum(Buffer.from(lf, 'latin1')), manifest.migrations[name])
  // A real content change → different digest (a tampered migration still fails the guard).
  assert.notEqual(
    migrationChecksum(Buffer.from(lf + '\n-- tampered\n', 'latin1')),
    manifest.migrations[name],
    'a content change must change the digest',
  )
})

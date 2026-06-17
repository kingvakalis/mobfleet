import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
import { itSkip, testDb } from '../it-support'
import { assertTargetReadOnly, inspectRoleReadOnly, prismaSqlRunner, TARGET_ROLE_OPTS } from './preflight'

// PostgreSQL integration tests for the hardened least-privilege read-only pre-flight (rule 5).
// Proves it REFUSES a writer/superuser and PASSES a fully locked-down SELECT-only role.
// Run via `npm run test:it`; skips when TEST_DATABASE_URL is unset.

test('preflight: REFUSES a writer/superuser connection (and enumerates violations)', { skip: itSkip }, async () => {
  await assert.rejects(assertTargetReadOnly(testDb()), /least-privilege read-only/)
  const proof = await inspectRoleReadOnly(prismaSqlRunner(testDb()), TARGET_ROLE_OPTS)
  assert.equal(proof.isSuperuser, true)
  assert.ok(proof.violations.length > 0)
})

test('preflight: PASSES a least-privilege read-only role (full matrix)', { skip: itSkip }, async () => {
  const su = testDb()
  const url = new URL(process.env.TEST_DATABASE_URL!)
  const db = url.pathname.slice(1)
  await su.$executeRawUnsafe('DROP ROLE IF EXISTS mf_ro_test')
  await su.$executeRawUnsafe("CREATE ROLE mf_ro_test LOGIN PASSWORD 'ro' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT")
  await su.$executeRawUnsafe(`GRANT CONNECT ON DATABASE "${db}" TO mf_ro_test`)
  await su.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO mf_ro_test')
  await su.$executeRawUnsafe('GRANT SELECT ON ALL TABLES IN SCHEMA public TO mf_ro_test')
  await su.$executeRawUnsafe('ALTER ROLE mf_ro_test SET default_transaction_read_only = on')

  const roUrl = new URL(url.toString())
  roUrl.username = 'mf_ro_test'
  roUrl.password = 'ro'
  const ro = new PrismaClient({ datasources: { db: { url: roUrl.toString() } } })
  try {
    const proof = await assertTargetReadOnly(ro)
    assert.equal(proof.role, 'mf_ro_test')
    assert.deepEqual(proof.violations, [])
    assert.equal(proof.isSuperuser, false)
    assert.equal(proof.canCreateDb, false)
    assert.equal(proof.canCreateRole, false)
    assert.equal(proof.isReplication, false)
    assert.equal(proof.bypassRls, false)
    assert.equal(proof.isDatabaseOwner, false)
    assert.deepEqual(proof.ownedSchemas, [])
    assert.deepEqual(proof.ownedTables, [])
    assert.deepEqual(proof.schemasWithCreate, [])
    assert.deepEqual(proof.tablesWritable, [])
    assert.equal(proof.canCreateOnDatabase, false)
    assert.equal(proof.memberOfPrivilegedRoleCount, 0)
    assert.equal(proof.defaultTransactionReadOnly, 'on')
  } finally {
    await ro.$disconnect()
    await su.$executeRawUnsafe('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM mf_ro_test').catch(() => {})
    await su.$executeRawUnsafe('REVOKE ALL ON SCHEMA public FROM mf_ro_test').catch(() => {})
    await su.$executeRawUnsafe(`REVOKE ALL ON DATABASE "${db}" FROM mf_ro_test`).catch(() => {})
    await su.$executeRawUnsafe('ALTER ROLE mf_ro_test RESET default_transaction_read_only').catch(() => {})
    await su.$executeRawUnsafe('DROP ROLE IF EXISTS mf_ro_test').catch(() => {})
  }
})

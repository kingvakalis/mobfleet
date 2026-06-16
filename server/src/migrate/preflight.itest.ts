import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
import { itSkip, testDb } from '../it-support'
import { assertTargetReadOnly } from './preflight'

// PostgreSQL integration tests for the target read-only pre-flight (rule 5). Proves the guard
// REFUSES a writer/superuser connection and PASSES a least-privilege SELECT-only role.
// Run via `npm run test:it`; skips when TEST_DATABASE_URL is unset.

test('assertTargetReadOnly: REFUSES a writer/superuser connection', { skip: itSkip }, async () => {
  // The test DB role is a superuser (has write privileges) -> the guard must abort.
  await assert.rejects(assertTargetReadOnly(testDb()), /least-privilege read-only/)
})

test('assertTargetReadOnly: PASSES a least-privilege read-only role (SELECT only)', { skip: itSkip }, async () => {
  const su = testDb()
  const url = new URL(process.env.TEST_DATABASE_URL!)
  const db = url.pathname.slice(1)
  await su.$executeRawUnsafe('DROP ROLE IF EXISTS mf_ro_test')
  await su.$executeRawUnsafe("CREATE ROLE mf_ro_test LOGIN PASSWORD 'ro'")
  await su.$executeRawUnsafe(`GRANT CONNECT ON DATABASE "${db}" TO mf_ro_test`)
  await su.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO mf_ro_test')
  await su.$executeRawUnsafe('GRANT SELECT ON ALL TABLES IN SCHEMA public TO mf_ro_test')

  const roUrl = new URL(url.toString())
  roUrl.username = 'mf_ro_test'
  roUrl.password = 'ro'
  const ro = new PrismaClient({ datasources: { db: { url: roUrl.toString() } } })
  try {
    const proof = await assertTargetReadOnly(ro)
    assert.equal(proof.currentUser, 'mf_ro_test')
    assert.equal(proof.canInsert, false)
    assert.equal(proof.canUpdate, false)
    assert.equal(proof.canDelete, false)
    assert.equal(proof.canCreate, false)
  } finally {
    await ro.$disconnect()
    await su.$executeRawUnsafe('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM mf_ro_test').catch(() => {})
    await su.$executeRawUnsafe('REVOKE ALL ON SCHEMA public FROM mf_ro_test').catch(() => {})
    await su.$executeRawUnsafe(`REVOKE ALL ON DATABASE "${db}" FROM mf_ro_test`).catch(() => {})
    await su.$executeRawUnsafe('DROP ROLE IF EXISTS mf_ro_test').catch(() => {})
  }
})

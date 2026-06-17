import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
import { resolveMeState } from './auth/db'
import { itSkip, testDb, resetDb, seedUser, seedMembership } from './it-support'

// PostgreSQL integration tests for resolveMeState (the DB side of /v1/me). Run via
// `npm run test:it`; skips when TEST_DATABASE_URL is unset.

test('resolveMeState: no membership → onboarding (no team, no invite)', { skip: itSkip }, async () => {
  const db = testDb(); await resetDb(db)
  const u = await seedUser(db)
  const { classification, pendingInvite } = await resolveMeState(u, undefined, db)
  assert.equal(classification.status, 'onboarding')
  assert.equal(pendingInvite, null)
})

test('resolveMeState: active membership → ready (role + team resolved from DB)', { skip: itSkip }, async () => {
  const db = testDb(); await resetDb(db)
  const u = await seedUser(db)
  const { team } = await seedMembership(db, u.id, { teamName: 'Ops', role: 'admin', status: 'active' })
  const { classification } = await resolveMeState(u, undefined, db)
  assert.equal(classification.status, 'ready')
  if (classification.status === 'ready') {
    assert.equal(classification.chosen.teamId, team.id)
    assert.equal(classification.chosen.role, 'admin')
    assert.equal(classification.chosen.team.name, 'Ops')
  }
})

test('resolveMeState: only a suspended membership → suspended', { skip: itSkip }, async () => {
  const db = testDb(); await resetDb(db)
  const u = await seedUser(db)
  await seedMembership(db, u.id, { status: 'suspended' })
  const { classification } = await resolveMeState(u, undefined, db)
  assert.equal(classification.status, 'suspended')
})

test('resolveMeState: suspended in one team + active in another → ready (active selected)', { skip: itSkip }, async () => {
  const db = testDb(); await resetDb(db)
  const u = await seedUser(db)
  await seedMembership(db, u.id, { teamName: 'Suspended', status: 'suspended' })
  const { team } = await seedMembership(db, u.id, { teamName: 'Active', status: 'active' })
  const { classification } = await resolveMeState(u, undefined, db)
  assert.equal(classification.status, 'ready')
  if (classification.status === 'ready') assert.equal(classification.chosen.teamId, team.id)
})

test('resolveMeState: a Prisma/DB error propagates (never a fake onboarding/success)', { skip: itSkip }, async () => {
  // Unreachable DB → connection refused fast; resolveMeState must reject, not return onboarding.
  const bad = new PrismaClient({ datasources: { db: { url: 'postgresql://x:x@127.0.0.1:1/none' } } })
  try {
    await assert.rejects(resolveMeState({ id: 'user_x', email: 'x@test.local', name: null }, undefined, bad))
  } finally {
    await bad.$disconnect().catch(() => {})
  }
})

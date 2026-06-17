import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
import { resolveMeState, selectTeamStrict } from './auth/db'
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

test('resolveMeState: multi-team → returns the full roster (createdAt asc); strict switch honours the requested team', { skip: itSkip }, async () => {
  const db = testDb(); await resetDb(db)
  const u = await seedUser(db)
  const first = await seedMembership(db, u.id, { teamName: 'Alpha', role: 'owner', status: 'active' })
  const second = await seedMembership(db, u.id, { teamName: 'Beta', role: 'admin', status: 'active' })
  const { memberships, classification } = await resolveMeState(u, undefined, db)
  // both memberships are returned, oldest first
  assert.deepEqual(memberships.map((m) => m.teamId), [first.team.id, second.team.id])
  // no requested team → lenient classification picks the FIRST active (Alpha)
  if (classification.status === 'ready') assert.equal(classification.chosen.teamId, first.team.id)
  else assert.fail('expected ready')
  // a deliberate strict switch to Beta is honoured (and never falls back to Alpha)
  const sel = selectTeamStrict(memberships, second.team.id)
  assert.equal(sel.status, 'ready')
  if (sel.status === 'ready') assert.equal(sel.chosen.role, 'admin')
})

test('selectTeamStrict over DB rows: a team the user is NOT a member of → not_member (cross-tenant rejection)', { skip: itSkip }, async () => {
  const db = testDb(); await resetDb(db)
  const me = await seedUser(db)
  await seedMembership(db, me.id, { teamName: 'Mine', status: 'active' })
  // a DIFFERENT user's team — the caller has no membership in it
  const other = await seedUser(db)
  const otherTeam = await seedMembership(db, other.id, { teamName: 'Theirs', status: 'active' })
  const { memberships } = await resolveMeState(me, otherTeam.team.id, db)
  assert.equal(selectTeamStrict(memberships, otherTeam.team.id).status, 'not_member')
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

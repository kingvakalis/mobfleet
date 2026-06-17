import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ensureFirstTeam } from './auth/db'
import { itSkip, testDb, resetDb, seedUser, seedMembership, seedInvite } from './it-support'

// PostgreSQL integration tests for race-safe first-team provisioning. Run via
// `npm run test:it` with TEST_DATABASE_URL pointed at a disposable database (NEVER
// prod). Skips cleanly when TEST_DATABASE_URL is unset.

test('two simultaneous onboarding requests → exactly ONE team, both adopt it', { skip: itSkip }, async () => {
  const db = testDb(); await resetDb(db)
  const u = await seedUser(db)
  const [a, b] = await Promise.all([
    ensureFirstTeam(u, 'Acme', { rejectPendingInvite: true }, db),
    ensureFirstTeam(u, 'Acme', { rejectPendingInvite: true }, db),
  ])
  assert.equal(a.ok && b.ok, true)
  if (a.ok && b.ok) assert.equal(a.team.id, b.team.id) // both reference the same team
  assert.equal(await db.team.count(), 1)
  assert.equal(await db.membership.count({ where: { userId: u.id } }), 1)
})

test('repeated onboarding is idempotent (second is created:false, same team)', { skip: itSkip }, async () => {
  const db = testDb(); await resetDb(db)
  const u = await seedUser(db)
  const first = await ensureFirstTeam(u, 'Acme', { rejectPendingInvite: true }, db)
  const second = await ensureFirstTeam(u, 'Acme2', { rejectPendingInvite: true }, db)
  assert.equal(first.ok && first.created, true)
  assert.equal(second.ok && second.created, false)
  if (first.ok && second.ok) assert.equal(first.team.id, second.team.id)
  assert.equal(await db.team.count(), 1)
})

test('existing active membership is returned; nothing new is created', { skip: itSkip }, async () => {
  const db = testDb(); await resetDb(db)
  const u = await seedUser(db)
  const { team } = await seedMembership(db, u.id, { teamName: 'Existing', role: 'admin', status: 'active' })
  const r = await ensureFirstTeam(u, 'New', { rejectPendingInvite: true }, db)
  assert.equal(r.ok && r.created, false)
  if (r.ok) assert.equal(r.team.id, team.id)
  assert.equal(await db.team.count(), 1)
})

test('pending-invite conflict on the deliberate endpoint → ok:false, NO team/membership created', { skip: itSkip }, async () => {
  const db = testDb(); await resetDb(db)
  const u = await seedUser(db)
  await seedInvite(db, u.email, { teamName: 'Inviter', role: 'operator' })
  const teamsBefore = await db.team.count() // the invite seeded its own inviter team
  const r = await ensureFirstTeam(u, 'Personal', { rejectPendingInvite: true }, db)
  assert.equal(r.ok, false)
  if (!r.ok) { assert.equal(r.reason, 'pending_invite'); assert.equal(r.invite.role, 'operator') }
  assert.equal(await db.membership.count({ where: { userId: u.id } }), 0)
  assert.equal(await db.team.count(), teamsBefore) // no NEW personal team
})

test('legacy auto-provision (rejectPendingInvite:false) still creates an owner team', { skip: itSkip }, async () => {
  const db = testDb(); await resetDb(db)
  const u = await seedUser(db)
  const r = await ensureFirstTeam(u, 'Personal', { rejectPendingInvite: false }, db)
  assert.equal(r.ok && r.created, true)
  if (r.ok) assert.equal(r.membership.role, 'owner')
  assert.equal(await db.membership.count({ where: { userId: u.id, status: 'active' } }), 1)
})

test('legacy auto-provision IGNORES a pending invite (no 409, still provisions) — behavior preserved', { skip: itSkip }, async () => {
  const db = testDb(); await resetDb(db)
  const u = await seedUser(db)
  await seedInvite(db, u.email, { role: 'operator' })
  const r = await ensureFirstTeam(u, 'Personal', { rejectPendingInvite: false }, db)
  assert.equal(r.ok && r.created, true) // provisioned despite the invite (legacy behavior)
  if (r.ok) assert.equal(r.membership.role, 'owner')
})

test('transaction rollback: a mid-provision failure leaves NO orphan team (Prisma error propagates)', { skip: itSkip }, async () => {
  const db = testDb(); await resetDb(db)
  // A user id NOT in the DB → team.create succeeds inside the tx, then membership.create
  // violates the userId FK → the whole transaction rolls back. ensureFirstTeam rejects
  // (never a fake success) and no team row is left behind.
  const ghost = { id: `user_ghost_${Date.now()}`, email: 'ghost@test.local', name: null }
  await assert.rejects(ensureFirstTeam(ghost, 'Ghost', { rejectPendingInvite: false }, db))
  assert.equal(await db.team.count(), 0)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acceptInvite, inspectInvite, revokeInvite } from './invitations'
import { itSkip, testDb, resetDb, seedUser, seedInvite } from './it-support'

// PostgreSQL integration tests for the Prisma-authoritative invitation lifecycle.
// Run via `npm run test:it`; skips when TEST_DATABASE_URL is unset.

test('acceptInvite: creates an ACTIVE membership for the invite role + marks the invite accepted', { skip: itSkip }, async () => {
  const db = testDb(); await resetDb(db)
  const u = await seedUser(db, { email: 'joe@acme.com' })
  const inviteRow = await seedInvite(db, 'joe@acme.com', { role: 'manager', teamName: 'Acme' })
  const res = await acceptInvite({ token: inviteRow.token, userId: u.id, userEmail: u.email, emailVerified: true }, db)
  assert.equal(res.ok, true)
  if (res.ok) {
    assert.equal(res.idempotent, false)
    assert.equal(res.teamId, inviteRow.teamId)
    assert.equal(res.teamName, 'Acme')
    assert.equal(res.role, 'manager')
  }
  const mem = await db.membership.findUnique({ where: { userId_teamId: { userId: u.id, teamId: inviteRow.teamId } } })
  assert.equal(mem?.role, 'manager')
  assert.equal(mem?.status, 'active')
  const after = await db.invite.findUnique({ where: { id: inviteRow.id } })
  assert.equal(after?.status, 'accepted')
  assert.ok(after?.acceptedAt)
})

test('acceptInvite: idempotent — re-accepting yields exactly ONE membership and idempotent:true', { skip: itSkip }, async () => {
  const db = testDb(); await resetDb(db)
  const u = await seedUser(db, { email: 'k@acme.com' })
  const inviteRow = await seedInvite(db, 'k@acme.com')
  const first = await acceptInvite({ token: inviteRow.token, userId: u.id, userEmail: u.email, emailVerified: true }, db)
  assert.equal(first.ok, true)
  const second = await acceptInvite({ token: inviteRow.token, userId: u.id, userEmail: u.email, emailVerified: true }, db)
  assert.equal(second.ok, true)
  if (second.ok) assert.equal(second.idempotent, true)
  assert.equal(await db.membership.count({ where: { userId: u.id, teamId: inviteRow.teamId } }), 1)
})

test('acceptInvite: expired invite is rejected and creates no membership', { skip: itSkip }, async () => {
  const db = testDb(); await resetDb(db)
  const u = await seedUser(db, { email: 'e@acme.com' })
  const inviteRow = await seedInvite(db, 'e@acme.com', { expired: true })
  const res = await acceptInvite({ token: inviteRow.token, userId: u.id, userEmail: u.email, emailVerified: true }, db)
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.code, 'expired')
  assert.equal(await db.membership.count({ where: { userId: u.id } }), 0)
})

test('acceptInvite: revoked invite is rejected', { skip: itSkip }, async () => {
  const db = testDb(); await resetDb(db)
  const u = await seedUser(db, { email: 'r@acme.com' })
  const inviteRow = await seedInvite(db, 'r@acme.com')
  await revokeInvite({ inviteId: inviteRow.id, teamId: inviteRow.teamId }, db)
  const res = await acceptInvite({ token: inviteRow.token, userId: u.id, userEmail: u.email, emailVerified: true }, db)
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.code, 'revoked')
})

test('acceptInvite: a different email cannot redeem a leaked token (email_mismatch)', { skip: itSkip }, async () => {
  const db = testDb(); await resetDb(db)
  const attacker = await seedUser(db, { email: 'attacker@evil.com' })
  const inviteRow = await seedInvite(db, 'victim@acme.com')
  const res = await acceptInvite({ token: inviteRow.token, userId: attacker.id, userEmail: attacker.email, emailVerified: true }, db)
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.code, 'email_mismatch')
  assert.equal(await db.membership.count({ where: { userId: attacker.id } }), 0)
})

test('acceptInvite: an unverified identity cannot accept (email_unverified)', { skip: itSkip }, async () => {
  const db = testDb(); await resetDb(db)
  const u = await seedUser(db, { email: 'u@acme.com' })
  const inviteRow = await seedInvite(db, 'u@acme.com')
  const res = await acceptInvite({ token: inviteRow.token, userId: u.id, userEmail: u.email, emailVerified: false }, db)
  assert.equal(res.ok, false)
  if (!res.ok) assert.equal(res.code, 'email_unverified')
})

test('revokeInvite: pending -> revoked, then idempotent; cross-team id -> not_found', { skip: itSkip }, async () => {
  const db = testDb(); await resetDb(db)
  const inviteRow = await seedInvite(db, 'x@acme.com')
  assert.deepEqual(await revokeInvite({ inviteId: inviteRow.id, teamId: inviteRow.teamId }, db), { ok: true, alreadyRevoked: false })
  assert.deepEqual(await revokeInvite({ inviteId: inviteRow.id, teamId: inviteRow.teamId }, db), { ok: true, alreadyRevoked: true })
  assert.deepEqual(await revokeInvite({ inviteId: inviteRow.id, teamId: 'team_someone_else' }, db), { ok: false, code: 'not_found' })
})

test('revokeInvite: an already-accepted invite cannot be revoked', { skip: itSkip }, async () => {
  const db = testDb(); await resetDb(db)
  const u = await seedUser(db, { email: 'a@acme.com' })
  const inviteRow = await seedInvite(db, 'a@acme.com')
  await acceptInvite({ token: inviteRow.token, userId: u.id, userEmail: u.email, emailVerified: true }, db)
  const r = await revokeInvite({ inviteId: inviteRow.id, teamId: inviteRow.teamId }, db)
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.code, 'already_accepted')
})

test('inspectInvite: valid pending -> summary; revoked / expired / unknown -> { valid:false }', { skip: itSkip }, async () => {
  const db = testDb(); await resetDb(db)
  const inviteRow = await seedInvite(db, 'i@acme.com', { teamName: 'Acme', role: 'operator' })
  const ok = await inspectInvite(inviteRow.token, db)
  assert.equal(ok.valid, true)
  if (ok.valid) {
    assert.equal(ok.teamName, 'Acme')
    assert.equal(ok.role, 'operator')
  }
  await revokeInvite({ inviteId: inviteRow.id, teamId: inviteRow.teamId }, db)
  assert.equal((await inspectInvite(inviteRow.token, db)).valid, false)
  const expiredRow = await seedInvite(db, 'j@acme.com', { expired: true })
  assert.equal((await inspectInvite(expiredRow.token, db)).valid, false)
  assert.equal((await inspectInvite('no-such-token', db)).valid, false)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyInviteForAccept, type InviteForDecision } from './invitations'

// Pure-function coverage of the invite-acceptance decision (no DB). Every branch the
// HTTP accept endpoint depends on is exercised here: validity, expiry, revoked,
// already-accepted (idempotent vs consumed), email verification + match, and the
// precedence between them.

const NOW = 1_000_000
const inv = (over: Partial<InviteForDecision> = {}): InviteForDecision => ({
  email: 'invitee@acme.com', role: 'operator', status: 'pending', expiresAt: NOW + 10_000, ...over,
})
const opts = (over: Partial<{ userEmail: string; emailVerified: boolean; userIsMember: boolean }> = {}) => ({
  now: NOW, userEmail: 'invitee@acme.com', emailVerified: true, userIsMember: false, ...over,
})

test('null invite -> invalid', () => {
  assert.equal(classifyInviteForAccept(null, opts()).status, 'invalid')
})

test('unverified email -> email_unverified even when otherwise valid', () => {
  assert.equal(classifyInviteForAccept(inv(), opts({ emailVerified: false })).status, 'email_unverified')
})

test('email match is case-insensitive; a different email -> email_mismatch', () => {
  assert.equal(classifyInviteForAccept(inv({ email: 'INVITEE@acme.com' }), opts({ userEmail: 'invitee@acme.com' })).status, 'accept')
  assert.equal(classifyInviteForAccept(inv(), opts({ userEmail: 'someone@else.com' })).status, 'email_mismatch')
})

test('revoked invite -> revoked', () => {
  assert.equal(classifyInviteForAccept(inv({ status: 'revoked' }), opts()).status, 'revoked')
})

test('accepted invite + caller already a member -> already_member (idempotent), with the role', () => {
  const d = classifyInviteForAccept(inv({ status: 'accepted', role: 'manager' }), opts({ userIsMember: true }))
  assert.equal(d.status, 'already_member')
  if (d.status === 'already_member') assert.equal(d.role, 'manager')
})

test('accepted invite + caller NOT a member -> used', () => {
  assert.equal(classifyInviteForAccept(inv({ status: 'accepted' }), opts({ userIsMember: false })).status, 'used')
})

test('pending but expired -> expired', () => {
  assert.equal(classifyInviteForAccept(inv({ expiresAt: NOW - 1 }), opts()).status, 'expired')
})

test('pending + valid + verified + email matches -> accept with the invite role', () => {
  const d = classifyInviteForAccept(inv({ role: 'manager' }), opts())
  assert.equal(d.status, 'accept')
  if (d.status === 'accept') assert.equal(d.role, 'manager')
})

test('an unknown invite role coerces to viewer on accept (never escalates)', () => {
  const d = classifyInviteForAccept(inv({ role: 'superadmin' }), opts())
  assert.equal(d.status, 'accept')
  if (d.status === 'accept') assert.equal(d.role, 'viewer')
})

test('verification precedes status checks (revoked + unverified -> email_unverified)', () => {
  assert.equal(classifyInviteForAccept(inv({ status: 'revoked' }), opts({ emailVerified: false })).status, 'email_unverified')
})

test('email match precedes status checks (revoked + wrong email -> email_mismatch)', () => {
  assert.equal(classifyInviteForAccept(inv({ status: 'revoked' }), opts({ userEmail: 'x@y.com' })).status, 'email_mismatch')
})

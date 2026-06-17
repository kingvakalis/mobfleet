import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyMembership, resolveTeamName } from './auth/db'
import { buildMeResponse, type MeMembership } from './auth/me'

// Pure tests (no DB) for /v1/me membership classification, response shaping, and
// first-team naming. The DB-backed paths (the ensureFirstTeam advisory-lock race,
// resolveMeState, legacy auto-provision) are covered in *.itest.ts against a real
// Postgres — matching this backend's "unit-test the pure helpers" convention.

const mem = (over: Partial<MeMembership> & { teamId: string; status: string }): MeMembership => ({
  id: over.id ?? `mem_${over.teamId}`,
  userId: over.userId ?? 'u1',
  teamId: over.teamId,
  role: over.role ?? 'owner',
  status: over.status,
  scopeType: over.scopeType,
  scopeGroups: over.scopeGroups,
  scopePhones: over.scopePhones,
  overrides: over.overrides,
  team: over.team ?? { id: over.teamId, name: `Team ${over.teamId}` },
})

// ── classifyMembership (prefer active; suspended only when none active) ──────────
test('classifyMembership: no memberships → onboarding', () => {
  assert.deepEqual(classifyMembership([]), { status: 'onboarding' })
})

test('classifyMembership: a single active membership → ready', () => {
  const r = classifyMembership([mem({ teamId: 'A', status: 'active' })])
  assert.equal(r.status, 'ready')
  if (r.status === 'ready') assert.equal(r.chosen.teamId, 'A')
})

test('classifyMembership: first suspended + later active → ready (active chosen)', () => {
  const r = classifyMembership([mem({ teamId: 'A', status: 'suspended' }), mem({ teamId: 'B', status: 'active' })])
  assert.equal(r.status, 'ready')
  if (r.status === 'ready') assert.equal(r.chosen.teamId, 'B')
})

test('classifyMembership: all suspended → suspended', () => {
  assert.equal(classifyMembership([mem({ teamId: 'A', status: 'suspended' }), mem({ teamId: 'B', status: 'suspended' })]).status, 'suspended')
})

test('classifyMembership: requested active team is honoured', () => {
  const r = classifyMembership([mem({ teamId: 'A', status: 'active' }), mem({ teamId: 'B', status: 'active' })], 'B')
  if (r.status === 'ready') assert.equal(r.chosen.teamId, 'B')
  else assert.fail('expected ready')
})

test('classifyMembership: requested suspended but active elsewhere → ready via active', () => {
  const r = classifyMembership([mem({ teamId: 'A', status: 'active' }), mem({ teamId: 'B', status: 'suspended' })], 'B')
  if (r.status === 'ready') assert.equal(r.chosen.teamId, 'A')
  else assert.fail('expected ready')
})

test('classifyMembership: forged/foreign requestedTeamId ignored → first active', () => {
  const r = classifyMembership([mem({ teamId: 'A', status: 'active' })], 'NOPE')
  if (r.status === 'ready') assert.equal(r.chosen.teamId, 'A')
  else assert.fail('expected ready')
})

// ── resolveTeamName ─────────────────────────────────────────────────────────────
test('resolveTeamName: preferred (trimmed) wins', () => {
  assert.equal(resolveTeamName('  Acme Ops  ', 'Alex', 'alex@acme.com'), 'Acme Ops')
})
test('resolveTeamName: falls back to name, then email prefix', () => {
  assert.equal(resolveTeamName('', 'Alex', 'alex@acme.com'), "Alex's Workspace")
  assert.equal(resolveTeamName(undefined, null, 'alex@acme.com'), "alex's Workspace")
})

// ── buildMeResponse ─────────────────────────────────────────────────────────────
const identity = { providerUserId: 'sub-123', email: 'alex@acme.com' }
const user = { id: 'user_1', email: 'alex@acme.com', name: 'Alex' }

test('buildMeResponse: onboarding → onboardingRequired, no team/role/permissions', () => {
  const r = buildMeResponse({ identity, user, classification: { status: 'onboarding' }, pendingInvite: null })
  assert.equal(r.onboardingRequired, true)
  assert.equal(r.suspended, false)
  assert.equal(r.membership, null)
  assert.equal(r.team, null)
  assert.equal(r.role, null)
  assert.deepEqual(r.permissions, [])
  assert.deepEqual(r.user, { id: 'sub-123', email: 'alex@acme.com' })
  assert.deepEqual(r.profile, { id: 'user_1', displayName: 'Alex' })
})

test('buildMeResponse: suspended → suspended flag, no permissions (not forbidden, not onboarding)', () => {
  const r = buildMeResponse({ identity, user, classification: { status: 'suspended' }, pendingInvite: null })
  assert.equal(r.suspended, true)
  assert.equal(r.onboardingRequired, false)
  assert.deepEqual(r.permissions, [])
})

test('buildMeResponse: ready owner → team/role/membership + non-empty permissions', () => {
  const r = buildMeResponse({ identity, user, classification: { status: 'ready', chosen: mem({ teamId: 'A', status: 'active', role: 'owner' }) }, pendingInvite: null })
  assert.equal(r.onboardingRequired, false)
  assert.equal(r.suspended, false)
  assert.equal(r.role, 'owner')
  assert.deepEqual(r.team, { id: 'A', name: 'Team A' })
  assert.deepEqual(r.membership, { id: 'mem_A', teamId: 'A', role: 'owner', status: 'active' })
  assert.ok(r.permissions.length > 0)
})

test('buildMeResponse: viewer permissions are a strict subset of owner (role from DB)', () => {
  const ownerP = buildMeResponse({ identity, user, classification: { status: 'ready', chosen: mem({ teamId: 'A', status: 'active', role: 'owner' }) }, pendingInvite: null }).permissions
  const viewerP = buildMeResponse({ identity, user, classification: { status: 'ready', chosen: mem({ teamId: 'A', status: 'active', role: 'viewer' }) }, pendingInvite: null }).permissions
  assert.ok(viewerP.length < ownerP.length)
  assert.ok(viewerP.every((p) => ownerP.includes(p)))
})

test('buildMeResponse: pendingInvite is passed through regardless of state', () => {
  const inv = { id: 'inv1', teamId: 'T', teamName: 'Team T', role: 'operator' }
  assert.deepEqual(buildMeResponse({ identity, user, classification: { status: 'onboarding' }, pendingInvite: inv }).pendingInvite, inv)
})

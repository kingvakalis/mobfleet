import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyMembership, resolveTeamName, selectTeamStrict } from './auth/db'
import { buildMeResponse, buildTeams, type MeMembership } from './auth/me'

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

// ── buildTeams (switchable-team roster projection) ──────────────────────────────
test('buildTeams: projects every membership, marking the current team', () => {
  const teams = buildTeams(
    [mem({ teamId: 'A', status: 'active', role: 'owner' }), mem({ teamId: 'B', status: 'active', role: 'admin' })],
    'B',
  )
  assert.deepEqual(teams, [
    { teamId: 'A', name: 'Team A', role: 'owner', status: 'active', membershipId: 'mem_A', current: false },
    { teamId: 'B', name: 'Team B', role: 'admin', status: 'active', membershipId: 'mem_B', current: true },
  ])
})

test('buildTeams: includes suspended memberships (status carried, never current when null)', () => {
  const teams = buildTeams([mem({ teamId: 'A', status: 'active' }), mem({ teamId: 'B', status: 'suspended' })], null)
  assert.equal(teams.length, 2)
  assert.equal(teams.every((t) => t.current === false), true) // no current team (onboarding/suspended overall)
  assert.equal(teams.find((t) => t.teamId === 'B')?.status, 'suspended')
  // "available teams" = the active subset the client can switch into
  assert.deepEqual(teams.filter((t) => t.status === 'active').map((t) => t.teamId), ['A'])
})

// ── selectTeamStrict (deliberate switch — no fallback) ──────────────────────────
test('selectTeamStrict: an active requested team → ready', () => {
  const r = selectTeamStrict([mem({ teamId: 'A', status: 'active' }), mem({ teamId: 'B', status: 'active' })], 'B')
  assert.equal(r.status, 'ready')
  if (r.status === 'ready') assert.equal(r.chosen.teamId, 'B')
})

test('selectTeamStrict: a foreign/removed/non-existent team → not_member (NEVER a fallback)', () => {
  // Even though an active team exists, a deliberate switch to a team you do not belong
  // to is rejected — it must NOT silently fall back to the active one.
  assert.equal(selectTeamStrict([mem({ teamId: 'A', status: 'active' })], 'NOPE').status, 'not_member')
})

test('selectTeamStrict: a suspended membership in the requested team → suspended', () => {
  assert.equal(selectTeamStrict([mem({ teamId: 'A', status: 'suspended' })], 'A').status, 'suspended')
})

test('selectTeamStrict: requested suspended while active elsewhere → suspended (no fallback to the active one)', () => {
  const r = selectTeamStrict([mem({ teamId: 'A', status: 'active' }), mem({ teamId: 'B', status: 'suspended' })], 'B')
  assert.equal(r.status, 'suspended')
})

// ── buildMeResponse ─────────────────────────────────────────────────────────────
const identity = { providerUserId: 'sub-123', email: 'alex@acme.com', emailVerified: true }
const user = { id: 'user_1', email: 'alex@acme.com', name: 'Alex' }

test('buildMeResponse: onboarding → onboardingRequired, no team/role/permissions', () => {
  const r = buildMeResponse({ identity, user, memberships: [], classification: { status: 'onboarding' }, pendingInvite: null })
  assert.equal(r.onboardingRequired, true)
  assert.equal(r.suspended, false)
  assert.equal(r.membership, null)
  assert.equal(r.team, null)
  assert.equal(r.role, null)
  assert.deepEqual(r.permissions, [])
  assert.deepEqual(r.teams, []) // no memberships yet
  assert.equal(r.emailVerified, true)
  assert.deepEqual(r.user, { id: 'sub-123', email: 'alex@acme.com' })
  assert.deepEqual(r.profile, { id: 'user_1', displayName: 'Alex' })
})

test('buildMeResponse: suspended → suspended flag, no permissions (not forbidden, not onboarding)', () => {
  const memberships = [mem({ teamId: 'A', status: 'suspended' })]
  const r = buildMeResponse({ identity, user, memberships, classification: { status: 'suspended' }, pendingInvite: null })
  assert.equal(r.suspended, true)
  assert.equal(r.onboardingRequired, false)
  assert.deepEqual(r.permissions, [])
  // The suspended team is still surfaced (for "suspended in X"), but nothing is current.
  assert.equal(r.teams.length, 1)
  assert.equal(r.teams[0].current, false)
  assert.equal(r.teams[0].status, 'suspended')
})

test('buildMeResponse: emailVerified=false is carried through (invite-accept gate input)', () => {
  const r = buildMeResponse({ identity: { ...identity, emailVerified: false }, user, memberships: [], classification: { status: 'onboarding' }, pendingInvite: null })
  assert.equal(r.emailVerified, false)
})

test('buildMeResponse: ready owner → team/role/membership + non-empty permissions + current team', () => {
  const chosen = mem({ teamId: 'A', status: 'active', role: 'owner' })
  const r = buildMeResponse({ identity, user, memberships: [chosen], classification: { status: 'ready', chosen }, pendingInvite: null })
  assert.equal(r.onboardingRequired, false)
  assert.equal(r.suspended, false)
  assert.equal(r.role, 'owner')
  assert.deepEqual(r.team, { id: 'A', name: 'Team A' })
  assert.deepEqual(r.membership, { id: 'mem_A', teamId: 'A', role: 'owner', status: 'active' })
  assert.ok(r.permissions.length > 0)
  // the chosen team is flagged current in the roster
  assert.equal(r.teams.length, 1)
  assert.equal(r.teams[0].current, true)
})

test('buildMeResponse: multi-team ready → roster lists all, only the chosen is current', () => {
  const a = mem({ teamId: 'A', status: 'active', role: 'owner' })
  const b = mem({ teamId: 'B', status: 'active', role: 'viewer' })
  const r = buildMeResponse({ identity, user, memberships: [a, b], classification: { status: 'ready', chosen: b }, pendingInvite: null })
  assert.equal(r.team?.id, 'B')
  assert.deepEqual(r.teams.filter((t) => t.current).map((t) => t.teamId), ['B'])
  assert.equal(r.teams.length, 2)
  // permissions reflect the CHOSEN team's role (viewer), not the owner team
  assert.equal(r.role, 'viewer')
})

test('buildMeResponse: viewer permissions are a strict subset of owner (role from DB)', () => {
  const ownerM = mem({ teamId: 'A', status: 'active', role: 'owner' })
  const viewerM = mem({ teamId: 'A', status: 'active', role: 'viewer' })
  const ownerP = buildMeResponse({ identity, user, memberships: [ownerM], classification: { status: 'ready', chosen: ownerM }, pendingInvite: null }).permissions
  const viewerP = buildMeResponse({ identity, user, memberships: [viewerM], classification: { status: 'ready', chosen: viewerM }, pendingInvite: null }).permissions
  assert.ok(viewerP.length < ownerP.length)
  assert.ok(viewerP.every((p) => ownerP.includes(p)))
})

test('buildMeResponse: a per-permission override is reflected in the effective set', () => {
  // A viewer GRANTED phones.control via overrides must show it; the resolver — not the
  // raw role — is the source of truth for /v1/me permissions.
  const granted = mem({ teamId: 'A', status: 'active', role: 'viewer', overrides: { 'phones.control': 'allow' } })
  const base = mem({ teamId: 'A', status: 'active', role: 'viewer' })
  const grantedP = buildMeResponse({ identity, user, memberships: [granted], classification: { status: 'ready', chosen: granted }, pendingInvite: null }).permissions
  const baseP = buildMeResponse({ identity, user, memberships: [base], classification: { status: 'ready', chosen: base }, pendingInvite: null }).permissions
  assert.equal(baseP.includes('phones.control'), false)
  assert.equal(grantedP.includes('phones.control'), true)
})

test('buildMeResponse: pendingInvite is passed through regardless of state', () => {
  const inv = { id: 'inv1', teamId: 'T', teamName: 'Team T', role: 'operator' }
  assert.deepEqual(buildMeResponse({ identity, user, memberships: [], classification: { status: 'onboarding' }, pendingInvite: inv }).pendingInvite, inv)
})

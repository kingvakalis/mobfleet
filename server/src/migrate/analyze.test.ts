import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyze } from './analyze'
import type {
  ConflictCode, RoleReadOnlyProof, SourceSnapshot, SrcAuthUser, SrcInvite, SrcMember, SrcTeam,
  TargetSnapshot, TgtInvite, TgtMembership, TgtTeam, TgtUser,
} from './types'

// Pure tests (no DB) for the migration analyzer — exhaustive conflict-code matrix +
// artifact classification + plan. Synthetic snapshots, fully deterministic.

const PROOF = { isolation: 'repeatable read', readOnly: true, backendPid: 1 }
const ROLE_PROOF: RoleReadOnlyProof = {
  label: 'source', role: 'mobfleet_inv_ro', database: 'src', isSuperuser: false, canCreateDb: false,
  canCreateRole: false, isReplication: false, bypassRls: false, isDatabaseOwner: false, ownedSchemas: [],
  ownedTables: [], schemasWithCreate: [], tablesWritable: [], canCreateOnDatabase: false,
  memberOfPrivilegedRoleCount: 0, defaultTransactionReadOnly: 'on', violations: [],
}
const T_JAN = '2024-01-01T00:00:00Z'
const TS_JUN = Date.parse('2024-06-01T00:00:00Z')

const src = (o: Partial<SourceSnapshot> = {}): SourceSnapshot => ({ authUsers: [], teams: [], members: [], invites: [], proof: PROOF, roleProof: ROLE_PROOF, ...o })
const tgt = (o: Partial<TargetSnapshot> = {}): TargetSnapshot => ({ users: [], teams: [], memberships: [], invites: [], childCountsByTeam: {}, auditCountByTeam: {}, ...o })

const au = (o: Partial<SrcAuthUser> & { id: string }): SrcAuthUser => ({ email: `${o.id}@x.com`, emailConfirmedAt: T_JAN, fullName: null, createdAt: T_JAN, ...o })
const st = (o: Partial<SrcTeam> & { id: string }): SrcTeam => ({ name: 'Acme', ownerUserId: null, createdAt: T_JAN, ...o })
const sm = (o: Partial<SrcMember> & { teamId: string; userId: string }): SrcMember => ({ id: `m_${o.teamId}_${o.userId}`, role: 'owner', status: 'active', email: null, name: null, invitedBy: null, scopeType: 'workspace', scopeGroups: null, scopePhones: null, overrides: null, joinedAt: T_JAN, ...o })
const si = (o: Partial<SrcInvite> & { id: string; teamId: string; email: string }): SrcInvite => ({ role: 'operator', token: `tok_${o.id}`, status: 'pending', invitedBy: null, createdAt: T_JAN, expiresAt: T_JAN, acceptedAt: null, ...o })
const tu = (o: Partial<TgtUser> & { id: string; authProviderId: string }): TgtUser => ({ email: `${o.authProviderId}@x.com`, ...o })
const tt = (o: Partial<TgtTeam> & { id: string }): TgtTeam => ({ name: 'Team', supabaseTeamId: null, archivedAt: null, createdAt: TS_JUN, ...o })
const tm = (o: Partial<TgtMembership> & { id: string; userId: string; teamId: string }): TgtMembership => ({ role: 'owner', status: 'active', scopeType: 'workspace', scopeGroups: null, scopePhones: null, overrides: null, ...o })
const ti = (o: Partial<TgtInvite> & { id: string; teamId: string; email: string; token: string }): TgtInvite => ({ status: 'pending', ...o })

const has = (codes: { code: ConflictCode }[], c: ConflictCode): boolean => codes.some((f) => f.code === c)

// ── Happy paths (no blockers) ──
test('normal single-team owner -> no blockers; plan creates 1 user + 1 team', () => {
  const r = analyze(src({ authUsers: [au({ id: 'u1' })], teams: [st({ id: 't1', ownerUserId: 'u1' })], members: [sm({ teamId: 't1', userId: 'u1', role: 'owner' })] }), tgt())
  assert.equal(r.hasBlockers, false)
  assert.equal(r.plan.usersToCreate, 1)
  assert.equal(r.plan.teamsToCreate, 1)
})
test('multi-team user (owner of A, operator of B) -> no blockers', () => {
  const r = analyze(src({
    authUsers: [au({ id: 'u1' }), au({ id: 'u2' })],
    teams: [st({ id: 'A', ownerUserId: 'u1' }), st({ id: 'B', ownerUserId: 'u2' })],
    members: [sm({ teamId: 'A', userId: 'u1', role: 'owner' }), sm({ teamId: 'B', userId: 'u1', role: 'operator' }), sm({ teamId: 'B', userId: 'u2', role: 'owner' })],
  }), tgt())
  assert.equal(r.hasBlockers, false)
  assert.equal(r.plan.usersToCreate, 2)
  assert.equal(r.plan.teamsToCreate, 2)
})
test('suspended member -> valid, no blockers', () => {
  const r = analyze(src({ authUsers: [au({ id: 'u1' }), au({ id: 'u2' })], teams: [st({ id: 't1', ownerUserId: 'u1' })], members: [sm({ teamId: 't1', userId: 'u1', role: 'owner' }), sm({ teamId: 't1', userId: 'u2', role: 'operator', status: 'suspended' })] }), tgt())
  assert.equal(r.hasBlockers, false)
})

// ── Identity matrix ──
test('duplicate normalized Supabase email -> IDENT_DUP_SUPABASE_EMAIL + email-unique conflict (blockers)', () => {
  const r = analyze(src({ authUsers: [au({ id: 'u1', email: 'dup@x.com' }), au({ id: 'u2', email: 'DUP@x.com' })], teams: [st({ id: 't1', ownerUserId: 'u1' })], members: [sm({ teamId: 't1', userId: 'u1' }), sm({ teamId: 't1', userId: 'u2', role: 'admin' })] }), tgt())
  assert.ok(has(r.findings, 'IDENT_DUP_SUPABASE_EMAIL'))
  assert.ok(has(r.findings, 'IDENT_PRISMA_EMAIL_UNIQUE_CONFLICT'))
  assert.equal(r.hasBlockers, true)
})
test('existing Prisma user: same authProviderId, different email -> IDENT_PRISMA_AUTHID_EMAIL_CONFLICT', () => {
  const r = analyze(src({ authUsers: [au({ id: 'u1', email: 'new@x.com' })], teams: [st({ id: 't1', ownerUserId: 'u1' })], members: [sm({ teamId: 't1', userId: 'u1' })] }), tgt({ users: [tu({ id: 'pu1', authProviderId: 'u1', email: 'old@x.com' })] }))
  assert.ok(has(r.findings, 'IDENT_PRISMA_AUTHID_EMAIL_CONFLICT'))
})
test('existing Prisma user: same email, different authProviderId -> IDENT_PRISMA_EMAIL_DIFF_AUTHID', () => {
  const r = analyze(src({ authUsers: [au({ id: 'u1', email: 'same@x.com' })], teams: [st({ id: 't1', ownerUserId: 'u1' })], members: [sm({ teamId: 't1', userId: 'u1' })] }), tgt({ users: [tu({ id: 'pu1', authProviderId: 'other', email: 'same@x.com' })] }))
  assert.ok(has(r.findings, 'IDENT_PRISMA_EMAIL_DIFF_AUTHID'))
})
test('membership references a missing auth user -> IDENT_MISSING_AUTH_USER (blocker)', () => {
  const r = analyze(src({ authUsers: [au({ id: 'u1' })], teams: [st({ id: 't1', ownerUserId: 'u1' })], members: [sm({ teamId: 't1', userId: 'u1' }), sm({ teamId: 't1', userId: 'ghost', role: 'operator' })] }), tgt())
  assert.ok(has(r.findings, 'IDENT_MISSING_AUTH_USER'))
  assert.equal(r.hasBlockers, true)
})
test('null inviter -> no finding; missing inviter -> IDENT_MISSING_INVITED_BY (info, not blocker)', () => {
  const ok = analyze(src({ authUsers: [au({ id: 'u1' })], teams: [st({ id: 't1', ownerUserId: 'u1' })], members: [sm({ teamId: 't1', userId: 'u1' })], invites: [si({ id: 'i1', teamId: 't1', email: 'new@x.com', invitedBy: null })] }), tgt())
  assert.ok(!has(ok.findings, 'IDENT_MISSING_INVITED_BY'))
  const miss = analyze(src({ authUsers: [au({ id: 'u1' })], teams: [st({ id: 't1', ownerUserId: 'u1' })], members: [sm({ teamId: 't1', userId: 'u1' })], invites: [si({ id: 'i1', teamId: 't1', email: 'new@x.com', invitedBy: 'ghost' })] }), tgt())
  assert.ok(has(miss.findings, 'IDENT_MISSING_INVITED_BY'))
  assert.equal(miss.findings.find((f) => f.code === 'IDENT_MISSING_INVITED_BY')?.severity, 'info')
})
test('invite email matches multiple auth users -> IDENT_INVITE_RECIPIENT_AMBIGUOUS (blocker)', () => {
  const r = analyze(src({ authUsers: [au({ id: 'u1', email: 'a@x.com' }), au({ id: 'u2', email: 'a@x.com' })], teams: [st({ id: 't1', ownerUserId: 'u1' })], members: [sm({ teamId: 't1', userId: 'u1' })], invites: [si({ id: 'i1', teamId: 't1', email: 'a@x.com' })] }), tgt())
  assert.ok(has(r.findings, 'IDENT_INVITE_RECIPIENT_AMBIGUOUS'))
})
test('email changed between auth.users and team_members -> IDENT_EMAIL_CHANGED (warn)', () => {
  const r = analyze(src({ authUsers: [au({ id: 'u1', email: 'current@x.com' })], teams: [st({ id: 't1', ownerUserId: 'u1' })], members: [sm({ teamId: 't1', userId: 'u1', email: 'old@x.com' })] }), tgt())
  assert.ok(has(r.findings, 'IDENT_EMAIL_CHANGED'))
  assert.equal(r.findings.find((f) => f.code === 'IDENT_EMAIL_CHANGED')?.severity, 'warn')
})

// ── Source validation ──
test('invalid role / status -> SRC_INVALID_ROLE / SRC_INVALID_STATUS (blockers)', () => {
  const r = analyze(src({ authUsers: [au({ id: 'u1' })], teams: [st({ id: 't1', ownerUserId: 'u1' })], members: [sm({ teamId: 't1', userId: 'u1', role: 'superuser', status: 'banned' })] }), tgt())
  assert.ok(has(r.findings, 'SRC_INVALID_ROLE'))
  assert.ok(has(r.findings, 'SRC_INVALID_STATUS'))
})
test('malformed scope / overrides -> SRC_MALFORMED_SCOPE / SRC_MALFORMED_OVERRIDES', () => {
  const r = analyze(src({ authUsers: [au({ id: 'u1' })], teams: [st({ id: 't1', ownerUserId: 'u1' })], members: [sm({ teamId: 't1', userId: 'u1', scopeType: 'nonsense', scopeGroups: [1, 2], overrides: { 'phones.view': 'maybe' } })] }), tgt())
  assert.ok(has(r.findings, 'SRC_MALFORMED_SCOPE'))
  assert.ok(has(r.findings, 'SRC_MALFORMED_OVERRIDES'))
})
test('duplicate source membership rows -> SRC_DUP_MEMBERSHIP', () => {
  const r = analyze(src({ authUsers: [au({ id: 'u1' })], teams: [st({ id: 't1', ownerUserId: 'u1' })], members: [sm({ teamId: 't1', userId: 'u1', id: 'a' }), sm({ teamId: 't1', userId: 'u1', id: 'b', role: 'admin' })] }), tgt())
  assert.ok(has(r.findings, 'SRC_DUP_MEMBERSHIP'))
})
test('team with no owner -> SRC_TEAM_NO_OWNER; declared owner disagreeing with owner membership -> SRC_TEAM_AMBIGUOUS_OWNER', () => {
  const noOwner = analyze(src({ authUsers: [au({ id: 'u1' })], teams: [st({ id: 't1', ownerUserId: null })], members: [sm({ teamId: 't1', userId: 'u1', role: 'operator' })] }), tgt())
  assert.ok(has(noOwner.findings, 'SRC_TEAM_NO_OWNER'))
  const ambiguous = analyze(src({ authUsers: [au({ id: 'u1' }), au({ id: 'u2' })], teams: [st({ id: 't1', ownerUserId: 'u2' })], members: [sm({ teamId: 't1', userId: 'u1', role: 'owner' })] }), tgt())
  assert.ok(has(ambiguous.findings, 'SRC_TEAM_AMBIGUOUS_OWNER'))
})

// ── Target conflicts ──
test('invite token collision with a different team/email -> TGT_INVITE_TOKEN_COLLISION', () => {
  const r = analyze(
    src({ authUsers: [au({ id: 'u1' })], teams: [st({ id: 't1', ownerUserId: 'u1' })], members: [sm({ teamId: 't1', userId: 'u1' })], invites: [si({ id: 'i1', teamId: 't1', email: 'a@x.com', token: 'SHARED' })] }),
    tgt({ invites: [ti({ id: 'pi1', teamId: 'other', email: 'b@x.com', token: 'SHARED' })] }),
  )
  assert.ok(has(r.findings, 'TGT_INVITE_TOKEN_COLLISION'))
  // the token is never exposed raw — ref is a fingerprint
  assert.ok(r.findings.find((f) => f.code === 'TGT_INVITE_TOKEN_COLLISION')!.ref.startsWith('tok_***'))
})
test('two Prisma teams claim the same supabaseTeamId -> TGT_SUPABASE_ID_UNEXPECTED_TEAM', () => {
  const r = analyze(src({ teams: [st({ id: 's1' })] }), tgt({ teams: [tt({ id: 'p1', supabaseTeamId: 's1' }), tt({ id: 'p2', supabaseTeamId: 's1' })] }))
  assert.ok(has(r.findings, 'TGT_SUPABASE_ID_UNEXPECTED_TEAM'))
})
test('mapped team idempotent re-inspection: matching membership -> no conflict; differing -> TGT_MEMBERSHIP_CONFLICT', () => {
  const base = (role: string) => analyze(
    src({ authUsers: [au({ id: 'u1' })], teams: [st({ id: 's1', ownerUserId: 'u1' })], members: [sm({ teamId: 's1', userId: 'u1', role: 'owner' })] }),
    tgt({ users: [tu({ id: 'pu1', authProviderId: 'u1' })], teams: [tt({ id: 'p1', supabaseTeamId: 's1' })], memberships: [tm({ id: 'pm1', userId: 'pu1', teamId: 'p1', role })] }),
  )
  const ok = base('owner')
  assert.equal(ok.plan.teamsAlreadyMapped, 1)
  assert.ok(!has(ok.findings, 'TGT_MEMBERSHIP_CONFLICT'))
  assert.ok(has(base('admin').findings, 'TGT_MEMBERSHIP_CONFLICT'))
})

// ── Artifact classification ──
const candidateInputs = () => ({
  source: src({ authUsers: [au({ id: 'bob' })], teams: [st({ id: 's1', ownerUserId: 'bob' })], members: [sm({ teamId: 's1', userId: 'bob', role: 'owner', joinedAt: T_JAN })] }),
  target: tgt({ users: [tu({ id: 'pu_bob', authProviderId: 'bob' })], teams: [tt({ id: 'art1', name: "bob's Workspace", supabaseTeamId: null, archivedAt: null, createdAt: TS_JUN }), tt({ id: 'mapped', supabaseTeamId: 's1' })], memberships: [tm({ id: 'am', userId: 'pu_bob', teamId: 'art1', role: 'owner' })], childCountsByTeam: { art1: { Membership: 1, Device: 0 } }, auditCountByTeam: { art1: 0 } }),
})
test('confirmed auto-provision candidate -> classified candidate, scheduled to archive, NO blocker', () => {
  const { source, target } = candidateInputs()
  const r = analyze(source, target)
  const v = r.artifacts.find((a) => a.teamId === 'art1')!
  assert.equal(v.classification, 'auto_provision_candidate')
  assert.equal(r.plan.artifactsToArchive, 1)
  assert.ok(!has(r.findings, 'ARTIFACT_UNKNOWN_ORIGIN'))
})
test('legitimate native team (has child records) -> native, never archived, no blocker', () => {
  const { source, target } = candidateInputs()
  target.childCountsByTeam['art1'] = { Membership: 1, Device: 2 } // real data present
  const r = analyze(source, target)
  assert.equal(r.artifacts.find((a) => a.teamId === 'art1')!.classification, 'native')
  assert.equal(r.plan.artifactsToArchive, 0)
  assert.ok(!has(r.findings, 'ARTIFACT_UNKNOWN_ORIGIN'))
})
test('native via multiple members', () => {
  const { source, target } = candidateInputs()
  target.memberships.push(tm({ id: 'am2', userId: 'pu_bob', teamId: 'art1', role: 'admin' }))
  target.childCountsByTeam['art1'] = { Membership: 2 }
  assert.equal(analyze(source, target).artifacts.find((a) => a.teamId === 'art1')!.classification, 'native')
})
test('unknown-origin unmapped team (owner not migrated) -> ARTIFACT_UNKNOWN_ORIGIN (blocker), never auto-archived', () => {
  const { source, target } = candidateInputs()
  target.users = [tu({ id: 'pu_ghost', authProviderId: 'ghost_not_in_source' })]
  target.memberships = [tm({ id: 'am', userId: 'pu_ghost', teamId: 'art1', role: 'owner' })]
  const r = analyze(source, target)
  assert.equal(r.artifacts.find((a) => a.teamId === 'art1')!.classification, 'unknown')
  assert.ok(has(r.findings, 'ARTIFACT_UNKNOWN_ORIGIN'))
  assert.equal(r.hasBlockers, true)
  assert.equal(r.plan.artifactsToArchive, 0)
})
test('unmapped team with records across MULTIPLE relations is native + reports child counts', () => {
  const { source, target } = candidateInputs()
  target.childCountsByTeam['art1'] = { Membership: 1, Device: 3, Job: 5, AgentCommand: 2 }
  const r = analyze(source, target)
  const v = r.artifacts.find((a) => a.teamId === 'art1')!
  assert.equal(v.classification, 'native')
  assert.deepEqual(v.evidence.childCounts, { Membership: 1, Device: 3, Job: 5, AgentCommand: 2 })
})

// ── Determinism ──
test('analyze is deterministic (same input -> identical findings order/content)', () => {
  const { source, target } = candidateInputs()
  assert.deepEqual(analyze(source, target), analyze(source, target))
})

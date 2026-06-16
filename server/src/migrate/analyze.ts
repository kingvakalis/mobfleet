import {
  SEVERITY,
  VALID_ROLES,
  VALID_SCOPE_TYPES,
  VALID_STATUSES,
  type ArtifactVerdict,
  type ConflictCode,
  type Finding,
  type InventoryReport,
  type Severity,
  type SourceSnapshot,
  type SrcMember,
  type TargetSnapshot,
  type TgtMembership,
} from './types'

// Pure analysis of a Supabase source snapshot vs a Prisma target snapshot. No I/O, no
// clock, no randomness -> fully deterministic + unit-testable. Produces every conflict
// code, classifies unmapped Prisma teams, and computes the migration plan + blockers.

const INVITE_STATUSES = ['pending', 'accepted', 'revoked', 'expired']
const AUTO_PROVISION_NAME = /(?:'s Workspace|’s Workspace)$/
const ALL_DEFAULT_NAME = 'My Workspace'

const norm = (e: string | null | undefined): string | null => {
  const v = (e ?? '').trim().toLowerCase()
  return v.length ? v : null
}
const tokenFingerprint = (t: string): string => `tok_***${t.slice(-4)}`
const maskEmail = (e: string | null): string => {
  const n = norm(e)
  if (!n) return '(none)'
  const [u, d] = n.split('@')
  return `${u.slice(0, 1)}***@${d ?? ''}`
}
const isStringArray = (v: unknown): boolean => Array.isArray(v) && v.every((x) => typeof x === 'string')
const isOverrides = (v: unknown): boolean => {
  if (v === null || v === undefined) return true
  if (typeof v !== 'object' || Array.isArray(v)) return false
  return Object.values(v as Record<string, unknown>).every((x) => x === 'allow' || x === 'deny')
}
const scopeKey = (m: { scopeType: string; scopeGroups: unknown; scopePhones: unknown; overrides: unknown }): string =>
  JSON.stringify([m.scopeType ?? 'workspace', m.scopeGroups ?? [], m.scopePhones ?? [], m.overrides ?? {}])

export function analyze(source: SourceSnapshot, target: TargetSnapshot): InventoryReport {
  const findings: Finding[] = []
  const seen = new Set<string>()
  const add = (code: ConflictCode, entity: Finding['entity'], ref: string, detail: string, evidence?: Record<string, unknown>): void => {
    const key = `${code}|${ref}`
    if (seen.has(key)) return
    seen.add(key)
    findings.push({ code, severity: SEVERITY[code], entity, ref, detail, evidence })
  }

  // ── Source indices ──
  const authById = new Map(source.authUsers.map((u) => [u.id, u]))
  const authByEmail = new Map<string, typeof source.authUsers>()
  for (const u of source.authUsers) {
    const e = norm(u.email)
    if (!e) continue
    ;(authByEmail.get(e) ?? authByEmail.set(e, []).get(e)!).push(u)
  }
  const membersByTeam = new Map<string, SrcMember[]>()
  const membersByUser = new Map<string, SrcMember[]>()
  for (const m of source.members) {
    ;(membersByTeam.get(m.teamId) ?? membersByTeam.set(m.teamId, []).get(m.teamId)!).push(m)
    ;(membersByUser.get(m.userId) ?? membersByUser.set(m.userId, []).get(m.userId)!).push(m)
  }

  // ── Target indices ──
  const tgtUserByAuthId = new Map(target.users.map((u) => [u.authProviderId, u]))
  const tgtUserById = new Map(target.users.map((u) => [u.id, u]))
  const tgtUsersByEmail = new Map<string, typeof target.users>()
  for (const u of target.users) {
    const e = norm(u.email)
    if (!e) continue
    ;(tgtUsersByEmail.get(e) ?? tgtUsersByEmail.set(e, []).get(e)!).push(u)
  }
  const tgtTeamBySupabaseId = new Map<string, typeof target.teams[number]>()
  const supaIdCount = new Map<string, number>()
  for (const t of target.teams) {
    if (t.supabaseTeamId) {
      tgtTeamBySupabaseId.set(t.supabaseTeamId, t)
      supaIdCount.set(t.supabaseTeamId, (supaIdCount.get(t.supabaseTeamId) ?? 0) + 1)
    }
  }
  const tgtMembersByTeam = new Map<string, TgtMembership[]>()
  for (const m of target.memberships) (tgtMembersByTeam.get(m.teamId) ?? tgtMembersByTeam.set(m.teamId, []).get(m.teamId)!).push(m)
  const tgtInviteByToken = new Map(target.invites.map((i) => [i.token, i]))

  // ── Identity: duplicate Supabase emails ──
  for (const [email, users] of authByEmail) {
    if (users.length > 1) add('IDENT_DUP_SUPABASE_EMAIL', 'user', maskEmail(email), `${users.length} Supabase auth users share this normalized email`, { uids: users.map((u) => u.id) })
  }
  // ── Identity: duplicate target authProviderId (defensive; @unique should prevent) ──
  const tgtAuthIdCount = new Map<string, number>()
  for (const u of target.users) tgtAuthIdCount.set(u.authProviderId, (tgtAuthIdCount.get(u.authProviderId) ?? 0) + 1)
  for (const [aid, n] of tgtAuthIdCount) if (n > 1) add('IDENT_DUP_AUTH_PROVIDER_ID', 'user', aid, `authProviderId appears on ${n} Prisma users`)

  // ── Identity: per-source-user checks ──
  for (const u of source.authUsers) {
    const srcEmail = norm(u.email)
    // email changed between auth.users and any team_members snapshot for this uid
    const memberEmails = new Set((membersByUser.get(u.id) ?? []).map((m) => norm(m.email)).filter((e): e is string => !!e))
    if (srcEmail) memberEmails.add(srcEmail)
    if (memberEmails.size > 1) add('IDENT_EMAIL_CHANGED', 'user', u.id, 'auth.users email differs from a team_members email for this user (will use the current auth.users email)', { emails: [...memberEmails].map(maskEmail) })

    const tgtByAuth = tgtUserByAuthId.get(u.id)
    if (tgtByAuth && srcEmail && norm(tgtByAuth.email) !== srcEmail) {
      add('IDENT_PRISMA_AUTHID_EMAIL_CONFLICT', 'user', u.id, 'existing Prisma user has the same authProviderId but a different email', { prisma: maskEmail(tgtByAuth.email), source: maskEmail(srcEmail) })
    }
    if (srcEmail) {
      const tgtByEmail = tgtUsersByEmail.get(srcEmail) ?? []
      for (const te of tgtByEmail) {
        if (te.authProviderId !== u.id) add('IDENT_PRISMA_EMAIL_DIFF_AUTHID', 'user', maskEmail(srcEmail), 'existing Prisma user has this email under a DIFFERENT authProviderId', { prismaAuthId: te.authProviderId, sourceAuthId: u.id })
      }
    }
  }
  // ── Identity: Prisma email-uniqueness conflicts for users we would CREATE ──
  const toCreateEmail = new Map<string, string[]>() // normEmail -> source uids to create
  for (const u of source.authUsers) {
    if (tgtUserByAuthId.has(u.id)) continue // already mapped by authProviderId -> update, not insert
    const e = norm(u.email)
    if (!e) continue
    ;(toCreateEmail.get(e) ?? toCreateEmail.set(e, []).get(e)!).push(u.id)
  }
  for (const [email, uids] of toCreateEmail) {
    const existingDiff = (tgtUsersByEmail.get(email) ?? []).filter((t) => !uids.includes(t.authProviderId))
    if (uids.length > 1 || existingDiff.length > 0) {
      add('IDENT_PRISMA_EMAIL_UNIQUE_CONFLICT', 'user', maskEmail(email), 'creating the migrated user(s) would violate Prisma User.email @unique', { newUids: uids, existingAuthIds: existingDiff.map((t) => t.authProviderId) })
    }
  }

  // ── Source: membership/owner reference an existing auth user ──
  const dupMembership = new Map<string, number>()
  for (const m of source.members) {
    const k = `${m.teamId}|${m.userId}`
    dupMembership.set(k, (dupMembership.get(k) ?? 0) + 1)
    if (!authById.has(m.userId)) add('IDENT_MISSING_AUTH_USER', 'membership', `${m.teamId}:${m.userId}`, 'team_members.user_id references an auth user that does not exist', { teamId: m.teamId })
    if (!(VALID_ROLES as readonly string[]).includes(m.role)) add('SRC_INVALID_ROLE', 'membership', `${m.teamId}:${m.userId}`, `invalid membership role ${JSON.stringify(m.role)}`)
    if (!(VALID_STATUSES as readonly string[]).includes(m.status)) add('SRC_INVALID_STATUS', 'membership', `${m.teamId}:${m.userId}`, `invalid membership status ${JSON.stringify(m.status)}`)
    if (!(VALID_SCOPE_TYPES as readonly string[]).includes(m.scopeType) || (m.scopeGroups != null && !isStringArray(m.scopeGroups)) || (m.scopePhones != null && !isStringArray(m.scopePhones))) {
      add('SRC_MALFORMED_SCOPE', 'membership', `${m.teamId}:${m.userId}`, 'invalid scope_type or non-string[] scope_groups/scope_phones')
    }
    if (!isOverrides(m.overrides)) add('SRC_MALFORMED_OVERRIDES', 'membership', `${m.teamId}:${m.userId}`, 'overrides is not an object of {permission: allow|deny}')
  }
  for (const [k, n] of dupMembership) if (n > 1) add('SRC_DUP_MEMBERSHIP', 'membership', k, `duplicate source membership rows (${n}) for the same (team,user)`)

  // ── Source: per-team ownership ──
  for (const t of source.teams) {
    const tMembers = membersByTeam.get(t.id) ?? []
    const ownerUids = new Set(tMembers.filter((m) => m.role === 'owner').map((m) => m.userId))
    const declared = t.ownerUserId
    const declaredIsMember = declared ? tMembers.some((m) => m.userId === declared) : false
    if (ownerUids.size === 0 && !declaredIsMember) add('SRC_TEAM_NO_OWNER', 'team', t.id, 'source team has no owner membership and owner_user_id is unresolvable')
    if (declared && ownerUids.size > 0 && !ownerUids.has(declared)) add('SRC_TEAM_AMBIGUOUS_OWNER', 'team', t.id, 'teams.owner_user_id disagrees with the owner membership(s)', { declared, ownerMemberships: [...ownerUids] })
  }

  // ── Source: invites ──
  for (const inv of source.invites) {
    if (!(VALID_ROLES as readonly string[]).includes(inv.role)) add('SRC_INVALID_ROLE', 'invite', inv.id, `invalid invite role ${JSON.stringify(inv.role)}`)
    if (!INVITE_STATUSES.includes(inv.status)) add('SRC_INVALID_STATUS', 'invite', inv.id, `invalid invite status ${JSON.stringify(inv.status)}`)
    if (inv.invitedBy && !authById.has(inv.invitedBy)) add('IDENT_MISSING_INVITED_BY', 'invite', inv.id, 'invite.invited_by references a missing auth user (will map to null)')
    const recipients = authByEmail.get(norm(inv.email) ?? '') ?? []
    if (recipients.length > 1) add('IDENT_INVITE_RECIPIENT_AMBIGUOUS', 'invite', inv.id, 'invite email matches multiple Supabase auth users', { count: recipients.length })
    // target token collision: same token, different team/email/status
    const tgt = tgtInviteByToken.get(inv.token)
    if (tgt) {
      const sameTeam = tgtTeamBySupabaseId.get(inv.teamId)?.id === tgt.teamId
      if (!sameTeam || norm(tgt.email) !== norm(inv.email) || tgt.status !== inv.status) {
        add('TGT_INVITE_TOKEN_COLLISION', 'invite', tokenFingerprint(inv.token), 'invite token already exists in Prisma for a different team/email/status', { sourceTeamId: inv.teamId })
      }
    }
  }

  // ── Target: duplicate supabaseTeamId (defensive) + mapped-team membership conflicts ──
  for (const [sid, n] of supaIdCount) if (n > 1) add('TGT_SUPABASE_ID_UNEXPECTED_TEAM', 'team', sid, `supabaseTeamId is claimed by ${n} Prisma teams`)
  let teamsAlreadyMapped = 0
  for (const t of source.teams) {
    const mapped = tgtTeamBySupabaseId.get(t.id)
    if (!mapped) continue
    teamsAlreadyMapped++
    const tgtM = tgtMembersByTeam.get(mapped.id) ?? []
    const tgtMByUserAuth = new Map<string, TgtMembership>()
    for (const tm of tgtM) {
      const au = tgtUserById.get(tm.userId)
      if (au) tgtMByUserAuth.set(au.authProviderId, tm)
    }
    for (const sm of membersByTeam.get(t.id) ?? []) {
      const existing = tgtMByUserAuth.get(sm.userId)
      if (!existing) continue
      if (existing.role !== sm.role || existing.status !== sm.status || scopeKey(existing) !== scopeKey(sm)) {
        add('TGT_MEMBERSHIP_CONFLICT', 'membership', `${t.id}:${sm.userId}`, 'mapped-team membership in Prisma differs from source (role/status/scope/overrides)', { source: { role: sm.role, status: sm.status }, prisma: { role: existing.role, status: existing.status } })
      }
    }
  }

  // ── Artifact classification of unmapped, active Prisma teams ──
  const artifacts: ArtifactVerdict[] = []
  for (const t of target.teams) {
    if (t.supabaseTeamId !== null || t.archivedAt !== null) continue
    const tm = tgtMembersByTeam.get(t.id) ?? []
    const owners = tm.filter((m) => m.role === 'owner')
    const childCounts = target.childCountsByTeam[t.id] ?? {}
    const hasChildren = Object.entries(childCounts).some(([model, c]) => model !== 'Membership' && c > 0)
    const auditCount = target.auditCountByTeam[t.id] ?? 0
    const nameMatches = AUTO_PROVISION_NAME.test(t.name) || t.name === ALL_DEFAULT_NAME

    let ownerIsMigrated = false
    let createdAfter: boolean | null = null
    if (owners.length === 1) {
      const ownerUser = tgtUserById.get(owners[0].userId)
      const srcUid = ownerUser?.authProviderId
      const srcMems = srcUid ? membersByUser.get(srcUid) ?? [] : []
      ownerIsMigrated = !!srcUid && authById.has(srcUid) && srcMems.length > 0
      const joinTimes = srcMems.map((m) => (m.joinedAt ? Date.parse(m.joinedAt) : NaN)).filter((n) => !Number.isNaN(n))
      if (joinTimes.length) createdAfter = Math.min(...joinTimes) < t.createdAt
    }

    let classification: ArtifactVerdict['classification']
    if (hasChildren || tm.length > 1) classification = 'native'
    else if (tm.length === 1 && owners.length === 1 && nameMatches && ownerIsMigrated && auditCount === 0 && createdAfter === true) classification = 'auto_provision_candidate'
    else classification = 'unknown'

    artifacts.push({ teamId: t.id, teamName: t.name, classification, evidence: { memberCount: tm.length, ownerCount: owners.length, hasChildren, childCounts, auditCount, nameMatchesAutoProvisionPattern: nameMatches, ownerIsMigrated, createdAfterOwnerSupabaseMembership: createdAfter } })
    if (classification === 'unknown') add('ARTIFACT_UNKNOWN_ORIGIN', 'team', t.id, `unmapped Prisma team "${t.name}" cannot be confidently classified -- manual decision required (never auto-archived)`, { memberCount: tm.length, hasChildren })
  }

  // ── Plan ──
  const referencedUids = new Set<string>()
  for (const m of source.members) referencedUids.add(m.userId)
  for (const t of source.teams) if (t.ownerUserId) referencedUids.add(t.ownerUserId)
  const usersToCreate = [...referencedUids].filter((uid) => authById.has(uid) && !tgtUserByAuthId.has(uid)).length
  const teamsToCreate = source.teams.filter((t) => !tgtTeamBySupabaseId.has(t.id)).length
  const artifactsToArchive = artifacts.filter((a) => a.classification === 'auto_provision_candidate').length

  // ── Counts + blockers ──
  const byCode: Record<string, number> = {}
  const bySeverity: Record<Severity, number> = { blocker: 0, warn: 0, info: 0 }
  for (const f of findings) {
    byCode[f.code] = (byCode[f.code] ?? 0) + 1
    bySeverity[f.severity]++
  }
  const blockers = findings.filter((f) => f.severity === 'blocker')

  return {
    generatedAt: null,
    targetReadOnly: null, // set by the script after the target read-only pre-flight
    source: { authUsers: source.authUsers.length, teams: source.teams.length, members: source.members.length, invites: source.invites.length, proof: source.proof },
    target: {
      users: target.users.length,
      teams: target.teams.length,
      mappedTeams: tgtTeamBySupabaseId.size,
      unmappedActiveTeams: target.teams.filter((t) => t.supabaseTeamId === null && t.archivedAt === null).length,
      archivedTeams: target.teams.filter((t) => t.archivedAt !== null).length,
      memberships: target.memberships.length,
      invites: target.invites.length,
    },
    plan: { usersToCreate, teamsToCreate, teamsAlreadyMapped, membershipsToUpsert: source.members.length, invitesToMigrate: source.invites.length, artifactsToArchive },
    artifacts,
    findings,
    blockers,
    counts: { byCode, bySeverity },
    hasBlockers: blockers.length > 0,
  }
}

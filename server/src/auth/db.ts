import { randomUUID, randomBytes } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '../db'
import { env } from '../env'
import { forbidden } from '../http-error'
import { ROLE_TEMPLATES, type RoleId } from '../../../src/lib/authorization/roles'
import type { Member } from '../../../src/lib/authorization/effective-access'
import type { AccessScope, ScopeType } from '../../../src/lib/authorization/scopes'
import type { Identity } from './identity'

export const isRoleId = (r: string): r is RoleId => r in ROLE_TEMPLATES

/** The resolved tenant context attached to every authenticated request. */
export interface AuthContext {
  userId: string
  email: string
  name?: string
  emailVerified: boolean
  teamId: string
  teamName: string
  role: RoleId
  membershipId: string
  /** The acting member's resolved resource scope (from their membership row). */
  scope: AccessScope
  /** The acting member's per-permission overrides (from their membership row), so
   *  server-side can()/requirePermission honour deny + allow, not just the UI. */
  overrides: Member['overrides']
}

const id = (prefix: string) => `${prefix}_${randomUUID()}`

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

/** Build a resource scope from membership columns (default: whole workspace). */
export function buildScope(scopeType?: string | null, scopeGroups?: unknown, scopePhones?: unknown): AccessScope {
  const type: ScopeType =
    scopeType === 'assigned_groups' || scopeType === 'assigned_phones' || scopeType === 'self'
      ? scopeType
      : 'workspace'
  return { type, groups: asStringArray(scopeGroups), phones: asStringArray(scopePhones) }
}

/** Read the persisted overrides JSON into the engine's override map. Defensive:
 *  null/undefined/non-object → {}, and only 'allow' | 'deny' values are kept, so a
 *  malformed column can never inject a bad effect. */
export function parseOverrides(v: unknown): Member['overrides'] {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: Member['overrides'] = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (val === 'allow' || val === 'deny') out[k as keyof Member['overrides']] = val
  }
  return out
}

/** Map a Membership row to the authorization engine's Member shape, including
 *  suspension status, the member's real resource scope, AND their per-permission
 *  overrides. The teamId boundary is still the hard tenant isolation; scope +
 *  overrides narrow/adjust access WITHIN the team. */
export function toMember(m: {
  userId: string
  role: string
  status?: string | null
  scopeType?: string | null
  scopeGroups?: unknown
  scopePhones?: unknown
  overrides?: unknown
}): Member {
  return {
    id: m.userId,
    role: isRoleId(m.role) ? m.role : 'viewer',
    suspended: m.status === 'suspended',
    overrides: parseOverrides(m.overrides),
    scope: buildScope(m.scopeType, m.scopeGroups, m.scopePhones),
  }
}

/** Upsert the User for a verified identity (keeps email/name fresh). */
export async function ensureUser(identity: Identity) {
  return prisma.user.upsert({
    where: { authProviderId: identity.providerUserId },
    update: { email: identity.email, name: identity.name ?? null },
    create: {
      id: id('user'),
      authProviderId: identity.providerUserId,
      email: identity.email,
      name: identity.name ?? null,
      createdAt: Date.now(),
    },
  })
}

/** Advisory-lock namespace for first-team provisioning (see ensureFirstTeam). */
const ONBOARD_LOCK_NS = 0x4d46 // 'MF'

/** Name for a first team: the signup-supplied name, else a personal default. Pure. */
export function resolveTeamName(preferred: string | undefined, name: string | null, email: string): string {
  const trimmed = preferred?.trim()
  if (trimmed) return trimmed
  const base = (name?.trim() || email.split('@')[0] || 'My').trim() || 'My'
  return `${base}'s Workspace`
}

export type MembershipClassification<M> =
  | { status: 'onboarding' }
  | { status: 'suspended' }
  | { status: 'ready'; chosen: M }

/**
 * Select the membership a request acts on, PREFERRING an active one. A suspended
 * membership in one team never blocks a valid active membership in another:
 * 'suspended' is returned only when memberships exist but NONE are active. An
 * explicit (forge-resistant) requestedTeamId is honoured only if the user has an
 * ACTIVE membership in it. Input is expected pre-ordered by createdAt (first active
 * wins). Pure — DB-free, unit-tested.
 *
 * This is the LENIENT selection for /v1/me + every business route: an unknown or
 * stale requestedTeamId silently falls back to a valid active team, so a removed/
 * deleted/no-longer-existing selected team never wedges the session. The DELIBERATE
 * team-switch endpoint uses selectTeamStrict, which REJECTS rather than falling back.
 */
export function classifyMembership<M extends { teamId: string; status: string }>(
  memberships: M[],
  requestedTeamId?: string,
): MembershipClassification<M> {
  if (memberships.length === 0) return { status: 'onboarding' }
  const requested = requestedTeamId ? memberships.find((m) => m.teamId === requestedTeamId) : undefined
  if (requested && requested.status === 'active') return { status: 'ready', chosen: requested }
  const active = memberships.find((m) => m.status === 'active')
  if (active) return { status: 'ready', chosen: active }
  return { status: 'suspended' }
}

/** Outcome of a DELIBERATE team switch (POST /v1/me/team). Unlike classifyMembership
 *  this NEVER falls back to another team — an unauthorized/suspended selection is an
 *  explicit rejection the route maps to 403, so the client can't be silently switched
 *  to a team it never asked for. */
export type StrictSelection<M> =
  | { status: 'ready'; chosen: M }
  | { status: 'not_member' } // no membership in that team (or it no longer exists) — concealed as not-a-member
  | { status: 'suspended' }  // a membership exists but is suspended there

/**
 * Validate a deliberately-requested team: the caller must have an ACTIVE membership
 * in EXACTLY that team. No fallback — a forged/foreign/removed/deleted team is
 * 'not_member' (which conceals whether the team exists at all from a non-member) and
 * a suspended membership there is 'suspended'. Pure — DB-free, unit-tested.
 */
export function selectTeamStrict<M extends { teamId: string; status: string }>(
  memberships: M[],
  requestedTeamId: string,
): StrictSelection<M> {
  const m = memberships.find((x) => x.teamId === requestedTeamId)
  if (!m) return { status: 'not_member' }
  if (m.status !== 'active') return { status: 'suspended' }
  return { status: 'ready', chosen: m }
}

export interface FirstTeamUser { id: string; email: string; name: string | null }

export type ProvisionResult =
  | { ok: true; created: boolean; team: { id: string; name: string }; membership: { id: string; teamId: string; role: string; status: string } }
  | { ok: false; reason: 'pending_invite'; invite: { id: string; teamId: string; teamName: string; role: string } }

/**
 * Create the user's FIRST team (as owner), idempotently and RACE-SAFELY. A
 * PostgreSQL transaction-scoped advisory lock keyed on the user serializes ALL
 * concurrent first-team creation for that user (deliberate onboarding AND legacy
 * auto-provision): the winner creates the team and commits (releasing the lock); a
 * loser blocks, then its post-lock re-check sees the committed membership and ADOPTS
 * it (created:false) — so at most one first team can ever exist (`@@unique[userId,
 * teamId]` alone can't prevent two DIFFERENT teams). The lock is transaction-scoped
 * → auto-released and held on this interactive tx's single connection (pooler-safe).
 *
 * opts.rejectPendingInvite=true (deliberate /v1/onboarding/team): a pending invite
 * for the email blocks personal-team creation (invite precedence → caller returns
 * 409). false (legacy auto-provision in resolveAuthContext): provision regardless of
 * invites, preserving current behavior. `db` is injectable for integration tests.
 */
export async function ensureFirstTeam(
  user: FirstTeamUser,
  name?: string,
  opts: { rejectPendingInvite?: boolean } = {},
  db: PrismaClient = prisma,
): Promise<ProvisionResult> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ONBOARD_LOCK_NS}::int4, hashtext(${user.id}))`
    const active = await tx.membership.findFirst({ where: { userId: user.id, status: 'active' }, include: { team: true } })
    if (active) {
      return { ok: true, created: false, team: { id: active.team.id, name: active.team.name }, membership: { id: active.id, teamId: active.teamId, role: active.role, status: active.status } }
    }
    if (opts.rejectPendingInvite) {
      const invite = await tx.invite.findFirst({ where: { email: user.email.toLowerCase(), status: 'pending' }, include: { team: true } })
      if (invite && invite.expiresAt >= Date.now()) {
        return { ok: false, reason: 'pending_invite', invite: { id: invite.id, teamId: invite.teamId, teamName: invite.team.name, role: invite.role } }
      }
    }
    const now = Date.now()
    const team = await tx.team.create({ data: { id: id('team'), name: resolveTeamName(name, user.name, user.email), createdAt: now } })
    const membership = await tx.membership.create({ data: { id: id('mem'), userId: user.id, teamId: team.id, role: 'owner', status: 'active', createdAt: now } })
    return { ok: true, created: true, team: { id: team.id, name: team.name }, membership: { id: membership.id, teamId: membership.teamId, role: membership.role, status: membership.status } }
  })
}

/** A pending, non-expired invite for an email (the caller's own, by JWT email), as
 *  a safe summary for /v1/me. Returns null when none. */
export async function findPendingInviteForEmail(email: string, db: PrismaClient = prisma) {
  const inv = await db.invite.findFirst({
    where: { email: email.toLowerCase(), status: 'pending' },
    include: { team: true },
    orderBy: { createdAt: 'desc' },
  })
  if (!inv || inv.expiresAt < Date.now()) return null
  return { id: inv.id, teamId: inv.teamId, teamName: inv.team.name, role: inv.role }
}

/** Resolve the authoritative /v1/me state for an already-ensured user WITHOUT
 *  auto-provisioning — so a no-team user is reported as onboarding-required. A DB
 *  error propagates (the caller returns 500); it is NEVER reported as onboarding.
 *  Returns the full membership roster too (createdAt asc) so the caller can build the
 *  switchable-team list AND apply a strict selection (deliberate switch) without a
 *  second query. */
export async function resolveMeState(user: FirstTeamUser, requestedTeamId?: string, db: PrismaClient = prisma) {
  const memberships = await db.membership.findMany({ where: { userId: user.id }, include: { team: true }, orderBy: { createdAt: 'asc' } })
  const classification = classifyMembership(memberships, requestedTeamId)
  const pendingInvite = await findPendingInviteForEmail(user.email, db)
  return { memberships, classification, pendingInvite }
}

/**
 * Resolve the tenant context for an authenticated request (the legacy 'team' auth
 * path used by every business route). Honours an explicit teamId only if the user
 * has an ACTIVE membership in it; otherwise selects their first ACTIVE membership
 * (a suspended membership no longer blocks a valid active one). With no membership,
 * auto-provisions a personal team when enabled — now via the race-safe ensureFirstTeam
 * (rejectPendingInvite:false → provision regardless of invites, exactly as before).
 */
export async function resolveAuthContext(identity: Identity, requestedTeamId?: string, preferredTeamName?: string): Promise<AuthContext> {
  const user = await ensureUser(identity)
  let memberships = await prisma.membership.findMany({ where: { userId: user.id }, include: { team: true }, orderBy: { createdAt: 'asc' } })
  let cls = classifyMembership(memberships, requestedTeamId)

  if (cls.status === 'onboarding') {
    if (!env.autoProvisionTeam) throw new Error('no team membership — you must be invited to a workspace')
    await ensureFirstTeam({ id: user.id, email: user.email, name: user.name }, preferredTeamName, { rejectPendingInvite: false })
    memberships = await prisma.membership.findMany({ where: { userId: user.id }, include: { team: true }, orderBy: { createdAt: 'asc' } })
    cls = classifyMembership(memberships, requestedTeamId)
  }

  // SECURITY: a SUSPENDED member (no active membership anywhere) gets NO context, so
  // every authenticated route + the WS upgrade rejects them — read fresh from the DB
  // on every request, so suspension takes effect immediately. 403, not 401.
  if (cls.status === 'suspended') throw forbidden('your workspace membership is suspended')
  if (cls.status !== 'ready') throw new Error('failed to resolve a workspace') // unreachable after provisioning
  const chosen = cls.chosen

  return {
    userId: user.id,
    email: user.email,
    name: user.name ?? undefined,
    emailVerified: identity.emailVerified,
    teamId: chosen.teamId,
    teamName: chosen.team.name,
    role: isRoleId(chosen.role) ? chosen.role : 'viewer',
    membershipId: chosen.id,
    scope: buildScope(chosen.scopeType, chosen.scopeGroups, chosen.scopePhones),
    overrides: parseOverrides(chosen.overrides),
  }
}

/** Append an authorization/audit event (best-effort; never blocks the action,
 *  never stores secrets). */
export async function logAudit(entry: {
  teamId: string
  actorId: string
  action: string
  target?: string
  result: 'allowed' | 'denied'
  detail?: string
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        id: id('aud'),
        teamId: entry.teamId,
        actorId: entry.actorId,
        action: entry.action,
        target: entry.target ?? null,
        result: entry.result,
        detail: entry.detail ?? null,
        createdAt: Date.now(),
      },
    })
  } catch (e) {
    console.error('[audit]', e instanceof Error ? e.message : e)
  }
}

// ─── Members ─────────────────────────────────────────────────────────────────

export async function listTeamMembers(teamId: string) {
  return prisma.membership.findMany({
    where: { teamId },
    include: { user: true },
    orderBy: { createdAt: 'asc' },
  })
}

export async function teamMembersAsMembers(teamId: string): Promise<Member[]> {
  const rows = await listTeamMembers(teamId)
  return rows.map(toMember)
}

// ─── Invites ─────────────────────────────────────────────────────────────────

export function newInviteToken(): string {
  return randomBytes(32).toString('base64url')
}

export async function createInvite(args: { teamId: string; email: string; role: RoleId; invitedByUserId: string }) {
  const now = Date.now()
  return prisma.invite.create({
    data: {
      id: id('inv'),
      teamId: args.teamId,
      email: args.email.toLowerCase(),
      role: args.role,
      token: newInviteToken(),
      status: 'pending',
      invitedByUserId: args.invitedByUserId,
      createdAt: now,
      expiresAt: now + env.inviteTtlMs,
    },
  })
}

export async function listPendingInvites(teamId: string) {
  return prisma.invite.findMany({ where: { teamId, status: 'pending' }, orderBy: { createdAt: 'desc' } })
}

/** A pending, non-expired invite by token (the public accept lookup). */
export async function getValidInviteByToken(token: string) {
  const inv = await prisma.invite.findUnique({ where: { token } })
  if (!inv || inv.status !== 'pending') return null
  if (inv.expiresAt < Date.now()) return null
  return inv
}

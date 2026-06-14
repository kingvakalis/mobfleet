import { randomUUID, randomBytes } from 'node:crypto'
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

/** Map a Membership row to the authorization engine's Member shape, including
 *  suspension status and the member's real resource scope. The teamId boundary
 *  is still the hard tenant isolation; scope narrows access WITHIN the team. */
export function toMember(m: {
  userId: string
  role: string
  status?: string | null
  scopeType?: string | null
  scopeGroups?: unknown
  scopePhones?: unknown
}): Member {
  return {
    id: m.userId,
    role: isRoleId(m.role) ? m.role : 'viewer',
    suspended: m.status === 'suspended',
    overrides: {},
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

/** Create a workspace owned by the user (first-login onboarding). Uses the
 *  signup-supplied name when present, else a personal default. */
export async function createPersonalTeam(userId: string, displayName: string, preferredName?: string) {
  const teamId = id('team')
  const now = Date.now()
  const name = preferredName?.trim() || `${displayName}'s Workspace`
  const team = await prisma.team.create({ data: { id: teamId, name, createdAt: now } })
  const membership = await prisma.membership.create({
    data: { id: id('mem'), userId, teamId, role: 'owner', createdAt: now },
  })
  return { team, membership }
}

/**
 * Resolve which team this request acts on. Honours an explicit teamId (only if
 * the user is a member of it — never trust a client-supplied tenant id blindly),
 * else the user's first membership. With no membership, optionally onboards a
 * personal team.
 */
export async function resolveAuthContext(identity: Identity, requestedTeamId?: string, preferredTeamName?: string): Promise<AuthContext> {
  const user = await ensureUser(identity)
  let memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    include: { team: true },
    orderBy: { createdAt: 'asc' },
  })

  if (memberships.length === 0) {
    if (!env.autoProvisionTeam) throw new Error('no team membership — you must be invited to a workspace')
    const created = await createPersonalTeam(user.id, user.name ?? user.email.split('@')[0], preferredTeamName)
    memberships = await prisma.membership.findMany({
      where: { id: created.membership.id },
      include: { team: true },
    })
  }

  // SECURITY: an explicit teamId is honoured ONLY if the user truly belongs to
  // it. Otherwise fall back to their first membership — a forged x-team-id can
  // never grant access to a team the user isn't a member of.
  const chosen = (requestedTeamId && memberships.find((m) => m.teamId === requestedTeamId)) || memberships[0]

  // SECURITY: a SUSPENDED member gets NO authorization context, so every
  // authenticated route (and the WS upgrade) rejects them — even with a still
  // -valid JWT. This is read fresh from the DB on every request, so suspension
  // (like any role change) takes effect immediately, never waiting for the JWT
  // to expire. 403, not 401: they are authenticated but not permitted.
  if (chosen.status === 'suspended') {
    throw forbidden('your workspace membership is suspended')
  }

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

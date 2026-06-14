import { randomUUID, randomBytes } from 'node:crypto'
import { prisma } from '../db'
import { env } from '../env'
import { ROLE_TEMPLATES, type RoleId } from '../../../src/lib/authorization/roles'
import type { Member } from '../../../src/lib/authorization/effective-access'
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
}

const id = (prefix: string) => `${prefix}_${randomUUID()}`

/** Map a Membership row to the authorization engine's Member shape. Server-side
 *  scope is workspace-wide (the teamId boundary is the hard tenant isolation);
 *  per-member group/phone scoping is a future enhancement layered on top. */
export function toMember(m: { userId: string; role: string }): Member {
  return {
    id: m.userId,
    role: (isRoleId(m.role) ? m.role : 'viewer'),
    overrides: {},
    scope: { type: 'workspace', groups: [], phones: [] },
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

/** Create a personal workspace owned by the user (first-login onboarding). */
export async function createPersonalTeam(userId: string, displayName: string) {
  const teamId = id('team')
  const now = Date.now()
  const team = await prisma.team.create({ data: { id: teamId, name: `${displayName}'s Workspace`, createdAt: now } })
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
export async function resolveAuthContext(identity: Identity, requestedTeamId?: string): Promise<AuthContext> {
  const user = await ensureUser(identity)
  let memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    include: { team: true },
    orderBy: { createdAt: 'asc' },
  })

  if (memberships.length === 0) {
    if (!env.autoProvisionTeam) throw new Error('no team membership — you must be invited to a workspace')
    const created = await createPersonalTeam(user.id, user.name ?? user.email.split('@')[0])
    memberships = await prisma.membership.findMany({
      where: { id: created.membership.id },
      include: { team: true },
    })
  }

  // SECURITY: an explicit teamId is honoured ONLY if the user truly belongs to
  // it. Otherwise fall back to their first membership — a forged x-team-id can
  // never grant access to a team the user isn't a member of.
  const chosen = (requestedTeamId && memberships.find((m) => m.teamId === requestedTeamId)) || memberships[0]

  return {
    userId: user.id,
    email: user.email,
    name: user.name ?? undefined,
    emailVerified: identity.emailVerified,
    teamId: chosen.teamId,
    teamName: chosen.team.name,
    role: isRoleId(chosen.role) ? chosen.role : 'viewer',
    membershipId: chosen.id,
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

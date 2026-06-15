import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { prisma } from '../db'
import { env } from '../env'
import { actor, ctx, requirePermission } from '../auth/context'
import {
  createInvite, getValidInviteByToken, isRoleId, listPendingInvites,
  listTeamMembers, logAudit, teamMembersAsMembers,
} from '../auth/db'
import { sendInviteEmail } from '../mailer'
import { badRequest, forbidden, notFound } from '../http-error'
import {
  can, canAssignRole, canChangeRole, canManageMember, canRemoveMember, isLastOwner,
} from '../../../src/lib/authorization/effective-access'
import { ROLE_TEMPLATES, type RoleId } from '../../../src/lib/authorization/roles'
import { ALL_PERMISSION_KEYS, type PermissionKey } from '../../../src/lib/authorization/permissions'

const roleSchema = z.enum(['owner', 'admin', 'manager', 'operator', 'viewer'])
const inviteBody = z.object({ email: z.string().email(), role: roleSchema })
const acceptBody = z.object({ token: z.string().min(1) })
// Per-permission overrides: { [permissionKey]: 'allow' | 'deny' } (key absent =
// inherit). The frontend sends the complete merged map; we persist it wholesale.
const overridesSchema = z.record(z.string(), z.enum(['allow', 'deny']))
const memberPatch = z
  .object({
    role: roleSchema.optional(),
    status: z.enum(['active', 'suspended']).optional(),
    scopeType: z.enum(['workspace', 'assigned_groups', 'assigned_phones', 'self']).optional(),
    scopeGroups: z.array(z.string()).optional(),
    scopePhones: z.array(z.string()).optional(),
    overrides: overridesSchema.optional(),
  })
  .refine((b) => b.role || b.status || b.scopeType || b.scopeGroups || b.scopePhones || b.overrides, {
    message: 'no changes provided',
  })

const publicInvite = (i: { id: string; email: string; role: string; status: string; createdAt: number; expiresAt: number }) => ({
  id: i.id, email: i.email, role: i.role, status: i.status, createdAt: i.createdAt, expiresAt: i.expiresAt,
})

/** Shape of each row returned by GET /v1/team/members. `status` mirrors the
 *  Membership.status column (active | suspended); `overrides` mirrors the
 *  Membership.overrides JSON ({ [permissionKey]: 'allow' | 'deny' }). */
export interface TeamMemberResponse {
  userId: string
  role: string
  status: 'active' | 'suspended'
  overrides: Record<string, 'allow' | 'deny'>
  createdAt: number
  email: string
  name: string | null
  isSelf: boolean
}

/** Team membership + invitation management. All tenant-scoped + anti-escalation
 *  enforced via the shared authorization engine. */
export function registerTeamRoutes(app: FastifyInstance) {
  // ── Members ────────────────────────────────────────────────────────────────
  app.get('/v1/team/members', async (req) => {
    requirePermission(req, 'team.view')
    const rows = await listTeamMembers(ctx(req).teamId)
    return rows.map((m): TeamMemberResponse => ({
      userId: m.userId, role: m.role, createdAt: m.createdAt,
      email: m.user.email, name: m.user.name,
      // Membership.status (default 'active'); normalise any non-'suspended'
      // value to 'active' so the response type is exact.
      status: m.status === 'suspended' ? 'suspended' : 'active',
      // Membership.overrides JSON → { [permissionKey]: 'allow' | 'deny' }; null → {}.
      overrides: (m.overrides as Record<string, 'allow' | 'deny'> | null) ?? {},
      isSelf: m.userId === ctx(req).userId,
    }))
  })

  // Change a member's role / suspension / scope. Each kind of change is gated
  // by its own permission AND the role hierarchy (canManageMember/canChangeRole),
  // and every decision is audit-logged. Default-deny throughout.
  app.patch('/v1/team/members/:userId', async (req) => {
    const c = ctx(req)
    const targetUserId = (req.params as { userId: string }).userId
    const body = memberPatch.parse(req.body)
    const a = actor(req)
    const all = await teamMembersAsMembers(c.teamId)
    const target = all.find((m) => m.id === targetUserId)
    if (!target) throw notFound('member not found in this team')

    const deny = async (action: string, reason: string): Promise<never> => {
      await logAudit({ teamId: c.teamId, actorId: c.userId, action, target: targetUserId, result: 'denied', detail: reason })
      throw forbidden(reason)
    }

    const data: { role?: string; status?: string; scopeType?: string; scopeGroups?: string[]; scopePhones?: string[]; overrides?: Record<string, 'allow' | 'deny'> } = {}

    // role change — anti-escalation + hierarchy + last-owner protection
    if (body.role && body.role !== target.role) {
      const verdict = canChangeRole(a, target, body.role, all)
      if (!verdict.ok) await deny('role.change', verdict.reason ?? 'cannot change role')
      data.role = body.role
    }

    // suspend / reinstate
    if (body.status && (body.status === 'suspended') !== (target.suspended ?? false)) {
      requirePermission(req, 'team.suspend')
      if (!canManageMember(a, target)) await deny('member.suspend', 'you cannot manage this member')
      if (body.status === 'suspended' && isLastOwner(target, all)) await deny('member.suspend', 'the last owner cannot be suspended')
      data.status = body.status
    }

    // resource scope — needs the matching assign permission + hierarchy
    if (body.scopeType || body.scopeGroups || body.scopePhones) {
      if (!canManageMember(a, target)) await deny('member.scope', 'you cannot manage this member')
      const touchesGroups = body.scopeType === 'assigned_groups' || body.scopeGroups !== undefined
      const touchesPhones = body.scopeType === 'assigned_phones' || body.scopePhones !== undefined
      if (touchesGroups && !can(a, 'team.assign_groups')) await deny('member.scope', 'missing permission: team.assign_groups')
      if (touchesPhones && !can(a, 'team.assign_phones')) await deny('member.scope', 'missing permission: team.assign_phones')
      if (body.scopeType) data.scopeType = body.scopeType
      if (body.scopeGroups) data.scopeGroups = body.scopeGroups
      if (body.scopePhones) data.scopePhones = body.scopePhones
    }

    // permission overrides — needs roles.manage_permissions + hierarchy, and the
    // actor may only GRANT ('allow') a permission they themselves hold
    // (anti-escalation). 'deny' is always permitted. Unknown keys are rejected.
    if (body.overrides) {
      requirePermission(req, 'roles.manage_permissions')
      if (!canManageMember(a, target)) await deny('member.overrides', 'you cannot manage this member')
      for (const [key, effect] of Object.entries(body.overrides)) {
        if (!ALL_PERMISSION_KEYS.includes(key as PermissionKey)) throw badRequest(`unknown permission: ${key}`)
        if (effect === 'allow' && !can(a, key as PermissionKey)) {
          await deny('member.overrides', `cannot grant ${key}: you do not hold it`)
        }
      }
      data.overrides = body.overrides
    }

    if (Object.keys(data).length === 0) return { ok: true }
    await prisma.membership.update({ where: { userId_teamId: { userId: targetUserId, teamId: c.teamId } }, data })
    await logAudit({ teamId: c.teamId, actorId: c.userId, action: 'member.update', target: targetUserId, result: 'allowed', detail: Object.keys(data).join(',') })
    return { ok: true }
  })

  app.delete('/v1/team/members/:userId', async (req) => {
    const c = ctx(req)
    const targetUserId = (req.params as { userId: string }).userId
    const all = await teamMembersAsMembers(c.teamId)
    const target = all.find((m) => m.id === targetUserId)
    if (!target) throw notFound('member not found in this team')
    const verdict = canRemoveMember(actor(req), target, all)
    if (!verdict.ok) {
      await logAudit({ teamId: c.teamId, actorId: c.userId, action: 'member.remove', target: targetUserId, result: 'denied', detail: verdict.reason })
      throw forbidden(verdict.reason ?? 'cannot remove member')
    }
    await prisma.membership.delete({ where: { userId_teamId: { userId: targetUserId, teamId: c.teamId } } })
    await logAudit({ teamId: c.teamId, actorId: c.userId, action: 'member.remove', target: targetUserId, result: 'allowed' })
    return { ok: true }
  })

  // ── Invites ──────────────────────────────────────────────────────────────
  app.get('/v1/team/invites', async (req) => {
    requirePermission(req, 'team.view')
    const invites = await listPendingInvites(ctx(req).teamId)
    return invites.map(publicInvite)
  })

  app.post('/v1/team/invites', async (req) => {
    const c = ctx(req)
    requirePermission(req, 'team.invite')
    const { email, role } = inviteBody.parse(req.body)
    // Anti-escalation: you can only invite a role you are allowed to assign
    // (strictly below your own authority; only an owner may invite an owner).
    if (!canAssignRole(actor(req), role as RoleId)) {
      throw forbidden('you cannot invite a role at or above your own authority')
    }
    const normalized = email.toLowerCase()
    // Already a member?
    const existing = await prisma.membership.findFirst({ where: { teamId: c.teamId, user: { email: normalized } } })
    if (existing) throw badRequest('that email is already a member of this team')
    // Re-use a still-pending invite for the same email (refresh role/expiry).
    const pending = await prisma.invite.findFirst({ where: { teamId: c.teamId, email: normalized, status: 'pending' } })
    let invite
    if (pending) {
      invite = await prisma.invite.update({
        where: { id: pending.id },
        data: { role, expiresAt: Date.now() + env.inviteTtlMs, invitedByUserId: c.userId },
      })
    } else {
      invite = await createInvite({ teamId: c.teamId, email: normalized, role: role as RoleId, invitedByUserId: c.userId })
    }
    const acceptUrl = `${env.appUrl.replace(/\/$/, '')}/invite?token=${encodeURIComponent(invite.token)}`
    try {
      // Pass the AUTHENTICATED team id so the mailer uses this team's own Resend
      // sender config when configured (else the environment fallback).
      await sendInviteEmail({ teamId: c.teamId, to: normalized, teamName: c.teamName, inviterName: c.name ?? c.email, role, acceptUrl })
    } catch (e) {
      // Don't fail the invite if email delivery hiccups — it's recoverable
      // (the link can be resent), and the invite row already exists.
      console.error('[invite email]', e instanceof Error ? e.message : e)
    }
    return { ...publicInvite(invite), acceptUrl: env.isProd ? undefined : acceptUrl }
  })

  app.delete('/v1/team/invites/:id', async (req) => {
    const c = ctx(req)
    requirePermission(req, 'team.invite')
    const inviteId = (req.params as { id: string }).id
    // SECURITY: scope the revoke to the actor's team — you can only revoke your
    // own team's invites, never another tenant's by id.
    const invite = await prisma.invite.findFirst({ where: { id: inviteId, teamId: c.teamId } })
    if (!invite) throw notFound('invite not found')
    await prisma.invite.update({ where: { id: inviteId }, data: { status: 'revoked' } })
    return { ok: true }
  })

  // Accept an invitation (the invited user must be authenticated; the invite's
  // email must match the authenticated identity, so a leaked token can't be
  // redeemed by someone else). The role is fixed by the invite — no escalation.
  app.post('/v1/invites/accept', async (req) => {
    const c = ctx(req)
    const { token } = acceptBody.parse(req.body)
    const invite = await getValidInviteByToken(token)
    if (!invite) throw badRequest('invitation is invalid, expired, or already used')
    // The invite's email must belong to a VERIFIED identity, otherwise a leaked
    // invite link could be redeemed by anyone who merely typed the victim's
    // address at the IdP (defeating the leaked-token defense this flow promises).
    if (!c.emailVerified) throw forbidden('verify your email address before accepting an invitation')
    if (invite.email.toLowerCase() !== c.email.toLowerCase()) {
      throw forbidden('this invitation was issued to a different email address')
    }
    const role: RoleId = isRoleId(invite.role) ? invite.role : 'viewer'
    const already = await prisma.membership.findUnique({ where: { userId_teamId: { userId: c.userId, teamId: invite.teamId } } })
    if (!already) {
      await prisma.membership.create({
        data: { id: `mem_${randomUUID()}`, userId: c.userId, teamId: invite.teamId, role, createdAt: Date.now() },
      })
    }
    await prisma.invite.update({ where: { id: invite.id }, data: { status: 'accepted', acceptedAt: Date.now() } })
    const team = await prisma.team.findUnique({ where: { id: invite.teamId } })
    return { ok: true, teamId: invite.teamId, teamName: team?.name, role }
  })

  // The set of roles the current actor may assign/invite (for the client UI).
  app.get('/v1/team/assignable-roles', async (req) => {
    requirePermission(req, 'team.view')
    const a = actor(req)
    const roles = (Object.keys(ROLE_TEMPLATES) as RoleId[]).filter((r) => canAssignRole(a, r))
    return { roles }
  })
}

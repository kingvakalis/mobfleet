import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { prisma } from '../db'
import { env } from '../env'
import { actor, ctx, requirePermission } from '../auth/context'
import {
  createInvite, getValidInviteByToken, isRoleId, listPendingInvites,
  listTeamMembers, teamMembersAsMembers, toMember,
} from '../auth/db'
import { sendInviteEmail } from '../mailer'
import { badRequest, forbidden, notFound } from '../http-error'
import { canAssignRole, canChangeRole, canRemoveMember } from '../../../src/lib/authorization/effective-access'
import { ROLE_TEMPLATES, type RoleId } from '../../../src/lib/authorization/roles'

const roleSchema = z.enum(['owner', 'admin', 'manager', 'operator', 'viewer'])
const inviteBody = z.object({ email: z.string().email(), role: roleSchema })
const acceptBody = z.object({ token: z.string().min(1) })
const rolePatch = z.object({ role: roleSchema })

const publicInvite = (i: { id: string; email: string; role: string; status: string; createdAt: number; expiresAt: number }) => ({
  id: i.id, email: i.email, role: i.role, status: i.status, createdAt: i.createdAt, expiresAt: i.expiresAt,
})

/** Team membership + invitation management. All tenant-scoped + anti-escalation
 *  enforced via the shared authorization engine. */
export function registerTeamRoutes(app: FastifyInstance) {
  // ── Members ────────────────────────────────────────────────────────────────
  app.get('/v1/team/members', async (req) => {
    requirePermission(req, 'team.view')
    const rows = await listTeamMembers(ctx(req).teamId)
    return rows.map((m) => ({
      userId: m.userId, role: m.role, createdAt: m.createdAt,
      email: m.user.email, name: m.user.name,
      isSelf: m.userId === ctx(req).userId,
    }))
  })

  app.patch('/v1/team/members/:userId', async (req) => {
    const c = ctx(req)
    const targetUserId = (req.params as { userId: string }).userId
    const { role } = rolePatch.parse(req.body)
    const all = await teamMembersAsMembers(c.teamId)
    const target = all.find((m) => m.id === targetUserId)
    if (!target) throw notFound('member not found in this team')
    const verdict = canChangeRole(actor(req), target, role, all)
    if (!verdict.ok) throw forbidden(verdict.reason ?? 'cannot change role')
    await prisma.membership.update({ where: { userId_teamId: { userId: targetUserId, teamId: c.teamId } }, data: { role } })
    return { ok: true }
  })

  app.delete('/v1/team/members/:userId', async (req) => {
    const c = ctx(req)
    const targetUserId = (req.params as { userId: string }).userId
    const all = await teamMembersAsMembers(c.teamId)
    const target = all.find((m) => m.id === targetUserId)
    if (!target) throw notFound('member not found in this team')
    const verdict = canRemoveMember(actor(req), target, all)
    if (!verdict.ok) throw forbidden(verdict.reason ?? 'cannot remove member')
    await prisma.membership.delete({ where: { userId_teamId: { userId: targetUserId, teamId: c.teamId } } })
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
      await sendInviteEmail({ to: normalized, teamName: c.teamName, inviterName: c.name ?? c.email, role, acceptUrl })
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

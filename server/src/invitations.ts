import { randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from './db'
import { isRoleId } from './auth/db'
import type { RoleId } from '../../src/lib/authorization/roles'

/** True for a Prisma unique-constraint violation (P2002). */
function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
}

/**
 * Unified Prisma invitation lifecycle (inspect / accept / revoke). Invite CREATION
 * + resend live in routes/team.ts (they need the actor's role for anti-escalation),
 * but the redeem/inspect/revoke business rules live here as DB-injectable functions
 * so they are integration-testable and have ONE authoritative implementation. The
 * acceptance decision itself is a PURE function (classifyInviteForAccept) so every
 * branch — expiry, revoked, already-accepted, email match/verify — is unit-testable.
 *
 * Acceptance is Prisma-authoritative: membership + invite state are written here in a
 * single transaction against the SAME Prisma team the invite was created for. There is
 * no dependency on a Supabase invite-accept RPC for business state.
 */

/** The minimal invite shape the pure decision needs (DB-free, unit-tested). */
export interface InviteForDecision {
  email: string
  role: string
  status: string
  expiresAt: number
}

export type InviteAcceptDecision =
  | { status: 'accept'; role: RoleId }
  | { status: 'already_member'; role: RoleId }
  | { status: 'invalid' }
  | { status: 'revoked' }
  | { status: 'expired' }
  | { status: 'used' }
  | { status: 'email_unverified' }
  | { status: 'email_mismatch' }

/**
 * Decide what accepting `invite` means for this caller. Order is deliberate:
 *   no invite           -> invalid (unknown token)
 *   email not verified  -> email_unverified (a leaked link must not be redeemable by
 *                          someone who merely typed the victim's address at the IdP)
 *   email mismatch      -> email_mismatch (invite belongs to a different address)
 *   revoked             -> revoked
 *   accepted            -> already_member (idempotent OK) if the caller is already in
 *                          the team, else used (it was consumed for/by someone else)
 *   pending + expired   -> expired
 *   pending             -> accept
 * Pure — no I/O.
 */
export function classifyInviteForAccept(
  invite: InviteForDecision | null,
  opts: { now: number; userEmail: string; emailVerified: boolean; userIsMember: boolean },
): InviteAcceptDecision {
  if (!invite) return { status: 'invalid' }
  if (!opts.emailVerified) return { status: 'email_unverified' }
  if (invite.email.toLowerCase() !== opts.userEmail.toLowerCase()) return { status: 'email_mismatch' }
  const role: RoleId = isRoleId(invite.role) ? invite.role : 'viewer'
  if (invite.status === 'revoked') return { status: 'revoked' }
  if (invite.status === 'accepted') return opts.userIsMember ? { status: 'already_member', role } : { status: 'used' }
  if (invite.status === 'pending' && invite.expiresAt < opts.now) return { status: 'expired' }
  if (invite.status === 'pending') return { status: 'accept', role }
  return { status: 'invalid' }
}

export type AcceptInviteResult =
  | { ok: true; idempotent: boolean; teamId: string; teamName: string | null; role: RoleId }
  | { ok: false; code: Exclude<InviteAcceptDecision['status'], 'accept' | 'already_member'> }

export interface AcceptInviteArgs {
  token: string
  userId: string
  userEmail: string
  emailVerified: boolean
}

/**
 * Redeem an invite token for the authenticated user. Creates the membership and
 * marks the invite accepted in ONE transaction (so a crash can't leave a joined
 * member with a still-pending invite), creating the membership EXACTLY ONCE (a
 * pre-check + the @@unique[userId,teamId] backstop), and is idempotent: a re-accept
 * by a user who is already a member returns ok without side effects.
 */
export async function acceptInvite(args: AcceptInviteArgs, db: PrismaClient = prisma): Promise<AcceptInviteResult> {
  const invite = await db.invite.findUnique({ where: { token: args.token } })
  const userIsMember = invite
    ? Boolean(await db.membership.findUnique({ where: { userId_teamId: { userId: args.userId, teamId: invite.teamId } } }))
    : false
  const decision = classifyInviteForAccept(invite, {
    now: Date.now(),
    userEmail: args.userEmail,
    emailVerified: args.emailVerified,
    userIsMember,
  })

  if (decision.status === 'accept' || decision.status === 'already_member') {
    let created = false
    if (decision.status === 'accept') {
      try {
        await db.$transaction(async (tx) => {
          // Re-check inside the tx so a serialized double-accept skips the duplicate create.
          const exists = await tx.membership.findUnique({
            where: { userId_teamId: { userId: args.userId, teamId: invite!.teamId } },
          })
          if (!exists) {
            await tx.membership.create({
              data: {
                id: `mem_${randomUUID()}`,
                userId: args.userId,
                teamId: invite!.teamId,
                role: decision.role,
                status: 'active',
                createdAt: Date.now(),
              },
            })
            created = true
          }
          await tx.invite.update({ where: { id: invite!.id }, data: { status: 'accepted', acceptedAt: Date.now() } })
        })
      } catch (e) {
        // A GENUINELY concurrent accept committed its membership first: under Read
        // Committed both txs can pass the re-check, and the loser hits @@unique
        // [userId,teamId] (P2002). The winner already created the membership AND marked
        // the invite accepted (one tx), so converge idempotently instead of surfacing
        // the raw Prisma error. Any other error still propagates.
        if (!isUniqueViolation(e)) throw e
        created = false
      }
    }
    // Read back the (now-existing) membership for the current role + team name. created
    // is false when the membership already existed (idempotent: a re-accept, a pending
    // invite for someone already in the team, or the lost race above) — the route uses
    // this to avoid logging a spurious invite.accept for a join that did not happen.
    const membership = await db.membership.findUnique({
      where: { userId_teamId: { userId: args.userId, teamId: invite!.teamId } },
      include: { team: true },
    })
    const role: RoleId = membership && isRoleId(membership.role) ? membership.role : decision.role
    return { ok: true, idempotent: !created, teamId: invite!.teamId, teamName: membership?.team.name ?? null, role }
  }

  return { ok: false, code: decision.status }
}

export type InviteInspection =
  | { valid: true; teamName: string; role: string; expiresAt: number }
  | { valid: false }

/**
 * Read-only pre-accept preview by token (for the invite landing page). Returns a
 * minimal, non-enumerable summary — never the invitee email — and { valid: false }
 * (not an error) for an unknown / expired / revoked / already-accepted token, so the
 * page can render a friendly "this invite is no longer valid" without leaking which.
 */
export async function inspectInvite(token: string, db: PrismaClient = prisma): Promise<InviteInspection> {
  const invite = await db.invite.findUnique({ where: { token }, include: { team: true } })
  if (!invite || invite.status !== 'pending' || invite.expiresAt < Date.now()) return { valid: false }
  return { valid: true, teamName: invite.team.name, role: invite.role, expiresAt: invite.expiresAt }
}

export type RevokeInviteResult =
  | { ok: true; alreadyRevoked: boolean }
  | { ok: false; code: 'not_found' | 'already_accepted' }

/**
 * Revoke a pending invite, TEAM-SCOPED (you can only revoke your own team's invites,
 * never another tenant's by id). Idempotent on an already-revoked invite; refuses to
 * "revoke" an already-accepted one (that would silently strip the accepted state).
 */
export async function revokeInvite(
  args: { inviteId: string; teamId: string },
  db: PrismaClient = prisma,
): Promise<RevokeInviteResult> {
  const invite = await db.invite.findFirst({ where: { id: args.inviteId, teamId: args.teamId } })
  if (!invite) return { ok: false, code: 'not_found' }
  if (invite.status === 'revoked') return { ok: true, alreadyRevoked: true }
  if (invite.status === 'accepted') return { ok: false, code: 'already_accepted' }
  await db.invite.update({ where: { id: invite.id }, data: { status: 'revoked' } })
  return { ok: true, alreadyRevoked: false }
}

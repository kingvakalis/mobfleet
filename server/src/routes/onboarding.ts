import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { identityOf } from '../auth/context'
import { ensureFirstTeam, logAudit } from '../auth/db'

// Only the workspace name is accepted. `.strict()` rejects any client-supplied
// userId / role / teamId — the acting user and the owner role are derived from the
// verified JWT, never trusted from the body.
const onboardingTeamBody = z.object({ name: z.string().trim().min(1).max(120) }).strict()

/** First-team onboarding for an authenticated, team-less user. Identity-only auth
 *  (no team required); race-safe + idempotent provisioning. */
export function registerOnboardingRoutes(app: FastifyInstance) {
  app.post('/v1/onboarding/team', { config: { auth: 'identity' } }, async (req, reply) => {
    const { user } = identityOf(req)
    const { name } = onboardingTeamBody.parse(req.body)
    const result = await ensureFirstTeam(user, name, { rejectPendingInvite: true })
    if (!result.ok) {
      // A pending invitation takes precedence over creating a personal team.
      return reply.code(409).send({
        error: 'you have a pending invitation — accept it instead of creating a workspace',
        pendingInvite: result.invite,
      })
    }
    // Audit hook for Subagent 2: emit a durable workspace-created event ONLY when a
    // team was genuinely created (result.created) — an idempotent retry that adopts an
    // existing/concurrent team must NOT re-log. The new owner is both actor and target.
    // logAudit is best-effort (never blocks/throws), so it can't fail the onboarding.
    if (result.created) {
      await logAudit({
        teamId: result.team.id,
        actorId: user.id,
        action: 'workspace.create',
        target: result.team.id,
        result: 'allowed',
        detail: `name=${result.team.name}`,
      })
    }
    // 200 whether newly created or an existing/concurrent membership was adopted (idempotent).
    return { team: result.team, membership: result.membership }
  })
}

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { env } from '../env'
import { identityOf } from '../auth/context'
import { ensureFirstTeam, logAudit } from '../auth/db'
import { loadTransactionalEmailPreferences } from '../email-settings'
import { sendWelcomeEmail } from '../mailer'

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
    // Durable audit + welcome email fire ONLY when a team was genuinely created
    // (result.created) — an idempotent retry that adopts an existing/concurrent team
    // must NOT re-log or re-send. The new owner is both actor and target. Both are
    // best-effort (never block/throw), so they can't fail the onboarding.
    if (result.created) {
      await logAudit({
        teamId: result.team.id,
        actorId: user.id,
        action: 'workspace.create',
        target: result.team.id,
        result: 'allowed',
        detail: `name=${result.team.name}`,
      })
      // Welcome email, gated by the welcomeEmailEnabled preference (a brand-new team
      // has no stored prefs -> defaults all enabled). This is the one true
      // exactly-once onboarding trigger, so the previously-documented welcome gap is
      // now closed for the deliberate onboarding flow. The preference READ and the send
      // are BOTH inside the try/catch so a transient DB/delivery error can never fail
      // an onboarding whose team is already committed (it would otherwise 500, and the
      // result.created guard would skip the welcome forever on retry).
      try {
        const prefs = await loadTransactionalEmailPreferences(result.team.id)
        if (prefs.welcomeEmailEnabled) {
          await sendWelcomeEmail({
            teamId: result.team.id,
            to: user.email,
            name: user.name ?? user.email,
            dashboardUrl: env.appUrl,
          })
        }
      } catch (e) {
        console.error('[welcome email]', e instanceof Error ? e.message : e)
      }
    }
    // 200 whether newly created or an existing/concurrent membership was adopted (idempotent).
    return { team: result.team, membership: result.membership }
  })
}

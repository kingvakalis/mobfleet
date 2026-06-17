import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { identityOf } from '../auth/context'
import { resolveMeState, selectTeamStrict } from '../auth/db'
import { buildMeResponse } from '../auth/me'
import { forbidden } from '../http-error'

// The deliberate switch accepts ONLY a teamId. `.strict()` rejects any client-
// supplied role/status/permissions/membershipId — the selection is validated against
// the caller's own membership rows, and role/permissions are recomputed server-side,
// never trusted from the body.
const switchTeamBody = z.object({ teamId: z.string().trim().min(1) }).strict()

/**
 * Authoritative identity + team-selection surface (identity-only auth, so it works
 * before the user has a team).
 *
 *   GET  /v1/me        — the authoritative post-login state (onboarding/suspended/
 *                        pendingInvite + the SELECTED team's role & server-computed
 *                        permissions + the full switchable-team roster). Honours the
 *                        `x-team-id` selection header LENIENTLY (an unknown/stale id
 *                        falls back to a valid active team — never wedges the session).
 *   POST /v1/me/team   — DELIBERATELY switch the active team. Validates the requested
 *                        team is one of the caller's ACTIVE memberships and returns the
 *                        fresh /v1/me for it. Unlike the header, this REJECTS (403) an
 *                        unauthorized/suspended/foreign/removed team instead of falling
 *                        back, so the client is never silently switched elsewhere.
 *
 * SELECTION IS STATELESS by design: there is no server-persisted "selected team"
 * column (that would need a User.selectedTeamId migration — out of this scope). The
 * client persists the chosen teamId and sends it as `x-team-id`; the server RE-VALIDATES
 * it against live active memberships on EVERY request. So a selected team that is later
 * removed, suspended, or deleted can never go stale server-side — it simply fails
 * re-validation (lenient fallback on /v1/me, explicit 403 on the deliberate switch).
 */
export function registerMeRoutes(app: FastifyInstance) {
  app.get('/v1/me', { config: { auth: 'identity' } }, async (req) => {
    const { identity, user } = identityOf(req)
    const requestedTeamId = (req.headers['x-team-id'] as string | undefined)?.trim() || undefined
    const { memberships, classification, pendingInvite } = await resolveMeState(user, requestedTeamId)
    return buildMeResponse({ identity, user, memberships, classification, pendingInvite })
  })

  app.post('/v1/me/team', { config: { auth: 'identity' } }, async (req) => {
    const { identity, user } = identityOf(req)
    const { teamId } = switchTeamBody.parse(req.body)
    // Reuse the same single round-trip as /v1/me (memberships + pendingInvite), then
    // apply the STRICT selection (no fallback) for the deliberate switch.
    const { memberships, pendingInvite } = await resolveMeState(user, teamId)
    const selection = selectTeamStrict(memberships, teamId)
    if (selection.status === 'not_member') {
      // 403 (not 404) and a generic message: never reveal whether the team exists to a
      // non-member — a cross-tenant id and a deleted id are indistinguishable to them.
      throw forbidden('you are not a member of that workspace')
    }
    if (selection.status === 'suspended') {
      throw forbidden('your membership in that workspace is suspended')
    }
    // Recompute role + permissions from the chosen membership server-side (the body's
    // teamId is the ONLY thing that crossed the trust boundary).
    return buildMeResponse({
      identity,
      user,
      memberships,
      classification: { status: 'ready', chosen: selection.chosen },
      pendingInvite,
    })
  })
}

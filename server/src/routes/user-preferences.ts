import type { FastifyInstance } from 'fastify'
import { ctx } from '../auth/context'
import { HttpError } from '../http-error'
import {
  preferencesPatch,
  loadUserPreferences,
  saveUserPreferences,
  applyPreferencesPatch,
} from '../user-preferences'

/**
 * Per-(team, user) preferences API — the CALLER's own preferences within the active
 * team.
 *
 * AUTH: an authenticated team membership is sufficient; there is no extra permission,
 * because a user only ever reads/writes their OWN preferences. Both the team
 * (ctx().teamId) and the user (ctx().userId) are server-resolved — a client cannot
 * pass either, so one user can never read or mutate another's preferences and one
 * team's blob never crosses into another. The blob is never a secret. No new
 * permission keys are added.
 *
 *   GET  /v1/me/preferences -> { preferences }   (self)
 *   POST /v1/me/preferences -> { preferences }   (self, shallow-merge patch)
 */
export function registerUserPreferencesRoutes(app: FastifyInstance) {
  app.get('/v1/me/preferences', async (req) => {
    const c = ctx(req)
    let preferences
    try {
      preferences = await loadUserPreferences(c.teamId, c.userId)
    } catch {
      throw new HttpError(500, 'could not load preferences')
    }
    return { preferences }
  })

  app.post('/v1/me/preferences', async (req) => {
    const c = ctx(req)
    const patch = preferencesPatch.parse(req.body ?? {})
    let preferences
    try {
      const current = await loadUserPreferences(c.teamId, c.userId)
      preferences = await saveUserPreferences(c.teamId, c.userId, applyPreferencesPatch(current, patch), Date.now())
    } catch {
      throw new HttpError(500, 'could not save preferences')
    }
    return { preferences }
  })
}

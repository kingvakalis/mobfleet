import type { FastifyInstance } from 'fastify'
import { ctx, requirePermission } from '../auth/context'
import { logAudit } from '../auth/db'
import { HttpError, badRequest } from '../http-error'
import {
  emailSettingsBody,
  loadTeamEmailSettings,
  parseFrom,
  resolveApiKeyForUpdate,
  toSafeEmailSettings,
  upsertTeamEmailSettings,
} from '../email-settings'

// Env-derived sender defaults shown when a team has no row yet. The env Resend
// API key is intentionally NOT exposed.
const ENV_MAIL_FROM = process.env.MAIL_FROM ?? 'MobFleet <invites@mobfleet.local>'

/**
 * Per-team transactional email sender settings.
 *
 * AUTH: both routes require the `team.invite` permission (not phones.admin / no
 * new permission). The acting team is the AUTHENTICATED team (ctx().teamId) —
 * a client-supplied teamId is never trusted, so cross-team read/write is
 * impossible. A suspended member never reaches here (resolveAuthContext 403s in
 * the auth preHandler). The full Resend API key is never returned, logged, or
 * put in an error.
 */
export function registerEmailSettingsRoutes(app: FastifyInstance) {
  app.get('/v1/settings/email', async (req) => {
    requirePermission(req, 'team.invite')
    const teamId = ctx(req).teamId
    let row
    try {
      row = await loadTeamEmailSettings(teamId)
    } catch {
      throw new HttpError(500, 'could not load email settings')
    }
    if (!row) {
      console.log(JSON.stringify({ event: 'email.settings.loaded', teamId, configured: false }))
      // No row yet — return safe env-derived sender defaults (never the env key).
      return { settings: null, defaults: parseFrom(ENV_MAIL_FROM) }
    }
    console.log(JSON.stringify({ event: 'email.settings.loaded', teamId, configured: true }))
    return { settings: toSafeEmailSettings(row) }
  })

  app.post('/v1/settings/email', async (req) => {
    requirePermission(req, 'team.invite')
    const c = ctx(req)
    const body = emailSettingsBody.parse(req.body) // ZodError → 400 via the global handler
    let existing
    try {
      existing = await loadTeamEmailSettings(c.teamId)
    } catch {
      throw new HttpError(500, 'could not load email settings')
    }
    // Preserve the stored key when the client sends no (or a blank) replacement;
    // a real key replaces it. A masked value can't reach here (Zod rejects '•').
    const resendApiKey = resolveApiKeyForUpdate(existing?.resendApiKey ?? null, body.resendApiKey)
    if (!resendApiKey) throw badRequest('a Resend API key is required to configure email settings')

    let row
    try {
      row = await upsertTeamEmailSettings(c.teamId, {
        senderEmail: body.senderEmail,
        senderName: body.senderName,
        resendApiKey,
      })
    } catch {
      throw new HttpError(500, 'could not save email settings')
    }

    // Audit + structured log — NEVER the key or its last 4 chars.
    await logAudit({
      teamId: c.teamId,
      actorId: c.userId,
      action: existing ? 'email.settings.update' : 'email.settings.create',
      result: 'allowed',
      detail: `sender=${body.senderEmail}`,
    })
    console.log(JSON.stringify({
      event: existing ? 'email.settings.updated' : 'email.settings.created',
      teamId: c.teamId,
      userId: c.userId,
    }))
    return { settings: toSafeEmailSettings(row) }
  })
}

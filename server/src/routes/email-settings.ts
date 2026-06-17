import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { ctx, requirePermission } from '../auth/context'
import { logAudit } from '../auth/db'
import { rateLimit } from '../rate-limit'
import { HttpError, badRequest } from '../http-error'
import {
  emailSettingsBody,
  toSafeEmailSettings,
  parseFrom,
  loadTeamEmailSettings,
  resolveApiKeyForUpdate,
  upsertTeamEmailSettings,
  loadTransactionalEmailPreferences,
  saveTransactionalEmailPreferences,
  normalizeTransactionalPreferences,
  type TransactionalEmailPreferences,
} from '../email-settings'
import { sendTestEmail } from '../mailer'

/**
 * Per-team transactional email: sender settings, notification preferences, and a
 * delivery test.
 *
 * AUTH: every route requires the `team.invite` permission. The acting team is the
 * AUTHENTICATED team (ctx().teamId) — a client-supplied teamId is never trusted, so
 * cross-team read/write is impossible. A suspended member never reaches here
 * (resolveAuthContext 403s in the auth preHandler). The full Resend API key is never
 * returned, logged, or put in an error — only the last 4 chars, via toSafeEmailSettings.
 */

// Env-derived sender defaults shown when a team has no settings row yet. The env
// Resend API key is intentionally NOT exposed.
const ENV_MAIL_FROM = process.env.MAIL_FROM ?? 'MobFleet <invites@mobfleet.local>'

// Partial preference patch — every key optional so a caller can toggle a single
// switch. Keys mirror the shared EmailPreferences contract (src/lib/email/preferences.ts).
const preferencesBody = z.object({
  teamInvitesEnabled: z.boolean().optional(),
  passwordResetEnabled: z.boolean().optional(),
  welcomeEmailEnabled: z.boolean().optional(),
})

// POST /v1/settings/email may carry an optional preference patch alongside the sender config.
const settingsPostBody = emailSettingsBody.extend({ preferences: preferencesBody.optional() })

const testEmailBody = z.object({ to: z.string().email().optional() })

export function registerEmailSettingsRoutes(app: FastifyInstance) {
  // Read the team's sender settings (safe shape, never the key) + notification preferences.
  app.get('/v1/settings/email', async (req) => {
    requirePermission(req, 'team.invite')
    const teamId = ctx(req).teamId
    let row
    try {
      row = await loadTeamEmailSettings(teamId)
    } catch {
      throw new HttpError(500, 'could not load email settings')
    }
    const preferences = await loadTransactionalEmailPreferences(teamId)
    if (!row) {
      console.log(JSON.stringify({ event: 'email.settings.loaded', teamId, configured: false }))
      // No row yet — return safe env-derived sender defaults (never the env key).
      return { settings: null, defaults: parseFrom(ENV_MAIL_FROM), preferences }
    }
    console.log(JSON.stringify({ event: 'email.settings.loaded', teamId, configured: true }))
    return { settings: toSafeEmailSettings(row), preferences }
  })

  // Create/update the team's sender settings; optionally patch preferences in the same call.
  app.post('/v1/settings/email', async (req) => {
    requirePermission(req, 'team.invite')
    const c = ctx(req)
    const body = settingsPostBody.parse(req.body) // ZodError -> 400 via the global handler

    let existing
    try {
      existing = await loadTeamEmailSettings(c.teamId)
    } catch {
      throw new HttpError(500, 'could not load email settings')
    }
    // Preserve the stored key when the client sends no (or a blank) replacement; a
    // real key replaces it. A masked value can't reach here (Zod rejects '•').
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

    let preferences: TransactionalEmailPreferences = await loadTransactionalEmailPreferences(c.teamId)
    if (body.preferences) {
      preferences = await saveTransactionalEmailPreferences(
        c.teamId,
        normalizeTransactionalPreferences({ ...preferences, ...body.preferences }),
      )
    }

    // Audit + structured log — NEVER the key or its last 4 chars.
    console.log(JSON.stringify({
      event: existing ? 'email.settings.updated' : 'email.settings.created',
      teamId: c.teamId,
      userId: c.userId,
    }))
    await logAudit({
      teamId: c.teamId,
      actorId: c.userId,
      action: existing ? 'email.settings.update' : 'email.settings.create',
      result: 'allowed',
      detail: `sender=${body.senderEmail}`,
    })
    return { settings: toSafeEmailSettings(row), preferences }
  })

  // Toggle notification preferences without touching the sender config. Works even
  // when no settings row exists (preferences live on Team, not TeamEmailSettings).
  app.post('/v1/settings/email/preferences', async (req) => {
    requirePermission(req, 'team.invite')
    const c = ctx(req)
    const body = preferencesBody.parse(req.body)
    const current = await loadTransactionalEmailPreferences(c.teamId)
    const preferences = await saveTransactionalEmailPreferences(
      c.teamId,
      normalizeTransactionalPreferences({ ...current, ...body }),
    )
    await logAudit({
      teamId: c.teamId,
      actorId: c.userId,
      action: 'email.preferences.update',
      result: 'allowed',
      detail: Object.keys(body).join(','),
    })
    return { preferences }
  })

  // Send a test email to verify delivery. Always sends (an explicit operator action,
  // not gated by preferences). A delivery failure maps to a clear 502 without leaking
  // the provider's response body to the client.
  app.post('/v1/settings/email/test', async (req) => {
    requirePermission(req, 'team.invite')
    const c = ctx(req)
    // Throttle per (team, actor): the test sender accepts an arbitrary recipient and
    // can fall back to the platform's shared Resend key, so cap it to prevent using
    // the endpoint as an authenticated email relay / quota-burner.
    if (!rateLimit(`email-test:${c.teamId}:${c.userId}`, 5, 60_000)) {
      throw new HttpError(429, 'too many test emails, slow down')
    }
    const body = testEmailBody.parse(req.body ?? {})
    const to = body.to ?? c.email
    try {
      await sendTestEmail({ teamId: c.teamId, to, teamName: c.teamName })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'email delivery failed'
      console.error(JSON.stringify({ event: 'email.test.failed', teamId: c.teamId, error: msg }))
      throw new HttpError(502, 'test email delivery failed')
    }
    console.log(JSON.stringify({ event: 'email.test.sent', teamId: c.teamId }))
    return { ok: true, to }
  })
}

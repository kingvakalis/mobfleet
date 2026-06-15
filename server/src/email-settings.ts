import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { prisma } from './db'

/**
 * Per-team transactional email sender configuration (Resend).
 *
 * SECURITY: `resendApiKey` is stored as a PLAIN string — this codebase has no
 * reversible-encryption helper (only one-way SHA-256 hashing for device keys),
 * so per the task we store plaintext and DOCUMENT the limitation. The full key
 * is NEVER returned to the client (only the last 4 chars), never logged, and
 * never included in errors. Pure helpers below are unit-tested in email-settings.test.ts.
 */

/** Row shape (mirrors the TeamEmailSettings Prisma model; updatedAt = epoch ms). */
export interface TeamEmailSettingsRow {
  id: string
  teamId: string
  senderEmail: string
  senderName: string
  resendApiKey: string
  updatedAt: number
}

// ── Validation ────────────────────────────────────────────────────────────────
// senderName rejects CR/LF (email-header injection). resendApiKey is OPTIONAL on
// update — a blank/omitted key preserves the stored one; when present it must be
// real (bounded, non-empty) and never the masked display value (contains '•').
export const emailSettingsBody = z.object({
  senderEmail: z.string().trim().email().max(254),
  senderName: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((v) => !/[\r\n]/.test(v), 'sender name cannot contain line breaks'),
  resendApiKey: z
    .string()
    .trim()
    .min(8, 'API key looks too short')
    .max(512)
    .refine((v) => !v.includes('•'), 'a masked value is not a valid API key')
    .optional(),
})
export type EmailSettingsBody = z.infer<typeof emailSettingsBody>

// ── Pure helpers (no I/O — unit-tested) ─────────────────────────────────────────

/** Last 4 chars of a secret, for safe display. Never the full value. */
export function getSecretLast4(secret: string | null | undefined): string | null {
  if (!secret) return null
  return secret.slice(-4)
}

/** Build a header-injection-safe "Name <email>" From identity (CR/LF stripped). */
export function formatFrom(senderName: string, senderEmail: string): string {
  const name = senderName.replace(/[\r\n]+/g, ' ').trim()
  const email = senderEmail.replace(/[\r\n]+/g, '').trim()
  return `${name} <${email}>`
}

/**
 * Decide the API key to persist on update: a new, real key replaces the stored
 * one; a blank/omitted key PRESERVES the existing key. Returns null when neither
 * exists (the caller treats that as "a key is required on first creation").
 */
export function resolveApiKeyForUpdate(existingKey: string | null, incoming: string | null | undefined): string | null {
  const trimmed = typeof incoming === 'string' ? incoming.trim() : ''
  if (trimmed.length > 0) return trimmed
  return existingKey
}

/** Parse a "Name <email>" (or bare "email") string into parts — used to derive
 *  GET defaults from MAIL_FROM. Never exposes the env API key. */
export function parseFrom(from: string): { senderName: string; senderEmail: string } {
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/)
  if (m) return { senderName: (m[1] || 'MobFleet').trim(), senderEmail: m[2].trim() }
  return { senderName: 'MobFleet', senderEmail: from.trim() }
}

export interface MailSenderEnvConfig { transport: string; from: string; apiKey?: string }
export interface ResolvedMailSender { transport: 'resend' | 'console'; from: string; apiKey?: string; source: 'team' | 'env' }

/**
 * Choose the transport + From identity + API key for a send. A team row with a
 * usable key AND sender identity wins (team-specific Resend); otherwise the
 * environment configuration (existing behavior). Pure — no I/O, never logs.
 */
export function chooseMailSender(
  teamRow: Pick<TeamEmailSettingsRow, 'senderName' | 'senderEmail' | 'resendApiKey'> | null,
  envCfg: MailSenderEnvConfig,
): ResolvedMailSender {
  if (teamRow && teamRow.resendApiKey && teamRow.senderEmail && teamRow.senderName) {
    return {
      transport: 'resend',
      from: formatFrom(teamRow.senderName, teamRow.senderEmail),
      apiKey: teamRow.resendApiKey,
      source: 'team',
    }
  }
  const transport: 'resend' | 'console' =
    envCfg.transport.toLowerCase() === 'resend' && Boolean(envCfg.apiKey) ? 'resend' : 'console'
  return { transport, from: envCfg.from, apiKey: envCfg.apiKey, source: 'env' }
}

/** Safe (no-secret) response shape returned by the email-settings routes. */
export interface SafeEmailSettings {
  senderEmail: string
  senderName: string
  hasResendApiKey: boolean
  resendApiKeyLast4: string | null
  resendApiKeyMasked: string | null
  updatedAt: string
}

/** Map a row to the safe response — NEVER includes the full key. */
export function toSafeEmailSettings(row: TeamEmailSettingsRow): SafeEmailSettings {
  const last4 = getSecretLast4(row.resendApiKey)
  return {
    senderEmail: row.senderEmail,
    senderName: row.senderName,
    hasResendApiKey: Boolean(row.resendApiKey),
    resendApiKeyLast4: last4,
    resendApiKeyMasked: last4 ? `••••${last4}` : null,
    updatedAt: new Date(row.updatedAt).toISOString(),
  }
}

// ── Data access (team-scoped) ───────────────────────────────────────────────────

/** Load a team's email settings (or null). Used by the routes + the mailer. */
export function loadTeamEmailSettings(teamId: string): Promise<TeamEmailSettingsRow | null> {
  return prisma.teamEmailSettings.findUnique({ where: { teamId } })
}

/** Create or update the single settings row for a team (one row per team — teamId
 *  is unique, so this is a true upsert that never produces a second row). */
export function upsertTeamEmailSettings(
  teamId: string,
  data: { senderEmail: string; senderName: string; resendApiKey: string },
): Promise<TeamEmailSettingsRow> {
  const now = Date.now()
  return prisma.teamEmailSettings.upsert({
    where: { teamId },
    create: { id: `emailcfg_${randomUUID()}`, teamId, ...data, updatedAt: now },
    update: { senderEmail: data.senderEmail, senderName: data.senderName, resendApiKey: data.resendApiKey, updatedAt: now },
  })
}

import { chooseMailSender, loadTeamEmailSettings, type TeamEmailSettingsRow } from './email-settings'
import {
  buildInviteEmail,
  buildResetEmail,
  buildTestEmail,
  buildWelcomeEmail,
  type ResetEmailData,
  type WelcomeEmailData,
} from '../../src/shared/email-templates'

/**
 * Transactional email sender. A team's own sender configuration
 * (TeamEmailSettings: Resend API key + From identity) is loaded at SEND TIME and
 * wins when present; otherwise the environment configuration is used
 * (MAIL_TRANSPORT / RESEND_API_KEY / MAIL_FROM) — preserving the existing
 * behavior for flows with no team or no team-specific config. The default
 * 'console' transport just logs the link (dev-usable without a provider). No
 * SDK — Resend is called over its HTTP API with plain fetch.
 *
 * SECURITY: the Resend API key is NEVER logged. Logs carry teamId, transport,
 * source (team|env), mail type, result, and duration — never the key or the
 * email HTML.
 */
const ENV_FROM = process.env.MAIL_FROM ?? 'MobFleet <invites@mobfleet.local>'

/**
 * MAIL SAFETY (fail-closed). Test / CI / smoke / disposable environments must
 * NEVER be able to reach the real Resend provider — not even when a Resend API
 * key and MAIL_TRANSPORT=resend are configured (a stray key in a CI secret, a
 * copy-pasted .env, etc. must not cause real email to be sent during a test).
 *
 * The condition is decided purely from the environment so it is unit-testable
 * and free of I/O. When it holds, every send is FORCED onto the console/capture
 * transport and the Resend HTTP call is never made.
 *
 * Production behavior is UNCHANGED when none of these are set.
 */
export interface MailSafetyEnv {
  NODE_ENV?: string
  MAIL_SAFE_MODE?: string
  CI?: string
}

/**
 * True when external mail MUST be refused. Pure — reads the passed snapshot only.
 *   - NODE_ENV === 'test'   (set by `npm test` / `npm run test:it`)
 *   - MAIL_SAFE_MODE === '1'
 *   - CI is set to any non-empty value (GitHub Actions etc. set CI=true)
 */
export function isExternalMailBlocked(env: MailSafetyEnv = process.env): boolean {
  if (env.NODE_ENV === 'test') return true
  if (env.MAIL_SAFE_MODE === '1') return true
  if (typeof env.CI === 'string' && env.CI.trim() !== '') return true
  return false
}

/**
 * Apply the fail-closed safety override to a resolved sender. If external mail is
 * blocked, the transport is forced to 'console' and the API key is DROPPED, so no
 * code path downstream can ever issue a Resend request — regardless of what the
 * team row or env configuration resolved to. Pure — no I/O, never logs.
 */
export function applyMailSafety<T extends { transport: 'resend' | 'console'; apiKey?: string }>(
  sender: T,
  env: MailSafetyEnv = process.env,
): T {
  if (!isExternalMailBlocked(env)) return sender
  return { ...sender, transport: 'console', apiKey: undefined }
}

export interface InviteEmail {
  to: string
  /** Maps to the template's workspaceName. */
  teamName: string
  inviterName: string
  role: string
  /** Maps to the template's inviteUrl (the secure, backend-supplied accept link). */
  acceptUrl: string
  /** The inviting user's AUTHENTICATED team — selects that team's Resend config
   *  when present. Omit to use the environment configuration. */
  teamId?: string
}

export interface ResetEmail extends ResetEmailData {
  to: string
  teamId?: string
}

export interface WelcomeEmail extends WelcomeEmailData {
  to: string
  teamId?: string
}

export interface TestEmail {
  to: string
  /** Names the workspace in the body; selects that team's Resend config when set. */
  teamName?: string
  teamId?: string
}

interface Outbound {
  teamId?: string
  mailType: string
  to: string
  subject: string
  text: string
  html: string
  /** A NON-secret link surfaced only by the dev console transport. */
  consoleHint?: string
}

/**
 * Resolve the sender (team config wins, else env) and deliver. Team config is
 * loaded fresh at send time, so a newly-saved key takes effect immediately.
 * Throws on provider rejection (the caller decides whether that's fatal) — never
 * reports success when Resend rejected the send.
 */
async function sendEmail(msg: Outbound): Promise<void> {
  let teamRow: TeamEmailSettingsRow | null = null
  if (msg.teamId) {
    try {
      teamRow = await loadTeamEmailSettings(msg.teamId)
    } catch (err) {
      // A config-load failure must not leak the key and must not silently look
      // "sent" — log a safe error and fall back to the environment config.
      console.error(JSON.stringify({ event: 'mail.config.error', mailType: msg.mailType, teamId: msg.teamId, error: err instanceof Error ? err.message : 'error' }))
    }
  }

  const resolved = chooseMailSender(teamRow, {
    transport: process.env.MAIL_TRANSPORT ?? 'console',
    from: ENV_FROM,
    apiKey: process.env.RESEND_API_KEY,
  })
  // FAIL CLOSED: in test/CI/safe-mode, force console + drop the key so the Resend
  // branch below is unreachable even if a key + MAIL_TRANSPORT=resend are present.
  const sender = applyMailSafety(resolved)
  const safetyForced = sender.transport !== resolved.transport
  console.log(JSON.stringify({ event: 'mail.config.selected', mailType: msg.mailType, teamId: msg.teamId ?? null, transport: sender.transport, source: sender.source, safeMode: safetyForced }))

  const started = Date.now()
  try {
    if (sender.transport === 'resend' && sender.apiKey) {
      // Defense in depth: applyMailSafety already forced console + dropped the key
      // in blocked environments, so this branch is unreachable there. Re-assert
      // anyway so any future refactor that bypasses applyMailSafety still fails
      // closed rather than silently sending real email from a test/CI run.
      if (isExternalMailBlocked()) {
        throw new Error('mail safety: external send refused (NODE_ENV=test / CI / MAIL_SAFE_MODE)')
      }
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${sender.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: sender.from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html }),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status} ${body}`)
      }
    } else {
      // console transport (dev default) — log the link, never the body or key.
      console.log(`\n[mail:${sender.source}] → ${msg.to}\n  ${msg.subject}${msg.consoleHint ? `\n  LINK: ${msg.consoleHint}` : ''}\n  (transport=console; set MAIL_TRANSPORT=resend + RESEND_API_KEY, or configure team email settings, to send real email)\n`)
    }
    console.log(JSON.stringify({ event: 'mail.sent', mailType: msg.mailType, teamId: msg.teamId ?? null, transport: sender.transport, source: sender.source, ms: Date.now() - started }))
  } catch (err) {
    console.error(JSON.stringify({ event: 'mail.failed', mailType: msg.mailType, teamId: msg.teamId ?? null, transport: sender.transport, source: sender.source, ms: Date.now() - started, error: err instanceof Error ? err.message : 'error' }))
    throw err
  }
}

/** Send a team invitation. Uses the inviting user's team-specific sender config
 *  when present (e.teamId), else the environment configuration. */
export async function sendInviteEmail(e: InviteEmail): Promise<void> {
  const { subject, text, html } = buildInviteEmail({
    inviterName: e.inviterName,
    workspaceName: e.teamName,
    inviteUrl: e.acceptUrl,
    role: e.role,
  })
  await sendEmail({ teamId: e.teamId, mailType: 'invite', to: e.to, subject, text, html, consoleHint: e.acceptUrl })
}

/**
 * Optional custom password-reset send via Resend. NOT CURRENTLY WIRED to any
 * trigger: the ACTIVE password-reset email is sent by Supabase Auth
 * (AuthContext.forgotPassword → supabase.auth.resetPasswordForEmail), whose branded
 * template lives at supabase/templates/reset-password.html. This function exists as
 * a ready integration point if reset delivery is ever moved to the server mailer.
 */
export async function sendResetEmail(e: ResetEmail): Promise<void> {
  const { subject, text, html } = buildResetEmail({ resetUrl: e.resetUrl, expiresIn: e.expiresIn })
  await sendEmail({ teamId: e.teamId, mailType: 'reset', to: e.to, subject, text, html, consoleHint: e.resetUrl })
}

/**
 * Post-signup welcome email. Branded template + sender are ready, but NO automatic
 * trigger is currently wired — signup, team creation, and invite-accept are all
 * Supabase-direct flows with no server hook to fire this safely + exactly once.
 * Call this from a real one-time trigger (e.g. first-team provisioning) with
 * duplicate-send protection before treating welcome delivery as active. Never call
 * it on every login. See README / delivery report for the documented gap.
 */
export async function sendWelcomeEmail(e: WelcomeEmail): Promise<void> {
  const { subject, text, html } = buildWelcomeEmail({ name: e.name, dashboardUrl: e.dashboardUrl })
  await sendEmail({ teamId: e.teamId, mailType: 'welcome', to: e.to, subject, text, html, consoleHint: e.dashboardUrl })
}

/**
 * Deliver a "send test email" verification from Email Settings. Uses the team's
 * own Resend sender config when present (e.teamId), else the environment config —
 * so an operator can prove their configuration actually delivers. Throws on
 * provider rejection (the route maps that to a 502), and inherits the no-secret
 * logging + sender resolution of the shared sendEmail.
 */
export async function sendTestEmail(e: TestEmail): Promise<void> {
  const { subject, text, html } = buildTestEmail({ workspaceName: e.teamName ?? 'your workspace', recipientEmail: e.to })
  await sendEmail({ teamId: e.teamId, mailType: 'test', to: e.to, subject, text, html })
}

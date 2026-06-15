import { chooseMailSender, loadTeamEmailSettings, type TeamEmailSettingsRow } from './email-settings'

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

export interface InviteEmail {
  to: string
  teamName: string
  inviterName: string
  role: string
  acceptUrl: string
  /** The inviting user's AUTHENTICATED team — selects that team's Resend config
   *  when present. Omit to use the environment configuration. */
  teamId?: string
}

function renderInvite(e: InviteEmail): { subject: string; text: string; html: string } {
  const subject = `${e.inviterName} invited you to ${e.teamName} on MobFleet`
  const text =
    `${e.inviterName} invited you to join "${e.teamName}" as ${e.role}.\n\n` +
    `Accept your invitation:\n${e.acceptUrl}\n\n` +
    `This link expires soon. If you weren't expecting this, you can ignore it.`
  const html =
    `<p><strong>${e.inviterName}</strong> invited you to join <strong>${e.teamName}</strong> as <strong>${e.role}</strong>.</p>` +
    `<p><a href="${e.acceptUrl}">Accept your invitation</a></p>` +
    `<p style="color:#888;font-size:12px">This link expires soon. If you weren't expecting this, ignore this email.</p>`
  return { subject, text, html }
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

  const sender = chooseMailSender(teamRow, {
    transport: process.env.MAIL_TRANSPORT ?? 'console',
    from: ENV_FROM,
    apiKey: process.env.RESEND_API_KEY,
  })
  console.log(JSON.stringify({ event: 'mail.config.selected', mailType: msg.mailType, teamId: msg.teamId ?? null, transport: sender.transport, source: sender.source }))

  const started = Date.now()
  try {
    if (sender.transport === 'resend' && sender.apiKey) {
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

/**
 * Send a team invitation. Uses the inviting user's team-specific sender config
 * when present (e.teamId), else the environment configuration.
 */
export async function sendInviteEmail(e: InviteEmail): Promise<void> {
  const { subject, text, html } = renderInvite(e)
  await sendEmail({ teamId: e.teamId, mailType: 'invite', to: e.to, subject, text, html, consoleHint: e.acceptUrl })
}

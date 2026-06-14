import { env } from './env'

/**
 * Pluggable invite email. Default transport just logs the accept link (so the
 * flow is fully usable in dev without an email provider). Set MAIL_TRANSPORT=
 * resend + RESEND_API_KEY to send real email via the Resend HTTP API (no SDK
 * dependency — plain fetch). Swap in SES/Postmark/SMTP the same way.
 */
const transport = (process.env.MAIL_TRANSPORT ?? 'console').toLowerCase()
const from = process.env.MAIL_FROM ?? 'MobFleet <invites@mobfleet.local>'

export interface InviteEmail {
  to: string
  teamName: string
  inviterName: string
  role: string
  acceptUrl: string
}

function render(e: InviteEmail): { subject: string; text: string; html: string } {
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

export async function sendInviteEmail(e: InviteEmail): Promise<void> {
  const { subject, text, html } = render(e)
  if (transport === 'resend' && process.env.RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: e.to, subject, text, html }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`invite email send failed: HTTP ${res.status} ${body}`)
    }
    return
  }
  // console transport (dev default)
  console.log(`\n[invite] → ${e.to}\n  ${subject}\n  ACCEPT: ${e.acceptUrl}\n  (set MAIL_TRANSPORT=resend + RESEND_API_KEY to send real email; APP_URL=${env.appUrl})\n`)
}

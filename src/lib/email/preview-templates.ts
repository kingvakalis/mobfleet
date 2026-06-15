/**
 * Frontend, preview-only renderings of MOBFLEET's transactional emails.
 *
 * BACKEND TEMPLATE PARITY:
 * Keep this preview markup synchronized with the live sender in
 * server/src/mailer.ts.
 *
 * (The live sender currently lives in server/src/mailer.ts and only implements
 * the INVITE email. Its copy is mirrored below, with two deliberate
 * preview-side choices: the brand is rendered as the app wordmark "MOBFLEET"
 * (the backend's subject uses the informal "MobFleet", and that subject is only
 * the non-visible <title> here), and the preview data fields workspaceName /
 * inviteUrl map to the backend's teamName / acceptUrl. RESET and WELCOME have no
 * backend template yet — they are preview-only placeholders; when the backend
 * adds them, mirror their real markup/variables here.)
 *
 * These builders are pure and dependency-free: no secrets, no Resend client, no
 * env access, no Node-only imports. They never run in the email-sending path.
 */

export type EmailPreviewType = 'invite' | 'reset' | 'welcome'

export interface InvitePreviewData { inviterName: string; workspaceName: string; inviteUrl: string; role: string }
export interface ResetPreviewData { resetUrl: string; expiresIn: string }
export interface WelcomePreviewData { name: string; dashboardUrl: string }

export interface RenderedEmail { subject: string; html: string }

/** Escape values before interpolating them into the email HTML. */
function esc(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Full, self-contained email document. CSS vars are unavailable inside the
 *  sandboxed iframe, so colors are inlined hex values matching the design
 *  tokens; the surrounding canvas uses #1a1f2e per the design spec. */
function wrapDocument(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:24px;background:#1a1f2e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;border-collapse:collapse;background:#0E131B;border:1px solid rgba(148,163,184,0.16);border-radius:12px;overflow:hidden;">
<tr><td style="padding:24px 32px;border-bottom:1px solid rgba(148,163,184,0.12);">
<span style="font-family:'Geist Mono',ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;letter-spacing:0.18em;text-transform:uppercase;color:#7ce8da;font-weight:700;">MOBFLEET</span>
</td></tr>
<tr><td style="padding:32px;color:#e2e8f0;font-size:15px;line-height:1.6;">
${body}
</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid rgba(148,163,184,0.12);color:rgba(148,163,184,0.7);font-size:12px;line-height:1.5;">
You're receiving this email because you have a MOBFLEET account.<br>&copy; MOBFLEET
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

function heading(text: string): string {
  return `<h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#f3f5f8;line-height:1.3;">${esc(text)}</h1>`
}

/** A call-to-action button. The href is preserved but the preview iframe is
 *  fully sandboxed, so the link can never navigate the host app. */
function cta(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;border-collapse:collapse;">
<tr><td style="border-radius:8px;background:#2dd4bf;">
<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#07090D;text-decoration:none;border-radius:8px;">${esc(label)}</a>
</td></tr>
</table>`
}

/** A muted footnote line. Escapes its text like heading()/cta() so callers can
 *  pass raw values without a per-call esc() (no injection footgun). */
function note(text: string): string {
  return `<p style="margin:16px 0 0;font-size:13px;color:rgba(148,163,184,0.78);">${esc(text)}</p>`
}

export function buildInviteEmail(d: InvitePreviewData): RenderedEmail {
  const subject = `${d.inviterName} invited you to ${d.workspaceName} on MOBFLEET`
  const body =
    heading("You're invited") +
    `<p style="margin:0;">` +
    `<strong style="color:#f3f5f8;">${esc(d.inviterName)}</strong> invited you to join ` +
    `<strong style="color:#f3f5f8;">${esc(d.workspaceName)}</strong> as ` +
    `<strong style="color:#7ce8da;">${esc(d.role)}</strong>.` +
    `</p>` +
    cta('Accept your invitation', d.inviteUrl) +
    note(`This link expires soon. If you weren't expecting this, you can safely ignore this email.`)
  return { subject, html: wrapDocument(subject, body) }
}

export function buildResetEmail(d: ResetPreviewData): RenderedEmail {
  const subject = 'Reset your MOBFLEET password'
  const body =
    heading('Reset your password') +
    `<p style="margin:0;">We received a request to reset the password for your MOBFLEET account. Choose a new password using the button below.</p>` +
    cta('Reset password', d.resetUrl) +
    note(`This link expires in ${d.expiresIn}. If you didn't request a password reset, you can safely ignore this email.`)
  return { subject, html: wrapDocument(subject, body) }
}

export function buildWelcomeEmail(d: WelcomePreviewData): RenderedEmail {
  const subject = 'Welcome to MOBFLEET'
  const body =
    heading(`Welcome, ${d.name}`) +
    `<p style="margin:0;">Your MOBFLEET account is ready. Jump into your dashboard to start managing your fleet, team, and automations.</p>` +
    cta('Open dashboard', d.dashboardUrl) +
    note(`Need a hand getting started? Just reply to this email and our team will help.`)
  return { subject, html: wrapDocument(subject, body) }
}

/** Safe sample data used for the in-product previews (adapted to each real
 *  template signature). */
export const SAMPLE_INVITE: InvitePreviewData = {
  inviterName: 'Alex Morgan',
  workspaceName: 'MOBFLEET Operations',
  inviteUrl: '#',
  role: 'Operator',
}
export const SAMPLE_RESET: ResetPreviewData = { resetUrl: '#', expiresIn: '30 minutes' }
export const SAMPLE_WELCOME: WelcomePreviewData = { name: 'Alex', dashboardUrl: '#' }

/** Render a preview email document for the given tab using the sample data. */
export function renderPreview(type: EmailPreviewType): RenderedEmail {
  switch (type) {
    case 'invite':
      return buildInviteEmail(SAMPLE_INVITE)
    case 'reset':
      return buildResetEmail(SAMPLE_RESET)
    case 'welcome':
      return buildWelcomeEmail(SAMPLE_WELCOME)
  }
}

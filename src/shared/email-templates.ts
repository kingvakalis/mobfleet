/**
 * MOBFLEET transactional email templates — single source of truth.
 *
 * Used by the in-product previews (src/lib/email/preview-templates.ts),
 * the Fastify mailer (server/src/mailer.ts), and Supabase Edge Functions
 * (supabase/functions/_shared/email-templates.ts — keep in sync).
 *
 * Design matches the premium auth shell + dashboard: obsidian canvas, teal
 * accent, monospace wordmark, HUD framing. All values are HTML-escaped;
 * links in href attributes are escaped too.
 */

export type EmailTemplateType = 'invite' | 'reset' | 'welcome'

export interface InviteEmailData {
  inviterName: string
  workspaceName: string
  inviteUrl: string
  role: string
}

export interface ResetEmailData {
  resetUrl: string
  expiresIn: string
}

export interface WelcomeEmailData {
  name: string
  dashboardUrl: string
}

export interface TestEmailData {
  /** The workspace whose sender configuration is being verified. */
  workspaceName: string
  /** The address this test was sent to (echoed back so the operator can confirm). */
  recipientEmail: string
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

// ─── Design tokens (inlined — CSS vars don't work in email clients) ───────────

const C = {
  canvas: '#0a0a0a', // body background (approved palette)
  outer: '#0B0F15',
  card: '#0E131B', // dark elevated surface
  cardBorder: 'rgba(148,163,184,0.18)',
  line: 'rgba(148,163,184,0.12)',
  fg: '#ffffff', // primary text
  fgMuted: '#94A3B8', // secondary / muted gray
  fgDim: 'rgba(148,163,184,0.72)',
  accent: '#2dd4bf', // teal accent + CTA
  accentText: '#7ce8da',
  accentSoft: 'rgba(45,212,191,0.12)',
  accentBorder: 'rgba(45,212,191,0.35)',
  ctaText: '#06110f', // near-black text on the teal CTA
  calloutBg: 'rgba(45,212,191,0.06)',
} as const

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function esc(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Validate a CTA / link URL before it is embedded in email HTML. Only absolute
 * http(s) URLs are allowed; javascript:/data:/file: and malformed/empty values
 * THROW so a broken or unsafe email is never sent (fail safe — see §13/§21). Two
 * sentinels pass through unchanged: '#' (the in-product preview placeholder) and
 * Supabase template variables ('{{ .ConfirmationURL }}' etc., substituted server
 * side by Supabase Auth). The returned value is still HTML-escaped by the caller.
 */
export function assertSafeUrl(url: string): string {
  const trimmed = String(url ?? '').trim()
  if (trimmed === '#' || trimmed.startsWith('{{')) return trimmed
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('email template: CTA URL must be an absolute http(s) URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`email template: unsafe CTA URL scheme "${parsed.protocol}"`)
  }
  return trimmed
}

function wrapDocument(title: string, preheader: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${esc(title)}</title>
<!--[if mso]><style>table,td{font-family:Arial,Helvetica,sans-serif!important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:${C.canvas};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:${C.canvas};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;border-collapse:collapse;">
<tr><td style="height:3px;background:linear-gradient(90deg,${C.accent} 0%,rgba(45,212,191,0.25) 100%);border-radius:12px 12px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="background:${C.card};border:1px solid ${C.cardBorder};border-top:none;border-radius:0 0 12px 12px;overflow:hidden;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
${emailHeader()}
<tr><td style="padding:36px 32px 8px;color:${C.fg};font-size:15px;line-height:1.65;">
${body}
</td></tr>
${emailFooter()}
</table>
</td></tr>
<tr><td style="padding:20px 8px 0;text-align:center;color:${C.fgDim};font-size:11px;line-height:1.6;">
You're receiving this because you have a MOBFLEET account.<br>
&copy; ${new Date().getFullYear()} MOBFLEET &middot; Fleet Control Plane
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

function emailHeader(): string {
  return `<tr><td style="padding:28px 32px 24px;border-bottom:1px solid ${C.line};background:${C.outer};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
<tr>
<td style="width:36px;vertical-align:middle;">
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
<tr><td style="width:36px;height:36px;border:1px solid ${C.cardBorder};background:${C.card};text-align:center;vertical-align:middle;">
<span style="display:inline-block;width:14px;height:14px;border:1px solid rgba(255,255,255,0.25);font-size:0;line-height:0;">&nbsp;</span>
</td></tr>
</table>
</td>
<td style="padding-left:14px;vertical-align:middle;">
<div style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:13px;letter-spacing:0.22em;text-transform:uppercase;color:${C.accentText};font-weight:700;line-height:1.2;">MOBFLEET</div>
<div style="margin-top:4px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:9px;letter-spacing:0.18em;text-transform:uppercase;color:${C.fgDim};">Fleet Control Plane</div>
</td>
</tr>
</table>
</td></tr>`
}

function emailFooter(): string {
  return `<tr><td style="padding:8px 32px 28px;">
<div style="height:1px;background:${C.line};margin-bottom:0;"></div>
</td></tr>`
}

function heading(text: string): string {
  return `<h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:${C.fg};line-height:1.25;letter-spacing:-0.01em;">${esc(text)}</h1>`
}

function lead(text: string): string {
  return `<p style="margin:0 0 20px;font-size:15px;line-height:1.65;color:${C.fgMuted};">${text}</p>`
}

function cta(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 20px;border-collapse:collapse;">
<tr><td style="border-radius:8px;background:${C.accent};">
<a href="${esc(assertSafeUrl(href))}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 28px;font-size:13px;font-weight:700;color:${C.ctaText};text-decoration:none;border-radius:8px;letter-spacing:0.06em;text-transform:uppercase;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;">${esc(label)}</a>
</td></tr>
</table>`
}

function linkFallback(url: string): string {
  return `<p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:${C.fgDim};">
Or paste this link into your browser:<br>
<span style="word-break:break-all;color:${C.fgMuted};font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:11px;">${esc(assertSafeUrl(url))}</span>
</p>`
}

function note(text: string): string {
  return `<p style="margin:20px 0 0;font-size:12px;line-height:1.55;color:${C.fgDim};">${esc(text)}</p>`
}

function badge(label: string): string {
  return `<span style="display:inline-block;padding:4px 10px;border-radius:4px;background:${C.accentSoft};border:1px solid ${C.accentBorder};color:${C.accentText};font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;">${esc(label)}</span>`
}

function callout(title: string, body: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0;border-collapse:collapse;">
<tr><td style="padding:16px 18px;background:${C.calloutBg};border-left:3px solid ${C.accent};border-radius:0 8px 8px 0;">
<div style="font-size:12px;font-weight:600;color:${C.accentText};margin-bottom:6px;letter-spacing:0.04em;text-transform:uppercase;">${esc(title)}</div>
<div style="font-size:13px;line-height:1.55;color:${C.fgMuted};">${body}</div>
</td></tr>
</table>`
}

function featureList(items: string[]): string {
  const rows = items.map((item) =>
    `<tr><td style="padding:6px 0;vertical-align:top;width:22px;">
<span style="display:inline-block;width:16px;height:16px;border-radius:50%;background:${C.accentSoft};border:1px solid ${C.accentBorder};text-align:center;line-height:16px;font-size:10px;color:${C.accentText};">&#10003;</span>
</td><td style="padding:6px 0 6px 8px;font-size:14px;line-height:1.5;color:${C.fgMuted};">${esc(item)}</td></tr>`,
  ).join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 8px;border-collapse:collapse;">${rows}</table>`
}

function strong(text: string): string {
  return `<strong style="color:${C.fg};font-weight:600;">${esc(text)}</strong>`
}

// ─── Template builders ──────────────────────────────────────────────────────────

export function buildInviteEmail(d: InviteEmailData): RenderedEmail {
  const subject = `${d.inviterName} invited you to ${d.workspaceName} on MOBFLEET`
  const preheader = `${d.inviterName} invited you to join ${d.workspaceName} as ${d.role}.`
  const body =
    heading("You're invited") +
    lead(
      `${strong(d.inviterName)} invited you to join ${strong(d.workspaceName)} on MOBFLEET as ${badge(d.role)}.`,
    ) +
    `<p style="margin:0 0 4px;font-size:14px;line-height:1.6;color:${C.fgMuted};">Accept the invitation to access the fleet console, manage devices, and collaborate with your team.</p>` +
    cta('Accept invitation', d.inviteUrl) +
    linkFallback(d.inviteUrl) +
    note("This link expires soon. If you weren't expecting this invitation, you can safely ignore this email.")
  const text =
    `${d.inviterName} invited you to join "${d.workspaceName}" as ${d.role} on MOBFLEET.\n\n` +
    `Accept your invitation:\n${d.inviteUrl}\n\n` +
    `This link expires soon. If you weren't expecting this, you can ignore it.`
  return { subject, html: wrapDocument(subject, preheader, body), text }
}

export function buildResetEmail(d: ResetEmailData): RenderedEmail {
  const subject = 'Reset your MOBFLEET password'
  const preheader = `Reset your MOBFLEET password. This link expires in ${d.expiresIn}.`
  const body =
    heading('Reset your password') +
    lead('We received a request to reset the password for your MOBFLEET account. Choose a new password using the button below.') +
    cta('Reset password', d.resetUrl) +
    linkFallback(d.resetUrl) +
    callout('Security notice', `This link expires in ${esc(d.expiresIn)}. If you didn't request a password reset, you can safely ignore this email — your password will not change.`) +
    note('For your security, never share this link with anyone.')
  const text =
    `Reset your MOBFLEET password\n\n` +
    `We received a request to reset your password.\n\n` +
    `Reset link:\n${d.resetUrl}\n\n` +
    `This link expires in ${d.expiresIn}. If you didn't request this, ignore this email.`
  return { subject, html: wrapDocument(subject, preheader, body), text }
}

export function buildWelcomeEmail(d: WelcomeEmailData): RenderedEmail {
  const subject = 'Welcome to MOBFLEET'
  const preheader = `Your MOBFLEET account is ready, ${d.name}. Open your dashboard to get started.`
  const body =
    heading(`Welcome, ${d.name}`) +
    lead('Your MOBFLEET account is ready. Jump into your dashboard to start managing your fleet, team, and automations.') +
    featureList([
      'Real-time device orchestration across your fleet',
      'Role-scoped access control for your team',
      'Live telemetry, jobs, and automation pipelines',
    ]) +
    cta('Open dashboard', d.dashboardUrl) +
    linkFallback(d.dashboardUrl) +
    note('Need a hand getting started? Reply to this email and our team will help.')
  const text =
    `Welcome to MOBFLEET, ${d.name}!\n\n` +
    `Your account is ready. Open your dashboard:\n${d.dashboardUrl}\n\n` +
    `Need help? Reply to this email.`
  return { subject, html: wrapDocument(subject, preheader, body), text }
}

/**
 * "Send test email" verification message — fired from Email Settings to prove a
 * team's Resend sender configuration (or the env fallback) actually delivers.
 * Deliberately has NO CTA / link (nothing actionable to click), so it never needs
 * an external URL and can't fail assertSafeUrl. All dynamic values are escaped.
 */
export function buildTestEmail(d: TestEmailData): RenderedEmail {
  const subject = `MOBFLEET test email — ${d.workspaceName}`
  const preheader = `Your MOBFLEET email delivery is working for ${d.workspaceName}.`
  const body =
    heading('Email delivery is working') +
    lead(
      `This is a test email from ${strong(d.workspaceName)} on MOBFLEET. If you received it, your transactional email configuration is delivering correctly.`,
    ) +
    callout('Verified', `Delivered to ${esc(d.recipientEmail)}. No action is required — you can safely ignore this message.`) +
    note('Sent because an administrator triggered a test from Email Settings.')
  const text =
    `MOBFLEET test email — ${d.workspaceName}\n\n` +
    `This is a test email. If you received it, your transactional email configuration is delivering correctly.\n\n` +
    `Delivered to ${d.recipientEmail}. No action is required.`
  return { subject, html: wrapDocument(subject, preheader, body), text }
}

// ─── Supabase Auth: password reset ────────────────────────────────────────────
// IMPORTANT: MobFleet password reset is sent by SUPABASE AUTH, not the server
// mailer. Supabase substitutes its own variables server-side, so the CTA points at
// the literal {{ .ConfirmationURL }} placeholder (a trusted Supabase token, not
// user data — assertSafeUrl lets '{{ …' pass through). Render this and paste the
// HTML into Supabase Dashboard → Authentication → Email Templates → Reset Password.
// The committed artifact lives at supabase/templates/reset-password.html.

/** Supabase Auth's confirmation-URL template variable for the recovery link. */
export const SUPABASE_CONFIRMATION_URL = '{{ .ConfirmationURL }}'

/** Branded HTML/text for the Supabase Auth "Reset Password" email. No precise
 *  expiry is stated (Supabase controls it); the copy uses a generic security note. */
export function buildSupabaseResetEmail(): RenderedEmail {
  const subject = 'Reset your MOBFLEET password'
  const preheader = 'Reset your MOBFLEET account password securely.'
  const body =
    heading('Reset your password') +
    lead('We received a request to reset the password for your MOBFLEET account. Choose a new password using the button below.') +
    cta('Reset password', SUPABASE_CONFIRMATION_URL) +
    linkFallback(SUPABASE_CONFIRMATION_URL) +
    callout(
      'Security notice',
      "This link can only be used once and expires after a short period for your security. If you didn't request a password reset, you can safely ignore this email — your password will not change.",
    ) +
    note('For your security, never share this link with anyone.')
  const text =
    `Reset your MOBFLEET password\n\n` +
    `We received a request to reset your password. Open this link to choose a new one:\n${SUPABASE_CONFIRMATION_URL}\n\n` +
    `This link can only be used once and expires after a short period. If you didn't request this, you can safely ignore this email.`
  return { subject, html: wrapDocument(subject, preheader, body), text }
}

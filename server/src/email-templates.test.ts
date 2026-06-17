import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildInviteEmail,
  buildResetEmail,
  buildWelcomeEmail,
  buildSupabaseResetEmail,
  buildTestEmail,
  assertSafeUrl,
  esc,
  SUPABASE_CONFIRMATION_URL,
} from '../../src/shared/email-templates'

// Pure-function tests for the shared MobFleet email templates — the single source
// of truth used by the Fastify mailer (server/src/mailer.ts), the in-product
// previews, and the Supabase Edge Function copy. The actual Resend/console send is
// I/O and exercised at runtime (mirroring the other server tests); sender
// resolution + env fallback are covered by email-settings.test.ts.

const INVITE = { inviterName: 'Alex Morgan', workspaceName: 'MOBFLEET Operations', role: 'Operator', inviteUrl: 'https://mobfleet.co/invite?token=abc123' }
const RESET = { resetUrl: 'https://mobfleet.co/reset-password#token=xyz', expiresIn: '30 minutes' }
const WELCOME = { name: 'Alex', dashboardUrl: 'https://mobfleet.co/' }
const TEST = { workspaceName: 'MOBFLEET Operations', recipientEmail: 'ops@acme.com' }

// ── Shared layout (applies to every template) ────────────────────────────────
for (const [label, render] of [
  ['invite', () => buildInviteEmail(INVITE)],
  ['reset', () => buildResetEmail(RESET)],
  ['welcome', () => buildWelcomeEmail(WELCOME)],
  ['supabase-reset', () => buildSupabaseResetEmail()],
  ['test', () => buildTestEmail(TEST)],
] as const) {
  test(`[${label}] returns a complete, self-contained HTML document`, () => {
    const { html } = render()
    assert.ok(html.startsWith('<!doctype html>'), 'starts with doctype')
    assert.match(html, /<html[\s>]/)
    assert.match(html, /<\/head>/)
    assert.match(html, /<\/body>\s*<\/html>/)
  })

  test(`[${label}] uses the approved palette (#0a0a0a background, #2dd4bf accent)`, () => {
    const { html } = render()
    assert.ok(html.includes('#0a0a0a'), 'body background #0a0a0a present')
    assert.ok(html.includes('#2dd4bf'), 'teal accent #2dd4bf present')
    assert.ok(html.includes('#ffffff'), 'white primary text present')
  })

  test(`[${label}] carries MobFleet branding`, () => {
    const { html } = render()
    assert.match(html, /mobfleet/i)
    assert.ok(html.includes('Fleet Control Plane'))
  })

  test(`[${label}] has a plain-text fallback and a subject`, () => {
    const { subject, text, html } = render()
    assert.ok(subject.length > 0)
    assert.ok(text.length > 0)
    assert.ok(html.length > 0)
  })

  test(`[${label}] is email-safe: no scripts, no Tailwind classes, no CSS vars, no secrets`, () => {
    const { html } = render()
    assert.ok(!/<script/i.test(html), 'no <script>')
    assert.ok(!html.includes('class='), 'no class= (no Tailwind)')
    assert.ok(!html.includes('var(--'), 'no CSS custom properties')
    assert.ok(!/re_[A-Za-z0-9]/.test(html), 'no Resend-key-like value')
    assert.ok(!/RESEND_API_KEY|SUPABASE_JWT_SECRET/.test(html), 'no secret env names')
  })

  test(`[${label}] has a hidden preheader`, () => {
    const { html } = render()
    assert.match(html, /display:none[^>]*max-height:0/)
  })
}

// ── Team invite ───────────────────────────────────────────────────────────────
test('invite: subject names the inviter and workspace', () => {
  const { subject } = buildInviteEmail(INVITE)
  assert.ok(subject.includes('Alex Morgan'))
  assert.ok(subject.includes('MOBFLEET Operations'))
})

test('invite: renders workspace, inviter, role, URL and the Accept CTA', () => {
  const { html } = buildInviteEmail(INVITE)
  assert.ok(html.includes('Alex Morgan'))
  assert.ok(html.includes('MOBFLEET Operations'))
  assert.ok(html.includes('Operator'))
  assert.ok(html.includes('https://mobfleet.co/invite?token=abc123'))
  assert.match(html, /Accept invitation/i)
})

test('invite: escapes dynamic HTML (no injection)', () => {
  const { html } = buildInviteEmail({ ...INVITE, inviterName: '<script>x</script>', workspaceName: 'A & B', role: '"Op"' })
  assert.ok(!html.includes('<script>x</script>'))
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(html.includes('A &amp; B'))
})

// ── Password reset (server template — optional custom path) ───────────────────
test('reset: correct subject, URL, CTA, security + expiry', () => {
  const { subject, html } = buildResetEmail(RESET)
  assert.equal(subject, 'Reset your MOBFLEET password')
  assert.ok(html.includes('https://mobfleet.co/reset-password#token=xyz'))
  assert.match(html, /Reset password/i)
  assert.match(html, /Security notice/i)
  assert.match(html, /didn.t request/i)
  assert.ok(html.includes('30 minutes'), 'expiry rendered when supplied')
})

test('reset: rejects an unsafe CTA URL and fails safe on a missing one', () => {
  assert.throws(() => buildResetEmail({ resetUrl: 'javascript:alert(1)', expiresIn: '1 hour' }), /unsafe CTA URL/)
  assert.throws(() => buildResetEmail({ resetUrl: '', expiresIn: '1 hour' }), /absolute http/)
})

// ── Password reset (Supabase Auth — the ACTIVE path) ──────────────────────────
test('supabase reset: embeds the Supabase confirmation-URL variable verbatim', () => {
  const { html, text, subject } = buildSupabaseResetEmail()
  assert.equal(subject, 'Reset your MOBFLEET password')
  assert.ok(html.includes(SUPABASE_CONFIRMATION_URL))
  assert.ok(html.includes('{{ .ConfirmationURL }}'))
  assert.ok(text.includes('{{ .ConfirmationURL }}'))
  assert.match(html, /Reset password/i)
  assert.match(html, /can only be used once/i)
})

// ── Welcome ───────────────────────────────────────────────────────────────────
test('welcome: subject, heading, dashboard URL and CTA', () => {
  const { subject, html } = buildWelcomeEmail(WELCOME)
  assert.equal(subject, 'Welcome to MOBFLEET')
  assert.match(html, /Welcome, Alex/)
  assert.ok(html.includes('https://mobfleet.co/'))
  assert.match(html, /Open dashboard/i)
})

test('welcome: escapes the recipient name', () => {
  const { html } = buildWelcomeEmail({ name: '<b>x</b>', dashboardUrl: 'https://mobfleet.co/' })
  assert.ok(!html.includes('<b>x</b>'))
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'))
})

// ── Test email (delivery verification) ────────────────────────────────────────
test('test email: subject names the workspace, body confirms delivery + echoes the recipient', () => {
  const { subject, html, text } = buildTestEmail(TEST)
  assert.ok(subject.includes('MOBFLEET Operations'))
  assert.match(html, /delivery is working/i)
  assert.ok(html.includes('ops@acme.com'), 'recipient echoed')
  assert.ok(text.includes('ops@acme.com'))
})

test('test email: has NO actionable link (nothing to click, never needs a URL)', () => {
  const { html } = buildTestEmail(TEST)
  assert.ok(!/href="https?:/i.test(html), 'no http(s) anchor href')
})

test('test email: escapes dynamic values (no injection via workspace/recipient)', () => {
  const { html } = buildTestEmail({ workspaceName: 'A & <b>B</b>', recipientEmail: '"x"@y.com' })
  assert.ok(!html.includes('<b>B</b>'))
  assert.ok(html.includes('A &amp; &lt;b&gt;B&lt;/b&gt;'))
})

// ── URL validation helper ─────────────────────────────────────────────────────
test('assertSafeUrl: allows http(s); rejects javascript/data/file; passes sentinels', () => {
  assert.equal(assertSafeUrl('https://mobfleet.co/x'), 'https://mobfleet.co/x')
  assert.equal(assertSafeUrl('http://localhost:5173/reset-password'), 'http://localhost:5173/reset-password')
  assert.equal(assertSafeUrl('#'), '#')
  assert.equal(assertSafeUrl('{{ .ConfirmationURL }}'), '{{ .ConfirmationURL }}')
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', '', 'not a url']) {
    assert.throws(() => assertSafeUrl(bad), `should reject ${JSON.stringify(bad)}`)
  }
})

test('esc handles the five HTML-significant characters', () => {
  assert.equal(esc(`& < > " '`), `&amp; &lt; &gt; &quot; &#39;`)
})

import { test, expect } from 'playwright/test'
import {
  normalizeEmailPreferences,
  DEFAULT_EMAIL_PREFERENCES,
} from '../src/lib/email/preferences'
import {
  renderPreview,
  buildInviteEmail,
  buildResetEmail,
  buildWelcomeEmail,
  SAMPLE_INVITE,
  SAMPLE_RESET,
  SAMPLE_WELCOME,
} from '../src/lib/email/preview-templates'
import { canAccessEmailSettings } from '../src/lib/email/access'
import type { Member } from '../src/lib/authorization/effective-access'

/**
 * Pure-function tests (no browser, no server) for the Email settings logic:
 * preference normalization/migration, access control, and the preview template
 * builders. Runs in the Playwright `engine` project.
 */

const member = (over: Partial<Member> & { role: Member['role'] }): Member => ({
  id: over.id ?? `m-${over.role}`,
  role: over.role,
  suspended: over.suspended,
  overrides: over.overrides ?? {},
  scope: over.scope ?? { type: 'workspace', groups: [], phones: [] },
})

// ─── Access control ───────────────────────────────────────────────────────────

test('Owner and Admin may access email settings', () => {
  expect(canAccessEmailSettings(member({ role: 'owner' }))).toBe(true)
  expect(canAccessEmailSettings(member({ role: 'admin' }))).toBe(true)
})

test('Manager, Operator, and Viewer may not access email settings', () => {
  expect(canAccessEmailSettings(member({ role: 'manager' }))).toBe(false)
  expect(canAccessEmailSettings(member({ role: 'operator' }))).toBe(false)
  expect(canAccessEmailSettings(member({ role: 'viewer' }))).toBe(false)
})

test('a suspended Owner/Admin may not access email settings', () => {
  expect(canAccessEmailSettings(member({ role: 'owner', suspended: true }))).toBe(false)
  expect(canAccessEmailSettings(member({ role: 'admin', suspended: true }))).toBe(false)
})

// ─── Preference normalization + migration ──────────────────────────────────────

test('defaults are all enabled', () => {
  expect(DEFAULT_EMAIL_PREFERENCES).toEqual({
    teamInvitesEnabled: true,
    passwordResetEnabled: true,
    welcomeEmailEnabled: true,
  })
})

test('missing fields fall back to defaults; existing valid values are preserved', () => {
  const out = normalizeEmailPreferences({ teamInvitesEnabled: false })
  expect(out.teamInvitesEnabled).toBe(false) // preserved
  expect(out.passwordResetEnabled).toBe(true) // defaulted
  expect(out.welcomeEmailEnabled).toBe(true) // defaulted
})

test('invalid / corrupt stored values fall back to defaults and signal onInvalid', () => {
  let warned = 0
  const out = normalizeEmailPreferences({ teamInvitesEnabled: 'yes', welcomeEmailEnabled: 1 }, () => { warned++ })
  expect(out).toEqual(DEFAULT_EMAIL_PREFERENCES)
  expect(warned).toBeGreaterThan(0)
})

test('non-object input returns defaults without throwing', () => {
  expect(normalizeEmailPreferences(undefined)).toEqual(DEFAULT_EMAIL_PREFERENCES)
  expect(normalizeEmailPreferences(null)).toEqual(DEFAULT_EMAIL_PREFERENCES)
  expect(normalizeEmailPreferences('broken')).toEqual(DEFAULT_EMAIL_PREFERENCES)
})

test('migration preserves a fully valid older blob unchanged', () => {
  const stored = { teamInvitesEnabled: false, passwordResetEnabled: true, welcomeEmailEnabled: false }
  expect(normalizeEmailPreferences(stored)).toEqual(stored)
})

// ─── Preview template builders ──────────────────────────────────────────────────

test('invite preview mirrors the server invite template (inviter, workspace, role)', () => {
  const { subject, html } = buildInviteEmail(SAMPLE_INVITE)
  expect(subject).toContain('Alex Morgan')
  expect(subject).toContain('MOBFLEET')
  expect(html).toContain('Alex Morgan')
  expect(html).toContain('MOBFLEET Operations')
  expect(html).toContain('Operator')
  expect(html).toContain('Accept your invitation')
})

test('reset preview renders the expiry window', () => {
  const { subject, html } = buildResetEmail(SAMPLE_RESET)
  expect(subject).toContain('Reset your MOBFLEET password')
  expect(html).toContain('30 minutes')
  expect(html).toContain('Reset password')
})

test('welcome preview greets the recipient', () => {
  const { subject, html } = buildWelcomeEmail(SAMPLE_WELCOME)
  expect(subject).toContain('Welcome to MOBFLEET')
  expect(html).toContain('Welcome, Alex')
  expect(html).toContain('Open dashboard')
})

test('every preview is a self-contained HTML document with inert links', () => {
  for (const type of ['invite', 'reset', 'welcome'] as const) {
    const { html } = renderPreview(type)
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('</html>')
    // Sample CTAs use href="#" so they cannot navigate from the sandboxed iframe.
    expect(html).toContain('href="#"')
    // No script tags in the preview markup.
    expect(html.toLowerCase()).not.toContain('<script')
  }
})

test('builders HTML-escape interpolated values', () => {
  const { html } = buildInviteEmail({
    inviterName: '<script>x</script>',
    workspaceName: 'A & B',
    role: '"Op"',
    inviteUrl: '#',
  })
  expect(html).not.toContain('<script>x</script>')
  expect(html).toContain('&lt;script&gt;')
  expect(html).toContain('A &amp; B')
})

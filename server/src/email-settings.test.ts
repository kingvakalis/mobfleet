import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getSecretLast4,
  formatFrom,
  resolveApiKeyForUpdate,
  parseFrom,
  chooseMailSender,
  toSafeEmailSettings,
  emailSettingsBody,
  type TeamEmailSettingsRow,
} from './email-settings'

const ENV = { transport: 'resend', from: 'MobFleet <invites@mobfleet.local>', apiKey: 're_env_KEY_envenv' }
const teamRow = (over: Partial<TeamEmailSettingsRow> = {}): TeamEmailSettingsRow => ({
  id: 'emailcfg_1', teamId: 'team-1', senderEmail: 'ops@acme.com', senderName: 'Acme Ops',
  resendApiKey: 're_team_ABCD1234', updatedAt: 1_700_000_000_000, ...over,
})

// ── Secret masking ──────────────────────────────────────────────────────────
test('getSecretLast4 returns last 4 or null — never the full secret', () => {
  assert.equal(getSecretLast4('re_abcd1234WXYZ'), 'WXYZ')
  assert.equal(getSecretLast4(null), null)
  assert.equal(getSecretLast4(undefined), null)
  assert.equal(getSecretLast4(''), null)
})

test('toSafeEmailSettings exposes only the last 4 chars — never the full key', () => {
  const safe = toSafeEmailSettings(teamRow({ resendApiKey: 're_super_secret_LAST' }))
  assert.equal(safe.hasResendApiKey, true)
  assert.equal(safe.resendApiKeyLast4, 'LAST')
  assert.equal(safe.resendApiKeyMasked, '••••LAST')
  assert.equal(JSON.stringify(safe).includes('re_super_secret'), false) // full key never serialized
  assert.equal(safe.senderEmail, 'ops@acme.com')
  assert.equal(typeof safe.updatedAt, 'string')
})

// ── Header-injection-safe From ──────────────────────────────────────────────
test('formatFrom builds "Name <email>" and strips CR/LF', () => {
  assert.equal(formatFrom('Acme Ops', 'ops@acme.com'), 'Acme Ops <ops@acme.com>')
  assert.equal(formatFrom('Evil\r\nBcc: x@y.com', 'ops@acme.com'), 'Evil Bcc: x@y.com <ops@acme.com>')
  assert.equal(formatFrom('Ops', 'ops@acme.com\r\nDATA'), 'Ops <ops@acme.comDATA>')
})

// ── API-key preservation vs replacement ─────────────────────────────────────
test('resolveApiKeyForUpdate preserves the stored key on blank/omitted, replaces on a real key', () => {
  assert.equal(resolveApiKeyForUpdate('re_old', undefined), 're_old')
  assert.equal(resolveApiKeyForUpdate('re_old', ''), 're_old')
  assert.equal(resolveApiKeyForUpdate('re_old', '   '), 're_old')
  assert.equal(resolveApiKeyForUpdate('re_old', 're_new'), 're_new')
  assert.equal(resolveApiKeyForUpdate(null, undefined), null) // first create + no key → caller 400s
  assert.equal(resolveApiKeyForUpdate(null, 're_first'), 're_first')
})

// ── Env-default parsing ─────────────────────────────────────────────────────
test('parseFrom splits "Name <email>" or a bare email', () => {
  assert.deepEqual(parseFrom('MobFleet <invites@mobfleet.local>'), { senderName: 'MobFleet', senderEmail: 'invites@mobfleet.local' })
  assert.deepEqual(parseFrom('plain@x.com'), { senderName: 'MobFleet', senderEmail: 'plain@x.com' })
})

// ── Sender selection (team vs env) ──────────────────────────────────────────
test('chooseMailSender uses the team Resend key + From identity when configured', () => {
  const s = chooseMailSender(teamRow(), ENV)
  assert.equal(s.transport, 'resend')
  assert.equal(s.source, 'team')
  assert.equal(s.apiKey, 're_team_ABCD1234')
  assert.equal(s.from, 'Acme Ops <ops@acme.com>')
})

test('chooseMailSender falls back to env when there is no team row', () => {
  const s = chooseMailSender(null, ENV)
  assert.equal(s.source, 'env')
  assert.equal(s.transport, 'resend')
  assert.equal(s.apiKey, ENV.apiKey)
  assert.equal(s.from, ENV.from)
})

test('chooseMailSender falls back to env when the team row is missing a key', () => {
  assert.equal(chooseMailSender(teamRow({ resendApiKey: '' }), ENV).source, 'env')
})

test('chooseMailSender uses console transport when env has no resend key', () => {
  const s = chooseMailSender(null, { transport: 'console', from: ENV.from })
  assert.equal(s.transport, 'console')
  assert.equal(s.source, 'env')
})

test('different teams resolve to different keys', () => {
  const a = chooseMailSender(teamRow({ resendApiKey: 're_AAAA1111' }), ENV)
  const b = chooseMailSender(teamRow({ resendApiKey: 're_BBBB2222' }), ENV)
  assert.notEqual(a.apiKey, b.apiKey)
})

// ── Zod validation ──────────────────────────────────────────────────────────
test('emailSettingsBody accepts valid input (key optional on update)', () => {
  assert.equal(emailSettingsBody.safeParse({ senderEmail: 'a@b.com', senderName: 'Ops', resendApiKey: 're_abcd1234' }).success, true)
  assert.equal(emailSettingsBody.safeParse({ senderEmail: 'a@b.com', senderName: 'Ops' }).success, true)
})

test('emailSettingsBody rejects invalid email and empty sender name', () => {
  assert.equal(emailSettingsBody.safeParse({ senderEmail: 'not-an-email', senderName: 'Ops' }).success, false)
  assert.equal(emailSettingsBody.safeParse({ senderEmail: 'a@b.com', senderName: '' }).success, false)
  assert.equal(emailSettingsBody.safeParse({ senderEmail: 'a@b.com', senderName: '   ' }).success, false)
})

test('emailSettingsBody rejects CR/LF in the sender name (header injection)', () => {
  assert.equal(emailSettingsBody.safeParse({ senderEmail: 'a@b.com', senderName: 'Ops\r\nBcc: x@y.com' }).success, false)
})

test('emailSettingsBody rejects a masked value as the API key, and out-of-range lengths', () => {
  assert.equal(emailSettingsBody.safeParse({ senderEmail: 'a@b.com', senderName: 'Ops', resendApiKey: '••••LAST' }).success, false)
  assert.equal(emailSettingsBody.safeParse({ senderEmail: 'a@b.com', senderName: 'Ops', resendApiKey: 'short' }).success, false)
  assert.equal(emailSettingsBody.safeParse({ senderEmail: 'a@b.com', senderName: 'Ops', resendApiKey: 'x'.repeat(513) }).success, false)
})

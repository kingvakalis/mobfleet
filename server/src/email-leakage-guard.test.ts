import { test } from 'node:test'
import assert from 'node:assert/strict'

// FORCE the documented safe transport for the whole test process BEFORE importing
// any module that resolves the mailer config. The worktree's shared node_modules
// junction causes Prisma's generated client to auto-load the canonical repo's
// server/.env via dotenv — which in this environment carries a REAL Resend key
// (MAIL_TRANSPORT=resend + re_…). Pinning console here guarantees the test process
// can never select a real send, regardless of that inherited .env.
process.env.MAIL_TRANSPORT = 'console'

const { chooseMailSender } = await import('./email-settings')

/**
 * EXTERNAL-EMAIL LEAKAGE GUARD (release validation, Subagent 5).
 *
 * Proves no test/CI path can deliver REAL email through Resend. The mailer's single
 * decision point is `chooseMailSender` (pure): unless transport is explicitly
 * 'resend' AND an API key is present, it MUST resolve to the dev 'console' transport
 * that only logs a link.
 *
 * KEY SAFETY PROPERTY (verified with the env as the test process actually sees it):
 * even when a real RESEND_API_KEY is leaked into process.env (it is, via the shared
 * node_modules → canonical server/.env — see header), forcing MAIL_TRANSPORT=console
 * makes the env-resolved sender console. A real send is only possible via an explicit
 * team Resend config, never accidentally from a stray env key.
 *
 * Runs under `npm test` (pure, no DB, no network).
 */

const TEAM = { senderName: 'Acme', senderEmail: 'team@acme.test', resendApiKey: 'rk_team_secret' }

function envCfg() {
  return {
    transport: process.env.MAIL_TRANSPORT ?? 'console',
    from: process.env.MAIL_FROM ?? 'MobFleet <invites@mobfleet.local>',
    apiKey: process.env.RESEND_API_KEY,
  }
}

test('with transport forced to console, the env sender NEVER sends — even with a leaked real key', () => {
  const r = chooseMailSender(null, envCfg())
  assert.equal(r.transport, 'console', 'forced-console env must resolve to console transport')
  assert.equal(r.source, 'env')
})

test('env transport=resend but NO key → still console (cannot send)', () => {
  const r = chooseMailSender(null, { transport: 'resend', from: 'X <x@y.z>', apiKey: undefined })
  assert.equal(r.transport, 'console', 'resend without a key must fall back to console, never send')
})

test('env transport=console even WITH a key → console (explicit opt-out wins)', () => {
  const r = chooseMailSender(null, { transport: 'console', from: 'X <x@y.z>', apiKey: 'rk_live_should_not_send' })
  assert.equal(r.transport, 'console', 'console transport must never escalate to a real send')
})

test('a team row with key + identity is the ONLY way mail leaves via resend', () => {
  const r = chooseMailSender(TEAM, { transport: 'console', from: 'X <x@y.z>' })
  assert.equal(r.transport, 'resend')
  assert.equal(r.source, 'team')
  // A team row missing any piece must NOT select resend.
  assert.equal(chooseMailSender({ ...TEAM, resendApiKey: '' }, { transport: 'console', from: 'X <x@y.z>' }).transport, 'console')
  assert.equal(chooseMailSender({ ...TEAM, senderEmail: '' }, { transport: 'console', from: 'X <x@y.z>' }).transport, 'console')
})

test('TEST RUNNER INVARIANT: the resolved env transport under test is console (no accidental real send)', () => {
  // The actionable safety check: whatever leaks into process.env, the EFFECTIVE
  // env-resolved transport this test process would use must be console. If this
  // ever fails, the suite is one bad code path away from sending live email.
  const resolved = chooseMailSender(null, envCfg())
  assert.equal(
    resolved.transport,
    'console',
    'the test process resolves to a REAL email transport — a send could leak. ' +
      'Ensure MAIL_TRANSPORT=console (forced at the top of this file) takes effect, ' +
      'or remove the real RESEND_API_KEY from the inherited .env.',
  )
})

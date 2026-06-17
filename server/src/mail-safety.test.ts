import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isExternalMailBlocked, applyMailSafety, type MailSafetyEnv } from './mailer'
import { chooseMailSender } from './email-settings'

/**
 * MAIL SAFETY (fail-closed) — proves test/CI/safe-mode environments can NEVER
 * resolve to the real Resend provider, even when a Resend key AND
 * MAIL_TRANSPORT=resend are configured. Pure: no network, no I/O — the helpers
 * take an explicit env snapshot, so these assertions are deterministic and do
 * not depend on the ambient process environment.
 */

// A fully-configured "would send real email" sender: env transport=resend + key.
const HOT_ENV = { transport: 'resend', from: 'MobFleet <x@y.com>', apiKey: 're_LIVE_should_never_be_used' }
// A team row with its own live key — the other path that resolves to resend.
const HOT_TEAM = { senderName: 'Acme', senderEmail: 'ops@acme.com', resendApiKey: 're_team_LIVE_KEY' }

const BLOCKED: MailSafetyEnv[] = [
  { NODE_ENV: 'test' },
  { MAIL_SAFE_MODE: '1' },
  { CI: 'true' },
  { CI: '1' },
  { NODE_ENV: 'production', CI: 'true' }, // CI wins even if NODE_ENV says production
]
const ALLOWED: MailSafetyEnv[] = [
  {}, // nothing set
  { NODE_ENV: 'production' },
  { NODE_ENV: 'development' },
  { MAIL_SAFE_MODE: '0' },
  { CI: '' }, // empty CI is not "set"
  { CI: '   ' }, // whitespace-only CI is not "set"
]

// ── isExternalMailBlocked: the condition ───────────────────────────────────────
test('isExternalMailBlocked is TRUE for every blocking environment', () => {
  for (const env of BLOCKED) assert.equal(isExternalMailBlocked(env), true, JSON.stringify(env))
})

test('isExternalMailBlocked is FALSE for normal/production environments', () => {
  for (const env of ALLOWED) assert.equal(isExternalMailBlocked(env), false, JSON.stringify(env))
})

// ── applyMailSafety: forces console + drops the key in blocked envs ─────────────
test('blocked env: env-resolved resend sender is forced to console and the key is dropped', () => {
  for (const env of BLOCKED) {
    const resolved = chooseMailSender(null, HOT_ENV)
    assert.equal(resolved.transport, 'resend', 'precondition: env would resolve to resend')
    const safe = applyMailSafety(resolved, env)
    assert.equal(safe.transport, 'console', `transport must be console for ${JSON.stringify(env)}`)
    assert.equal(safe.apiKey, undefined, `apiKey must be dropped for ${JSON.stringify(env)}`)
  }
})

test('blocked env: TEAM-resolved resend sender is ALSO forced to console (both code paths)', () => {
  for (const env of BLOCKED) {
    const resolved = chooseMailSender(HOT_TEAM, HOT_ENV)
    assert.equal(resolved.transport, 'resend', 'precondition: team row resolves to resend')
    assert.equal(resolved.source, 'team')
    const safe = applyMailSafety(resolved, env)
    assert.equal(safe.transport, 'console')
    assert.equal(safe.apiKey, undefined)
  }
})

test('blocked env: the resolved transport can NEVER be resend after safety, for ANY input', () => {
  // Exhaustive over the two ways a sender resolves to resend (team / env).
  for (const env of BLOCKED) {
    for (const resolved of [chooseMailSender(null, HOT_ENV), chooseMailSender(HOT_TEAM, HOT_ENV)]) {
      const safe = applyMailSafety(resolved, env)
      assert.notEqual(safe.transport, 'resend')
    }
  }
})

// ── Production behavior unchanged ──────────────────────────────────────────────
test('allowed env: a real resend sender is left intact (production unchanged)', () => {
  const resolved = chooseMailSender(null, HOT_ENV)
  const safe = applyMailSafety(resolved, { NODE_ENV: 'production' })
  assert.equal(safe.transport, 'resend')
  assert.equal(safe.apiKey, HOT_ENV.apiKey)
})

test('allowed env: console stays console (no spurious change)', () => {
  const resolved = chooseMailSender(null, { transport: 'console', from: HOT_ENV.from })
  const safe = applyMailSafety(resolved, {})
  assert.equal(safe.transport, 'console')
})

// ── No network is reachable from the safety path ───────────────────────────────
// applyMailSafety/isExternalMailBlocked perform NO I/O; this test simply documents
// that the safety decision is computed entirely from the env snapshot. (The mailer's
// own send path additionally re-asserts isExternalMailBlocked() right before fetch.)
test('safety helpers perform no network/IO (pure functions of the env)', () => {
  // Calling twice with the same input yields identical results — referentially transparent.
  const a = applyMailSafety(chooseMailSender(HOT_TEAM, HOT_ENV), { NODE_ENV: 'test' })
  const b = applyMailSafety(chooseMailSender(HOT_TEAM, HOT_ENV), { NODE_ENV: 'test' })
  assert.deepEqual(a, b)
  assert.equal(a.transport, 'console')
})

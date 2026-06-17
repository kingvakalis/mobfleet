import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTransactionalPreferences } from './email-settings'

// Pure coverage of transactional email preference normalization (the shared
// EmailPreferences contract, reused server-side). No DB.

const ALL_ON = { teamInvitesEnabled: true, passwordResetEnabled: true, welcomeEmailEnabled: true }

test('defaults to all-enabled for null / undefined / non-object input', () => {
  assert.deepEqual(normalizeTransactionalPreferences(null), ALL_ON)
  assert.deepEqual(normalizeTransactionalPreferences(undefined), ALL_ON)
  assert.deepEqual(normalizeTransactionalPreferences('nope'), ALL_ON)
  assert.deepEqual(normalizeTransactionalPreferences(42), ALL_ON)
  assert.deepEqual(normalizeTransactionalPreferences([]), ALL_ON)
})

test('keeps valid booleans and defaults missing fields', () => {
  assert.deepEqual(normalizeTransactionalPreferences({ teamInvitesEnabled: false }), {
    teamInvitesEnabled: false, passwordResetEnabled: true, welcomeEmailEnabled: true,
  })
})

test('defaults a non-boolean field rather than trusting it', () => {
  assert.deepEqual(normalizeTransactionalPreferences({ welcomeEmailEnabled: false, passwordResetEnabled: 'x' }), {
    teamInvitesEnabled: true, passwordResetEnabled: true, welcomeEmailEnabled: false,
  })
})

test('ignores unknown keys (never leaks them into the stored blob)', () => {
  const r = normalizeTransactionalPreferences({ teamInvitesEnabled: false, bogus: true })
  assert.deepEqual(r, { teamInvitesEnabled: false, passwordResetEnabled: true, welcomeEmailEnabled: true })
  assert.equal('bogus' in r, false)
})

test('round-trips a fully-specified, all-off object', () => {
  const off = { teamInvitesEnabled: false, passwordResetEnabled: false, welcomeEmailEnabled: false }
  assert.deepEqual(normalizeTransactionalPreferences(off), off)
})

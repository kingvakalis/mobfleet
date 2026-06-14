import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildClaimedDevice, hashApiKey, isPairingTokenValid } from './provisioning'
import { claimDeviceBody } from '../../src/shared/schemas'

// ── isPairingTokenValid ───────────────────────────────────────────────────────

test('isPairingTokenValid: unknown token → 400', () => {
  const r = isPairingTokenValid(null, 1000)
  assert.equal(r.ok, false)
  assert.equal(r.ok === false && r.status, 400)
})

test('isPairingTokenValid: already-claimed token → 409', () => {
  const r = isPairingTokenValid({ expiresAt: 10_000, claimedByDeviceId: 'dev-1' }, 1000)
  assert.equal(r.ok, false)
  assert.equal(r.ok === false && r.status, 409)
})

test('isPairingTokenValid: expired (and unclaimed) token → 410', () => {
  const r = isPairingTokenValid({ expiresAt: 1000, claimedByDeviceId: null }, 1000) // expiresAt <= now
  assert.equal(r.ok, false)
  assert.equal(r.ok === false && r.status, 410)
})

test('isPairingTokenValid: fresh, unclaimed token → ok', () => {
  assert.deepEqual(isPairingTokenValid({ expiresAt: 10_000, claimedByDeviceId: null }, 1000), { ok: true })
})

test('isPairingTokenValid: claimed takes precedence over expiry', () => {
  // A claimed token reports "already claimed" even if it is also past expiry.
  const r = isPairingTokenValid({ expiresAt: 500, claimedByDeviceId: 'dev-1' }, 1000)
  assert.equal(r.ok === false && r.status, 409)
})

// ── buildClaimedDevice ────────────────────────────────────────────────────────

test('buildClaimedDevice: starts offline with no heartbeat and carries the udid', () => {
  const d = buildClaimedDevice(
    { pairingToken: 't', udid: 'UDID-123', name: 'Lab iPhone', platform: 'ios', osVersion: 'iOS 18.2' },
    'dev-abc123',
    777,
  )
  assert.equal(d.id, 'dev-abc123')
  assert.equal(d.name, 'Lab iPhone')
  assert.equal(d.status, 'offline')
  assert.equal(d.udid, 'UDID-123')
  assert.equal(d.platform, 'ios')
  assert.equal(d.osVersion, 'iOS 18.2')
  assert.equal(d.lastHeartbeat, null)
  assert.equal(d.createdAt, 777)
})

test('buildClaimedDevice: derives a name when none is given', () => {
  const d = buildClaimedDevice({ pairingToken: 't', udid: 'U' }, 'dev-00ff99', 1)
  assert.equal(d.name, 'Device FF99')
  assert.equal(d.platform, 'ios') // default
})

// ── hashApiKey ────────────────────────────────────────────────────────────────

test('hashApiKey is deterministic, hex, and not the plaintext', () => {
  const key = 'super-secret-key'
  const h = hashApiKey(key)
  assert.equal(h, hashApiKey(key)) // stable
  assert.match(h, /^[0-9a-f]{64}$/) // sha-256 hex
  assert.notEqual(h, key)
  assert.notEqual(hashApiKey('a'), hashApiKey('b'))
})

// ── claimDeviceBody schema ────────────────────────────────────────────────────

const UUID = '11111111-1111-4111-8111-111111111111'

test('claimDeviceBody requires a UUID pairingToken + udid; the rest optional', () => {
  assert.equal(claimDeviceBody.safeParse({ pairingToken: UUID, udid: 'u' }).success, true)
  assert.equal(
    claimDeviceBody.safeParse({ pairingToken: UUID, udid: 'u', name: 'N', platform: 'android', osVersion: '14' }).success,
    true,
  )
  assert.equal(claimDeviceBody.safeParse({ udid: 'u' }).success, false) // no token
  assert.equal(claimDeviceBody.safeParse({ pairingToken: UUID }).success, false) // no udid
  assert.equal(claimDeviceBody.safeParse({ pairingToken: '', udid: 'u' }).success, false) // empty token
})

test('claimDeviceBody rejects non-UUID tokens and unknown platforms', () => {
  assert.equal(claimDeviceBody.safeParse({ pairingToken: 't', udid: 'u' }).success, false) // not a UUID
  assert.equal(claimDeviceBody.safeParse({ pairingToken: 'not-a-uuid-string', udid: 'u' }).success, false)
  assert.equal(claimDeviceBody.safeParse({ pairingToken: UUID, udid: 'u', platform: 'windows' }).success, false)
  assert.equal(claimDeviceBody.safeParse({ pairingToken: UUID, udid: 'u', platform: 'ios' }).success, true)
})

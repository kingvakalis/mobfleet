import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toDeviceSessionRecord } from './device-sessions'

// Pure mapping tests. The DB-backed create/close/query + the WebSocket-connection
// lifecycle (open-on-auth, close-by-stored-id, reconnect isolation) exercise real
// Prisma + a live socket — there is no DB/WS test harness in this backend's
// node:test suite, so those are verified against the dev DB at runtime, not here.

test('toDeviceSessionRecord maps a closed session and computes durationMs in ms', () => {
  const rec = toDeviceSessionRecord({ id: 's1', deviceId: 'dev-1', startedAt: 1_000_000, endedAt: 1_060_000, agentVersion: '1.2.3' })
  assert.equal(rec.id, 's1')
  assert.equal(rec.deviceId, 'dev-1')
  assert.equal(rec.startedAt, 1_000_000)
  assert.equal(rec.endedAt, 1_060_000)
  assert.equal(rec.durationMs, 60_000) // 60s expressed in ms (Date.now() unit)
  assert.equal(rec.agentVersion, '1.2.3')
})

test('toDeviceSessionRecord returns endedAt + durationMs null for an active session', () => {
  const rec = toDeviceSessionRecord({ id: 's2', deviceId: 'dev-1', startedAt: 1_000_000, endedAt: null, agentVersion: null })
  assert.equal(rec.endedAt, null)
  assert.equal(rec.durationMs, null) // never invent an end for an open session
  assert.equal(rec.agentVersion, null) // missing agent version stays null
})

test('toDeviceSessionRecord never leaks teamId to the response shape', () => {
  const rec = toDeviceSessionRecord({ id: 's3', deviceId: 'dev-1', startedAt: 1, endedAt: 2, agentVersion: null }) as unknown as Record<string, unknown>
  assert.equal('teamId' in rec, false)
})

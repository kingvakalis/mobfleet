import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  HEARTBEAT_TIMEOUT_MS,
  isHeartbeatStale,
  mergeHeartbeat,
  staleHeartbeatDevices,
} from '../../src/shared/heartbeat'
import { heartbeatFrameSchema } from '../../src/shared/schemas'
import type { Device } from '../../src/shared/types'

const device = (over: Partial<Device> = {}): Device => ({
  id: 'ios-1',
  name: 'UNIT 1',
  status: 'online',
  region: 'us-east-1',
  osVersion: 'iOS 18.1.1',
  model: 'iPhone 14',
  proxy: '10.0.0.1',
  battery: 80,
  group: 'A',
  assignedUser: null,
  jobId: null,
  createdAt: 0,
  ...over,
})

// ── mergeHeartbeat ────────────────────────────────────────────────────────────

test('mergeHeartbeat stamps lastHeartbeat and overwrites only reported fields', () => {
  const d = device({ status: 'offline', battery: 50, cpuUsage: 10, memoryUsage: 20 })
  const next = mergeHeartbeat(d, { deviceId: d.id, status: 'online', battery: 73.6 }, 1000)
  assert.equal(next.lastHeartbeat, 1000)
  assert.equal(next.status, 'online')
  assert.equal(next.battery, 74) // rounded
  assert.equal(next.cpuUsage, 10) // untouched (not reported)
  assert.equal(next.memoryUsage, 20) // untouched
  assert.notEqual(next, d) // immutable — new object
})

test('mergeHeartbeat preserves status when the heartbeat omits it', () => {
  const d = device({ status: 'busy' })
  const next = mergeHeartbeat(d, { deviceId: d.id, cpuUsage: 42 }, 5)
  assert.equal(next.status, 'busy')
  assert.equal(next.cpuUsage, 42)
  assert.equal(next.lastHeartbeat, 5)
})

test('mergeHeartbeat clamps percentages into 0–100', () => {
  const d = device()
  const next = mergeHeartbeat(d, { deviceId: d.id, battery: 250, cpuUsage: -5, memoryUsage: 130 }, 1)
  assert.equal(next.battery, 100)
  assert.equal(next.cpuUsage, 0)
  assert.equal(next.memoryUsage, 100)
})

// ── isHeartbeatStale ──────────────────────────────────────────────────────────

test('isHeartbeatStale: null/undefined is always stale', () => {
  assert.equal(isHeartbeatStale(null, 1_000_000), true)
  assert.equal(isHeartbeatStale(undefined, 1_000_000), true)
})

test('isHeartbeatStale: fresh within the timeout, stale beyond it', () => {
  const now = 1_000_000
  assert.equal(isHeartbeatStale(now - 5_000, now), false)
  assert.equal(isHeartbeatStale(now - (HEARTBEAT_TIMEOUT_MS - 1), now), false)
  assert.equal(isHeartbeatStale(now - (HEARTBEAT_TIMEOUT_MS + 1), now), true)
})

// ── staleHeartbeatDevices (server sweep candidates) ───────────────────────────

test('staleHeartbeatDevices flips only agent-managed, non-offline, silent devices', () => {
  const now = 1_000_000
  const old = now - (HEARTBEAT_TIMEOUT_MS + 10_000)
  const devices: Device[] = [
    device({ id: 'fresh', status: 'online', lastHeartbeat: now - 1_000 }),
    device({ id: 'stale-online', status: 'online', lastHeartbeat: old }),
    device({ id: 'never', status: 'online', lastHeartbeat: null }), // never heartbeat → leave alone
    device({ id: 'already-off', status: 'offline', lastHeartbeat: old }), // already offline → skip
    device({ id: 'stale-busy', status: 'busy', lastHeartbeat: old }),
  ]
  const flipped = staleHeartbeatDevices(devices, now).map((d) => d.id).sort()
  assert.deepEqual(flipped, ['stale-busy', 'stale-online'])
})

// ── heartbeatFrameSchema (inbound validation) ─────────────────────────────────

test('heartbeatFrameSchema accepts a minimal and a full frame', () => {
  assert.equal(heartbeatFrameSchema.safeParse({ type: 'heartbeat', deviceId: 'ios-1' }).success, true)
  assert.equal(
    heartbeatFrameSchema.safeParse({
      type: 'heartbeat', deviceId: 'ios-1', status: 'online', battery: 90, cpuUsage: 12, memoryUsage: 44,
    }).success,
    true,
  )
})

test('heartbeatFrameSchema rejects bad frames', () => {
  assert.equal(heartbeatFrameSchema.safeParse({ type: 'snapshot', deviceId: 'x' }).success, false) // wrong type
  assert.equal(heartbeatFrameSchema.safeParse({ type: 'heartbeat' }).success, false) // missing deviceId
  assert.equal(heartbeatFrameSchema.safeParse({ type: 'heartbeat', deviceId: '' }).success, false) // empty id
  assert.equal(heartbeatFrameSchema.safeParse({ type: 'heartbeat', deviceId: 'x', status: 'dead' }).success, false) // bad status
  assert.equal(heartbeatFrameSchema.safeParse({ type: 'heartbeat', deviceId: 'x', battery: 150 }).success, false) // out of range
})

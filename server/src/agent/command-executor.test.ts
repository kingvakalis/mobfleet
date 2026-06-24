import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CommandExecutor, toAdapterCommand } from './command-executor'
import { SimulatedDeviceControlAdapter } from './simulated-device-adapter'
import type { AgentCommandFrame, DeviceIdentity } from './types'

const ID: DeviceIdentity = { udid: 'udid-1', name: 'iP', model: 'iPhone 15', osVersion: 'iOS 18.2', platform: 'ios' }

function frame(commandId: string, action: AgentCommandFrame['action'], payload?: unknown): AgentCommandFrame {
  return { type: 'command', commandId, deviceId: 'dev-1', action, payload, issuedAt: Date.now() }
}

async function ready(): Promise<SimulatedDeviceControlAdapter> {
  const a = new SimulatedDeviceControlAdapter()
  a.attach(ID)
  await a.startWda('udid-1', 8100)
  return a
}

// ── toAdapterCommand mapping + validation ───────────────────────────────────
test('toAdapterCommand maps every action and rejects malformed payloads', () => {
  assert.deepEqual(toAdapterCommand('screenshot', undefined), { kind: 'screenshot' })
  assert.deepEqual(toAdapterCommand('tap', { x: 5, y: 6 }), { kind: 'tap', x: 5, y: 6 })
  assert.equal(toAdapterCommand('tap', { x: 'a', y: 6 }), null)
  assert.deepEqual(toAdapterCommand('swipe', { dir: 'up' }), { kind: 'swipe', dir: 'up' })
  assert.deepEqual(toAdapterCommand('swipe', { dir: 'up', x1: 10, y1: 400, x2: 10, y2: 100, durationMs: 300 }), { kind: 'swipe', dir: 'up', x1: 10, y1: 400, x2: 10, y2: 100, durationMs: 300 })
  assert.deepEqual(toAdapterCommand('swipe', { dir: 'up', x1: 10, y1: 400 }), { kind: 'swipe', dir: 'up' }) // incomplete coord pair → directional fallback
  assert.equal(toAdapterCommand('swipe', { dir: 'sideways' }), null)
  assert.deepEqual(toAdapterCommand('type', { text: 'hi' }), { kind: 'type', text: 'hi' })
  assert.equal(toAdapterCommand('type', { text: '' }), null)
  assert.deepEqual(toAdapterCommand('launch', { appName: 'Safari' }), { kind: 'launch', appName: 'Safari' })
  assert.deepEqual(toAdapterCommand('launch', { bundleId: 'com.burbn.instagram' }), { kind: 'launch', bundleId: 'com.burbn.instagram' })
  assert.deepEqual(toAdapterCommand('launch', { bundleId: 'com.x.y', appName: 'X' }), { kind: 'launch', bundleId: 'com.x.y', appName: 'X' })
  assert.equal(toAdapterCommand('launch', {}), null)
  assert.deepEqual(toAdapterCommand('terminate', { bundleId: 'com.burbn.instagram' }), { kind: 'terminate', bundleId: 'com.burbn.instagram' })
  assert.equal(toAdapterCommand('terminate', {}), null)
  assert.deepEqual(toAdapterCommand('home', undefined), { kind: 'home' })
  assert.deepEqual(toAdapterCommand('reboot', undefined), { kind: 'reboot' })
})

// ── lifecycle: success + structured failure ─────────────────────────────────
test('execute returns success with timing for a healthy device', async () => {
  const ex = new CommandExecutor(await ready())
  const res = await ex.execute('udid-1', frame('c1', 'tap', { x: 1, y: 2 }))
  assert.equal(res.success, true)
  assert.equal(typeof res.startedAt, 'number')
  assert.equal(typeof res.completedAt, 'number')
  assert.ok((res.durationMs ?? -1) >= 0)
})

test('execute returns a retryable WDA_UNHEALTHY when WDA is down', async () => {
  const a = new SimulatedDeviceControlAdapter()
  a.attach(ID) // attached but WDA never started
  const ex = new CommandExecutor(a)
  const res = await ex.execute('udid-1', frame('c2', 'home'))
  assert.equal(res.success, false)
  assert.equal(res.error?.code, 'WDA_UNHEALTHY')
  assert.equal(res.error?.retryable, true)
})

test('execute returns a non-retryable BAD_PAYLOAD for a malformed command', async () => {
  const ex = new CommandExecutor(await ready())
  const res = await ex.execute('udid-1', frame('c3', 'tap', { x: 'nope', y: 2 }))
  assert.equal(res.success, false)
  assert.equal(res.error?.code, 'BAD_PAYLOAD')
  assert.equal(res.error?.retryable, false)
})

test('execute surfaces the adapter error code on a transient failure (retryable)', async () => {
  const a = await ready()
  a.failNextExecute(1, 'WDA_TIMEOUT')
  const ex = new CommandExecutor(a)
  const res = await ex.execute('udid-1', frame('c4', 'swipe', { dir: 'left' }))
  assert.equal(res.success, false)
  assert.equal(res.error?.code, 'WDA_TIMEOUT')
  assert.equal(res.error?.retryable, true)
})

// ── idempotency / dedup (the core safety property) ──────────────────────────
test('a re-delivered commandId is NOT executed twice (cached result returned)', async () => {
  const a = await ready()
  let calls = 0
  const orig = a.execute.bind(a)
  a.execute = (async (udid, cmd) => { calls++; return orig(udid, cmd) }) as typeof a.execute
  const ex = new CommandExecutor(a)
  const f = frame('dup-1', 'tap', { x: 3, y: 4 })
  const r1 = await ex.execute('udid-1', f)
  const r2 = await ex.execute('udid-1', f) // same commandId, re-delivered
  assert.equal(calls, 1, 'adapter.execute ran exactly once')
  assert.deepEqual(r1, r2, 'second delivery returns the cached result')
})

test('concurrent re-delivery awaits the same in-flight execution (single run)', async () => {
  const a = await ready()
  let calls = 0
  const orig = a.execute.bind(a)
  a.execute = (async (udid, cmd) => { calls++; await new Promise((r) => setTimeout(r, 5)); return orig(udid, cmd) }) as typeof a.execute
  const ex = new CommandExecutor(a)
  const f = frame('dup-2', 'home')
  const [r1, r2] = await Promise.all([ex.execute('udid-1', f), ex.execute('udid-1', f)])
  assert.equal(calls, 1, 'in-flight dedup → single execution')
  assert.deepEqual(r1, r2)
})

test('hasSeen tracks executed commands; prune evicts finished ones', async () => {
  const ex = new CommandExecutor(await ready())
  await ex.execute('udid-1', frame('seen-1', 'home'))
  assert.equal(ex.hasSeen('seen-1'), true)
  assert.equal(ex.hasSeen('never'), false)
  ex.prune(['seen-1'])
  assert.equal(ex.hasSeen('seen-1'), false)
})

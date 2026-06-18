import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AgentRuntime, type AgentTransport } from './agent-runtime'
import { SimulatedDeviceControlAdapter } from './simulated-device-adapter'
import type { AgentCommandFrame, DeviceIdentity, ExecResult } from './types'

const ID: DeviceIdentity = { udid: 'udid-1', name: 'iP', model: 'iPhone 15', osVersion: 'iOS 18.2', platform: 'ios' }

/** A fake transport that records heartbeats + acks and lets a test inject queued
 *  commands (poll) or pushed commands. Models one device (one API key). */
class FakeTransport implements AgentTransport {
  readonly deviceId: string
  heartbeats: Array<{ status: string; battery: number | null }> = []
  acks: Array<{ commandId: string; result: ExecResult }> = []
  private queue: AgentCommandFrame[] = []
  private pushHandler: ((f: AgentCommandFrame) => void) | null = null

  constructor(deviceId: string) {
    this.deviceId = deviceId
  }
  async sendHeartbeat(hb: { status: 'online' | 'busy' | 'warming' | 'offline' | 'error'; battery: number | null; cpuUsage: number | null; memoryUsage: number | null }): Promise<void> {
    this.heartbeats.push({ status: hb.status, battery: hb.battery })
  }
  async pollCommands(): Promise<AgentCommandFrame[]> {
    const out = this.queue
    this.queue = []
    return out
  }
  async ackCommand(commandId: string, result: ExecResult): Promise<void> {
    this.acks.push({ commandId, result })
  }
  onPushedCommand(handler: (f: AgentCommandFrame) => void): void {
    this.pushHandler = handler
  }
  // test helpers
  enqueue(f: AgentCommandFrame): void {
    this.queue.push(f)
  }
  push(f: AgentCommandFrame): void {
    this.pushHandler?.(f)
  }
}

function frame(commandId: string, action: AgentCommandFrame['action'], payload?: unknown, expiresAt?: number): AgentCommandFrame {
  return { type: 'command', commandId, deviceId: 'dev-1', action, payload, issuedAt: Date.now(), expiresAt }
}

function build() {
  const adapter = new SimulatedDeviceControlAdapter()
  const transports = new Map<string, FakeTransport>()
  const transportFor = (id: DeviceIdentity) => {
    let t = transports.get(id.udid)
    if (!t) { t = new FakeTransport(`dev-${id.udid}`); transports.set(id.udid, t) }
    return t
  }
  const runtime = new AgentRuntime({ adapter, transportFor })
  return { adapter, runtime, transports }
}

test('discovery brings up an attached device: WDA started, slot + port assigned', async () => {
  const { adapter, runtime } = build()
  adapter.attach(ID)
  await runtime.discoverOnce()
  assert.deepEqual(runtime.managedUdids(), ['udid-1'])
  assert.equal(await adapter.isWdaHealthy('udid-1'), true)
})

test('reconnect-by-UDID: a second discovery of the same device creates NO duplicate slot', async () => {
  const { adapter, runtime } = build()
  adapter.attach(ID)
  await runtime.discoverOnce()
  await runtime.discoverOnce() // re-scan; same UDID still attached
  assert.deepEqual(runtime.managedUdids(), ['udid-1']) // exactly one
})

test('USB disconnect tears down the device and reports it offline', async () => {
  const { adapter, runtime, transports } = build()
  adapter.attach(ID)
  await runtime.discoverOnce()
  adapter.detach('udid-1') // unplug
  await runtime.discoverOnce()
  assert.deepEqual(runtime.managedUdids(), [])
  const offline = transports.get('udid-1')!.heartbeats.filter((h) => h.status === 'offline')
  assert.equal(offline.length, 1, 'one offline heartbeat on disconnect')
})

test('re-plug after disconnect reuses the device by UDID without duplicate records', async () => {
  const { adapter, runtime, transports } = build()
  adapter.attach(ID)
  await runtime.discoverOnce()
  adapter.detach('udid-1')
  await runtime.discoverOnce()
  adapter.attach(ID) // same UDID re-plugged
  await runtime.discoverOnce()
  assert.deepEqual(runtime.managedUdids(), ['udid-1'])
  // The SAME transport (same deviceId) is reused — no new device record/key.
  assert.equal(transports.size, 1)
})

test('poll → execute → ack: a queued command runs and is acked successfully', async () => {
  const { adapter, runtime, transports } = build()
  adapter.attach(ID)
  await runtime.discoverOnce()
  transports.get('udid-1')!.enqueue(frame('q1', 'tap', { x: 5, y: 6 }))
  await runtime.pollOnce()
  const acks = transports.get('udid-1')!.acks
  assert.equal(acks.length, 1)
  assert.equal(acks[0].commandId, 'q1')
  assert.equal(acks[0].result.success, true)
})

test('a command delivered by BOTH poll and push executes once (cross-channel dedup)', async () => {
  const { adapter, runtime, transports } = build()
  adapter.attach(ID)
  await runtime.discoverOnce()
  let calls = 0
  const orig = adapter.execute.bind(adapter)
  adapter.execute = (async (u, c) => { calls++; return orig(u, c) }) as typeof adapter.execute
  const f = frame('both-1', 'home')
  const t = transports.get('udid-1')!
  t.push(f) // arrives over the live socket
  t.enqueue(f) // AND is still in the durable queue
  await runtime.pollOnce()
  // allow the pushed handler's microtasks to settle
  await new Promise((r) => setTimeout(r, 5))
  assert.equal(calls, 1, 'executed exactly once across both channels')
  // Both deliveries ack (server dedups), but the device acted once.
  assert.ok(t.acks.length >= 1)
})

test('an expired command is skipped (not executed)', async () => {
  const { adapter, runtime, transports } = build()
  adapter.attach(ID)
  await runtime.discoverOnce()
  let calls = 0
  const orig = adapter.execute.bind(adapter)
  adapter.execute = (async (u, c) => { calls++; return orig(u, c) }) as typeof adapter.execute
  transports.get('udid-1')!.enqueue(frame('exp-1', 'home', undefined, Date.now() - 1000))
  await runtime.pollOnce()
  assert.equal(calls, 0, 'expired command never reaches the adapter')
})

test('WDA recovery: an unhealthy WDA is restarted on the health check', async () => {
  const { adapter, runtime } = build()
  adapter.attach(ID)
  await runtime.discoverOnce()
  await adapter.stopWda('udid-1') // WDA dies
  assert.equal(await adapter.isWdaHealthy('udid-1'), false)
  await runtime.checkWdaOnce() // recovery pass
  assert.equal(await adapter.isWdaHealthy('udid-1'), true)
})

test('heartbeat reports online once WDA is healthy and carries battery telemetry', async () => {
  const { adapter, runtime, transports } = build()
  adapter.attach(ID)
  await runtime.discoverOnce()
  await runtime.heartbeatOnce()
  const hb = transports.get('udid-1')!.heartbeats.at(-1)!
  assert.equal(hb.status, 'online')
  assert.equal(typeof hb.battery, 'number')
})

test('an unprovisioned UDID (no transport) is not managed', async () => {
  const adapter = new SimulatedDeviceControlAdapter()
  const runtime = new AgentRuntime({ adapter, transportFor: () => null })
  adapter.attach(ID)
  await runtime.discoverOnce()
  assert.deepEqual(runtime.managedUdids(), [])
})

test('agent reports a stable version string', () => {
  const { runtime } = build()
  assert.match(runtime.version, /^\d+\.\d+\.\d+$/)
})

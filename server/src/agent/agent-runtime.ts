/**
 * The Mac-Mini hardware-agent runtime — the daemon that owns USB-attached
 * iPhones and bridges them to the control plane.
 *
 * Responsibilities (all testable against the simulated adapter + a fake transport):
 *   - USB discovery: poll listAttachedUdids(); attach NEW devices, detach gone ones.
 *   - Stable identity: read model/iOS/name once per UDID; reconnect-by-UDID reuses
 *     the SAME device record (no duplicate device/session on re-plug or restart).
 *   - WDA lifecycle: allocate a dynamic port per device, start WDA, verify health,
 *     and RECOVER (restart) WDA when it goes unhealthy.
 *   - Heartbeat: emit telemetry on the configured interval; the server flips a
 *     silent device offline (staleness sweep).
 *   - Commands: drain the durable queue (poll) AND accept pushed frames, execute
 *     them idempotently (CommandExecutor dedup), and ACK results.
 *   - Reconnect: the transport reconnects on drop; a re-auth opens a fresh
 *     DeviceSession, but the device is keyed by UDID so no duplicate records form.
 *
 * Transport is injected (AgentTransport) so the network is mocked in tests; the
 * real transport (HTTP poll + WS) lives in agent-transport.ts.
 */
import type { DeviceControlAdapter } from './device-adapter'
import { WdaPortAllocator } from './wda-port-allocator'
import { CommandExecutor } from './command-executor'
import { AGENT_VERSION } from './types'
import type { AgentCommandFrame, DeviceIdentity, ExecResult, ManagedDevice } from './types'

/** The control-plane transport the agent talks to, for ONE device (one API key).
 *  A multi-device Mac Mini holds one transport per managed device (one key each). */
export interface AgentTransport {
  /** The device id this transport's API key resolves to (set after claim/config). */
  readonly deviceId: string
  /** Send one heartbeat for this device. */
  sendHeartbeat(hb: {
    status: 'online' | 'busy' | 'warming' | 'offline' | 'error'
    battery: number | null
    cpuUsage: number | null
    memoryUsage: number | null
  }): Promise<void>
  /** Drain undelivered commands from the durable queue (HTTP poll). */
  pollCommands(): Promise<AgentCommandFrame[]>
  /** Report a command result (ACK). Idempotent server-side. */
  ackCommand(commandId: string, result: ExecResult): Promise<void>
  /** Register a handler for commands PUSHED over the live socket (optional —
   *  poll alone is sufficient; push is the low-latency fast path). */
  onPushedCommand?(handler: (frame: AgentCommandFrame) => void): void
  /** Ack-start (optional): mark a command 'running' before execution, so the
   *  control plane shows pending → running → done. supabase-mode implements it. */
  markRunning?(commandId: string): Promise<void>
}

export interface AgentRuntimeOptions {
  adapter: DeviceControlAdapter
  /** Resolve a transport for a discovered device. The agent maps a physical UDID
   *  to its provisioned deviceId + API key here (config or a pairing claim). */
  transportFor: (identity: DeviceIdentity) => AgentTransport | null
  discoveryIntervalMs?: number
  heartbeatIntervalMs?: number
  /** How often to re-check WDA health + recover it. */
  wdaCheckIntervalMs?: number
  log?: (event: string, fields?: Record<string, unknown>) => void
}

interface Slot {
  managed: ManagedDevice
  transport: AgentTransport
  executor: CommandExecutor
}

export class AgentRuntime {
  private readonly adapter: DeviceControlAdapter
  private readonly ports = new WdaPortAllocator()
  private readonly slots = new Map<string, Slot>() // keyed by UDID (stable identity)
  private readonly opts: Required<Omit<AgentRuntimeOptions, 'adapter' | 'transportFor' | 'log'>>
  private readonly transportFor: AgentRuntimeOptions['transportFor']
  private readonly log: NonNullable<AgentRuntimeOptions['log']>
  private timers: Array<ReturnType<typeof setInterval>> = []

  constructor(o: AgentRuntimeOptions) {
    this.adapter = o.adapter
    this.transportFor = o.transportFor
    this.log = o.log ?? (() => {})
    this.opts = {
      discoveryIntervalMs: o.discoveryIntervalMs ?? 5_000,
      heartbeatIntervalMs: o.heartbeatIntervalMs ?? 10_000,
      wdaCheckIntervalMs: o.wdaCheckIntervalMs ?? 15_000,
    }
  }

  /** The version this agent reports (DeviceSession.agentVersion). */
  get version(): string {
    return AGENT_VERSION
  }

  /** UDIDs currently managed (for tests/diagnostics). */
  managedUdids(): string[] {
    return [...this.slots.keys()]
  }

  /**
   * One discovery pass: reconcile the managed set with what's attached over USB.
   * - A newly attached UDID is brought up (identity → port → WDA → slot).
   * - A UDID that vanished is torn down (WDA stopped, port released, slot dropped).
   * Reconnect-by-UDID: a re-plugged device with a UDID we already manage is left
   * as-is (no duplicate slot/session) — WDA health recovery handles its WDA.
   */
  async discoverOnce(): Promise<void> {
    let attached: string[]
    try {
      attached = await this.adapter.listAttachedUdids()
    } catch (err) {
      this.log('agent.discovery.error', { error: errMsg(err) })
      return
    }
    const attachedSet = new Set(attached)

    // Bring up new devices.
    for (const udid of attached) {
      if (this.slots.has(udid)) continue // already managed → reconnect-by-UDID no-op
      await this.bringUp(udid)
    }
    // Tear down devices that disappeared (USB disconnect → offline).
    for (const udid of [...this.slots.keys()]) {
      if (!attachedSet.has(udid)) await this.tearDown(udid)
    }
  }

  private async bringUp(udid: string): Promise<void> {
    let identity: DeviceIdentity
    try {
      identity = await this.adapter.getIdentity(udid)
    } catch (err) {
      this.log('agent.identity.error', { udid, error: errMsg(err) })
      return
    }
    const transport = this.transportFor(identity)
    if (!transport) {
      this.log('agent.unprovisioned', { udid }) // no API key for this UDID yet
      return
    }
    const port = this.ports.allocate(udid)
    let wdaReady = false
    try {
      await this.adapter.startWda(udid, port)
      wdaReady = await this.adapter.isWdaHealthy(udid)
    } catch (err) {
      this.log('agent.wda.start_error', { udid, port, error: errMsg(err) })
    }
    this.slots.set(udid, {
      managed: { identity, wdaPort: port, wdaReady },
      transport,
      executor: new CommandExecutor(this.adapter),
    })
    // Wire push delivery for this device's transport (if supported).
    transport.onPushedCommand?.((frame) => void this.handleCommand(udid, frame))
    this.log('agent.device.up', { udid, deviceId: transport.deviceId, port, wdaReady, agentVersion: this.version })
  }

  private async tearDown(udid: string): Promise<void> {
    await this.adapter.stopWda(udid).catch(() => {})
    this.ports.release(udid)
    const slot = this.slots.get(udid)
    this.slots.delete(udid)
    if (slot) {
      // USB disconnect → report the device offline so the dashboard updates
      // immediately rather than waiting on the staleness sweep.
      await slot.transport
        .sendHeartbeat({ status: 'offline', battery: null, cpuUsage: null, memoryUsage: null })
        .catch(() => {})
    }
    this.log('agent.device.down', { udid })
  }

  /** Re-check + recover WDA for every managed device. */
  async checkWdaOnce(): Promise<void> {
    for (const [udid, slot] of this.slots) {
      let healthy: boolean
      try {
        healthy = await this.adapter.isWdaHealthy(udid)
      } catch {
        healthy = false
      }
      if (!healthy) {
        try {
          await this.adapter.startWda(udid, slot.managed.wdaPort) // recover
          healthy = await this.adapter.isWdaHealthy(udid)
          this.log('agent.wda.recovered', { udid, port: slot.managed.wdaPort, healthy })
        } catch (err) {
          this.log('agent.wda.recover_error', { udid, error: errMsg(err) })
        }
      }
      slot.managed.wdaReady = healthy
    }
  }

  /** One heartbeat pass for every managed device. */
  async heartbeatOnce(): Promise<void> {
    for (const [udid, slot] of this.slots) {
      let tel = { battery: null as number | null, cpuUsage: null as number | null, memoryUsage: null as number | null }
      try {
        tel = await this.adapter.getTelemetry(udid)
      } catch {
        /* telemetry best-effort */
      }
      await slot.transport
        .sendHeartbeat({ status: slot.managed.wdaReady ? 'online' : 'warming', ...tel })
        .catch((err) => this.log('agent.heartbeat.error', { udid, error: errMsg(err) }))
    }
  }

  /** One poll pass: drain + execute the durable queue for every managed device. */
  async pollOnce(): Promise<void> {
    for (const [udid, slot] of this.slots) {
      let frames: AgentCommandFrame[]
      try {
        frames = await slot.transport.pollCommands()
      } catch (err) {
        this.log('agent.poll.error', { udid, error: errMsg(err) })
        continue
      }
      for (const frame of frames) await this.handleCommand(udid, frame)
    }
  }

  /**
   * Execute one command (from poll OR push) and ACK it. Deduped by commandId in
   * the per-device executor, so the same command arriving on both channels — or
   * re-delivered after a restart — runs exactly once. ACK is always sent (even
   * for a deduped re-run, returning the cached result) so the server can mark the
   * row terminal; the server's own ackCommand dedup makes a second ACK a no-op.
   */
  async handleCommand(udid: string, frame: AgentCommandFrame): Promise<void> {
    const slot = this.slots.get(udid)
    if (!slot) return
    if (frame.expiresAt && frame.expiresAt <= Date.now()) {
      this.log('agent.command.expired', { udid, commandId: frame.commandId })
      return // the server's reaper will fail it; don't execute a stale command
    }
    // Ack-start (optional): surface the command as running before we execute it.
    await slot.transport.markRunning?.(frame.commandId).catch((err) => this.log('agent.markrunning.error', { udid, commandId: frame.commandId, error: errMsg(err) }))
    let result: ExecResult
    try {
      result = await slot.executor.execute(udid, frame)
    } catch (err) {
      // Defensive: execute() already maps errors to a result, but never let a
      // throw escape the loop. Treat as a generic, retryable failure.
      result = { success: false, error: { code: 'AGENT_ERROR', message: errMsg(err), retryable: true } }
    }
    await slot.transport
      .ackCommand(frame.commandId, result)
      .catch((err) => this.log('agent.ack.error', { udid, commandId: frame.commandId, error: errMsg(err) }))
  }

  /** Start the periodic loops. Returns a stop() that clears them + tears down WDA. */
  start(): () => Promise<void> {
    const wrap = (fn: () => Promise<void>, name: string) => () =>
      void fn().catch((err) => this.log(`agent.${name}.loop_error`, { error: errMsg(err) }))
    // Kick discovery immediately so devices come up without waiting a full interval.
    void this.discoverOnce()
    this.timers.push(setInterval(wrap(() => this.discoverOnce(), 'discovery'), this.opts.discoveryIntervalMs))
    this.timers.push(setInterval(wrap(() => this.checkWdaOnce(), 'wda'), this.opts.wdaCheckIntervalMs))
    this.timers.push(setInterval(wrap(() => this.heartbeatOnce(), 'heartbeat'), this.opts.heartbeatIntervalMs))
    this.timers.push(setInterval(wrap(() => this.pollOnce(), 'poll'), this.opts.heartbeatIntervalMs))
    for (const t of this.timers) if (typeof t.unref === 'function') t.unref()
    this.log('agent.started', { version: this.version })
    return async () => {
      for (const t of this.timers) clearInterval(t)
      this.timers = []
      for (const udid of [...this.slots.keys()]) await this.tearDown(udid)
    }
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : 'error'
}

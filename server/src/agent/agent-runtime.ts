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
import { SUPPORTED_APPS, SUPPORTED_BUNDLE_IDS, appSource } from '../../../src/shared/supported-apps'
import { compressFrame, compressionConfigFromEnv, compressionForQualityLevel, type FrameCompressionConfig } from './frame-compress'

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
  /** Upload a REAL captured screenshot frame for a command (optional). supabase-mode
   *  implements it (device-key RPC → device_screenshots) so the dashboard renders the
   *  actual device screen; me-mode has no counterpart and simply skips it. */
  putScreenshot?(commandId: string | null, frame: ScreenshotFrame): Promise<void>
  /** Upload the device's detected installed-app inventory (optional). supabase-mode
   *  implements it (device-key RPC → device_apps); me-mode skips it. */
  putApps?(apps: DetectedApp[]): Promise<void>
}

/** A captured device screenshot ready for transport. `width`/`height` are the device
 *  LOGICAL size (points) so the UI can map a tap on the displayed frame to device coords. */
export interface ScreenshotFrame {
  base64: string
  format: string
  width: number | null
  height: number | null
}

/** One detected installed-app row the agent uploads (mirrors put_device_apps args). */
export interface DetectedApp {
  bundle_id: string
  name: string
  abbr: string | null
  icon_color: string | null
  installed: boolean
  source: string
}

/** Pull a real screenshot frame out of a command's ExecResult (screenshot success
 *  with bytes only). Returns null when there is nothing to transport — e.g. a
 *  non-screenshot action, a failure, or the simulated adapter (no real bytes).
 *  PURE + exported for unit testing. */
export function extractScreenshotFrame(action: AgentCommandFrame['action'], result: ExecResult): ScreenshotFrame | null {
  if (action !== 'screenshot' || !result.success) return null
  const r = result.result
  if (!r || typeof r !== 'object') return null
  const s = (r as { screenshot?: unknown }).screenshot
  if (!s || typeof s !== 'object') return null
  const o = s as { base64?: unknown; format?: unknown; width?: unknown; height?: unknown }
  if (typeof o.base64 !== 'string' || o.base64.length === 0) return null
  const dim = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) ? n : null)
  return { base64: o.base64, format: typeof o.format === 'string' ? o.format : 'png', width: dim(o.width), height: dim(o.height) }
}

/** Return a copy of the result with screenshot BYTES removed (format/dims kept), so an
 *  ACK never carries the (multi-MB) base64 — the frame travels via putScreenshot instead.
 *  PURE + exported for unit testing. */
export function stripScreenshotBytes(result: ExecResult): ExecResult {
  const r = result.result
  if (!r || typeof r !== 'object') return result
  const s = (r as { screenshot?: unknown }).screenshot
  if (!s || typeof s !== 'object' || typeof (s as { base64?: unknown }).base64 !== 'string') return result
  const rest = { ...(s as Record<string, unknown>) }
  delete rest.base64
  return { ...result, result: { ...(r as Record<string, unknown>), screenshot: rest } }
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
  /** How often to drain the command queue. Default 1000ms — taps/Home/swipes/screenshots reach WDA
   *  promptly WITHOUT hammering Supabase. Configurable via COMMAND_POLL_INTERVAL_MS. */
  commandPollIntervalMs?: number
  /** Live-frame compression (width/quality/format); defaults from env. */
  frameCompression?: FrameCompressionConfig
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
      commandPollIntervalMs: o.commandPollIntervalMs ?? 1_000,
      frameCompression: o.frameCompression ?? compressionConfigFromEnv(process.env),
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
    // Detect the installed-app inventory once the device is up (best-effort, async).
    if (wdaReady) void this.refreshApps(udid)
  }

  /** Probe the supported catalog on a device → inventory rows (installed true/false). */
  private async detectApps(udid: string): Promise<DetectedApp[]> {
    const states = await this.adapter.queryInstalledApps(udid, [...SUPPORTED_BUNDLE_IDS])
    const installed = new Map(states.map((s) => [s.bundleId, s.installed]))
    return SUPPORTED_APPS.map((a) => ({
      bundle_id: a.bundleId, name: a.name, abbr: a.abbr, icon_color: a.color,
      installed: installed.get(a.bundleId) ?? false, source: appSource(a.bundleId),
    }))
  }

  /** Detect installed apps + upload the inventory for one device (best-effort). */
  async refreshApps(udid: string): Promise<void> {
    const slot = this.slots.get(udid)
    if (!slot || !slot.transport.putApps) return
    try {
      const apps = await this.detectApps(udid)
      await slot.transport.putApps(apps)
      this.log('agent.apps.detected', { udid, installed: apps.filter((a) => a.installed).length, total: apps.length })
    } catch (err) {
      this.log('agent.apps.detect_error', { udid, error: errMsg(err) })
    }
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
    // App-inventory refresh is a META-command (not a device gesture): detect installed
    // apps + upload the inventory, then ACK truthfully (running → done/failed).
    if (frame.action === 'refresh_apps') {
      await slot.transport.markRunning?.(frame.commandId).catch((err) => this.log('agent.markrunning.error', { udid, commandId: frame.commandId, error: errMsg(err) }))
      let result: ExecResult
      try {
        if (!slot.transport.putApps) throw Object.assign(new Error('app inventory not supported by this transport'), { code: 'APPS_UNSUPPORTED' })
        if (!(await this.adapter.isWdaHealthy(udid))) throw Object.assign(new Error('WebDriverAgent is not healthy for this device'), { code: 'WDA_UNHEALTHY' })
        await slot.transport.putApps(await this.detectApps(udid))
        result = { success: true }
      } catch (err) {
        const code = (err as { code?: string }).code
        result = { success: false, error: { code: typeof code === 'string' ? code : 'REFRESH_FAILED', message: errMsg(err), retryable: true } }
      }
      await slot.transport.ackCommand(frame.commandId, result).catch((err) => this.log('agent.ack.error', { udid, commandId: frame.commandId, error: errMsg(err) }))
      return
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
    // Live-frame transport (supabase-mode): upload captured screenshot BYTES, then ACK
    // a copy with the bytes stripped so the ack stays small. Best-effort — an upload
    // failure never blocks the ack (the command still completed on the device).
    const shot = extractScreenshotFrame(frame.action, result)
    if (shot && slot.transport.putScreenshot) {
      // Per-command QUALITY: a screenshot command may carry a 0–30 level (the dashboard's Quality
      // slider). Apply it to THIS frame's encode; absent → the agent's startup (env) config.
      const pl = (frame.payload ?? {}) as Record<string, unknown>
      const level = typeof pl.quality === 'number' ? pl.quality : undefined
      const small = await compressFrame(shot, compressionForQualityLevel(level, this.opts.frameCompression))
      await slot.transport
        .putScreenshot(frame.commandId, small)
        .catch((err) => this.log('agent.screenshot.upload_error', { udid, commandId: frame.commandId, error: errMsg(err) }))
    }
    await slot.transport
      .ackCommand(frame.commandId, shot ? stripScreenshotBytes(result) : result)
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
    this.timers.push(setInterval(wrap(() => this.pollOnce(), 'poll'), this.opts.commandPollIntervalMs))
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

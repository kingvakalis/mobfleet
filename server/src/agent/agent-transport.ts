/**
 * Real control-plane transport for ONE managed device (one DeviceApiKey).
 *
 *   - Heartbeat + command push: a WebSocket at /ws?deviceKey=… (the existing
 *     device-agent socket — see ws.ts registerDeviceSocket). Heartbeats go up as
 *     {type:'heartbeat',…}; command results go up as {type:'command_result',…};
 *     pushed commands arrive as {type:'command',…}. The socket auto-reconnects.
 *   - Command poll: GET /v1/agent/command/queue/:deviceId with Bearer deviceKey
 *     (the durable safety net when the socket is briefly down).
 *   - ACK: POST /v1/agent/command/:commandId/ack with Bearer deviceKey (carries
 *     the canonical CommandResultBody; the WS result frame is the fast path, the
 *     server dedups the two).
 *
 * This file does real network I/O, so it is NOT imported by unit tests; the
 * runtime is tested with a fake AgentTransport. It implements the same interface.
 */
import WebSocket from 'ws'
import type { AgentTransport } from './agent-runtime'
import type { AgentCommandFrame, ExecResult } from './types'
import { agentCommandActionSchema } from '../../../src/shared/schemas'

export interface AgentTransportConfig {
  serverUrl: string // https://api…
  wsUrl: string // wss://api…/ws
  deviceId: string
  deviceKey: string
  log?: (event: string, fields?: Record<string, unknown>) => void
}

export class HttpWsAgentTransport implements AgentTransport {
  readonly deviceId: string
  private readonly cfg: AgentTransportConfig
  private readonly log: NonNullable<AgentTransportConfig['log']>
  private ws: WebSocket | null = null
  private pushHandler: ((frame: AgentCommandFrame) => void) | null = null
  private closed = false

  constructor(cfg: AgentTransportConfig) {
    this.cfg = cfg
    this.deviceId = cfg.deviceId
    this.log = cfg.log ?? (() => {})
    this.connect()
  }

  /** Open (and keep open) the device-key WebSocket; reconnect on drop. A fresh
   *  connection re-authenticates → the server opens a new DeviceSession, but the
   *  device is keyed by UDID/deviceId so no duplicate device record forms. */
  private connect(): void {
    if (this.closed) return
    const url = `${this.cfg.wsUrl}?deviceKey=${encodeURIComponent(this.cfg.deviceKey)}`
    const ws = new WebSocket(url)
    this.ws = ws
    ws.on('open', () => this.log('transport.ws.open', { deviceId: this.deviceId }))
    ws.on('message', (raw: Buffer) => this.onMessage(raw))
    ws.on('close', () => {
      this.log('transport.ws.close', { deviceId: this.deviceId })
      if (!this.closed) setTimeout(() => this.connect(), 1000) // reconnect
    })
    ws.on('error', (e) => this.log('transport.ws.error', { deviceId: this.deviceId, error: e.message }))
  }

  private onMessage(raw: Buffer): void {
    let msg: { type?: string; commandId?: string; deviceId?: string; action?: string; payload?: unknown; issuedAt?: number; expiresAt?: number }
    try {
      msg = JSON.parse(raw.toString('utf8'))
    } catch {
      return
    }
    if (msg.type !== 'command' || !msg.commandId || !this.pushHandler) return
    const action = agentCommandActionSchema.safeParse(msg.action)
    if (!action.success) return
    this.pushHandler({
      type: 'command',
      commandId: msg.commandId,
      deviceId: this.deviceId,
      action: action.data,
      payload: msg.payload,
      issuedAt: msg.issuedAt ?? Date.now(),
      expiresAt: msg.expiresAt,
    })
  }

  onPushedCommand(handler: (frame: AgentCommandFrame) => void): void {
    this.pushHandler = handler
  }

  async sendHeartbeat(hb: {
    status: 'online' | 'busy' | 'warming' | 'offline' | 'error'
    battery: number | null
    cpuUsage: number | null
    memoryUsage: number | null
  }): Promise<void> {
    const ws = this.ws
    if (!ws || ws.readyState !== ws.OPEN) return // dropped silently; staleness sweep covers it
    ws.send(JSON.stringify({
      type: 'heartbeat',
      deviceId: this.deviceId,
      status: hb.status,
      ...(hb.battery !== null ? { battery: hb.battery } : {}),
      ...(hb.cpuUsage !== null ? { cpuUsage: hb.cpuUsage } : {}),
      ...(hb.memoryUsage !== null ? { memoryUsage: hb.memoryUsage } : {}),
    }))
  }

  async pollCommands(): Promise<AgentCommandFrame[]> {
    const res = await fetch(`${this.cfg.serverUrl}/v1/agent/command/queue/${encodeURIComponent(this.deviceId)}`, {
      headers: { Authorization: `Bearer ${this.cfg.deviceKey}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`poll failed: HTTP ${res.status}`)
    const body = (await res.json()) as { commands?: AgentCommandFrame[] }
    return body.commands ?? []
  }

  async ackCommand(commandId: string, result: ExecResult): Promise<void> {
    // Prefer the WS result frame (fast path); always also POST the HTTP ack so a
    // dropped socket can't strand the command. The server dedups the two.
    const ws = this.ws
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'command_result', commandId, deviceId: this.deviceId, ...result }))
    }
    const res = await fetch(`${this.cfg.serverUrl}/v1/agent/command/${encodeURIComponent(commandId)}/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cfg.deviceKey}` },
      body: JSON.stringify({ status: result.success ? 'acked' : 'failed', error: result.error?.message }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok && res.status !== 404) throw new Error(`ack failed: HTTP ${res.status}`)
  }

  close(): void {
    this.closed = true
    this.ws?.close()
  }
}

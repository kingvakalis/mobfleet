/**
 * Supabase control-plane transport for ONE managed device — the supabase-mode path
 * (VITE_AUTH_SOURCE=supabase). The agent talks ONLY to Supabase, with the public ANON
 * key as the apikey and the per-device KEY passed as an RPC argument (NEVER a service-role
 * key, never a JWT). All access goes through the SECURITY DEFINER RPCs from the
 * agent_command_channel / agent_device_runtime migrations:
 *   poll      → claim_device_commands(p_device_key)        (drain + mark delivered)
 *   start     → start_agent_command(p_device_key, id)      (ack-start → 'running')
 *   ack       → ack_agent_command(p_device_key, id, ok, e) (success/failure)
 *   heartbeat → device_session_start / device_heartbeat / device_session_end
 *
 * Poll-only (no WS push). Realtime push is a future add (RLS on the anon role makes
 * device-key Realtime non-trivial); polling is the durable path. fetch is injectable
 * so the lifecycle is unit-tested without a network.
 */
import type { AgentTransport, ScreenshotFrame } from './agent-runtime'
import type { AgentCommandFrame, ExecResult } from './types'
import { agentCommandActionSchema } from '../../../src/shared/schemas'

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

export interface SupabaseTransportConfig {
  supabaseUrl: string
  supabaseAnonKey: string
  deviceId: string
  deviceKey: string
  agentVersion?: string
  log?: (event: string, fields?: Record<string, unknown>) => void
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: FetchLike
}

/** Build the RPC URL + headers + body for a Supabase SECURITY DEFINER RPC (anon key auth). */
export function rpcRequest(baseUrl: string, anonKey: string, fn: string, args: Record<string, unknown>) {
  return {
    url: `${baseUrl.replace(/\/+$/, '')}/rest/v1/rpc/${fn}`,
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  }
}

/** Map a claimed agent_commands row → the runtime's AgentCommandFrame (validates action). */
export function rowToFrame(row: Record<string, unknown>, deviceId: string): AgentCommandFrame | null {
  const action = agentCommandActionSchema.safeParse(row.action)
  if (!action.success || typeof row.id !== 'string') return null
  const created = typeof row.created_at === 'string' ? Date.parse(row.created_at) : NaN
  return {
    type: 'command',
    commandId: row.id,
    deviceId,
    action: action.data,
    payload: row.payload,
    issuedAt: Number.isFinite(created) ? created : Date.now(),
    expiresAt: undefined,
  }
}

export class SupabaseAgentTransport implements AgentTransport {
  readonly deviceId: string
  private readonly cfg: SupabaseTransportConfig
  private readonly fetchImpl: FetchLike
  private readonly log: NonNullable<SupabaseTransportConfig['log']>
  private sessionId: string | null = null

  constructor(cfg: SupabaseTransportConfig) {
    this.cfg = cfg
    this.deviceId = cfg.deviceId
    this.fetchImpl = cfg.fetchImpl ?? (globalThis.fetch as unknown as FetchLike)
    this.log = cfg.log ?? (() => {})
  }

  /** One-shot device claim: redeem a pairing token → { deviceId, deviceKey, teamId }.
   *  Used to provision a device before constructing a transport for it. */
  static async claimDevice(o: { supabaseUrl: string; supabaseAnonKey: string; pairingToken: string; udid: string; name?: string; model?: string; os?: string; fetchImpl?: FetchLike }): Promise<{ deviceId: string; deviceKey: string; teamId: string }> {
    const f = o.fetchImpl ?? (globalThis.fetch as unknown as FetchLike)
    const r = rpcRequest(o.supabaseUrl, o.supabaseAnonKey, 'claim_device', { p_token: o.pairingToken, p_udid: o.udid, p_name: o.name ?? null, p_model: o.model ?? null, p_os: o.os ?? null })
    const res = await f(r.url, { method: 'POST', headers: r.headers, body: r.body, signal: AbortSignal.timeout(15_000) })
    const text = await res.text()
    if (!res.ok) throw new Error(`claim_device failed: HTTP ${res.status} ${text.slice(0, 120)}`)
    const v = JSON.parse(text) as { device_id: string; device_key: string; team_id: string }
    return { deviceId: v.device_id, deviceKey: v.device_key, teamId: v.team_id }
  }

  private async rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
    const r = rpcRequest(this.cfg.supabaseUrl, this.cfg.supabaseAnonKey, fn, { p_device_key: this.cfg.deviceKey, ...args })
    const res = await this.fetchImpl(r.url, { method: 'POST', headers: r.headers, body: r.body, signal: AbortSignal.timeout(15_000) })
    const text = await res.text()
    let json: unknown = null
    try { json = text ? JSON.parse(text) : null } catch { json = text }
    if (!res.ok) {
      const msg = json && typeof json === 'object' && 'message' in json ? (json as { message?: string }).message : `HTTP ${res.status}`
      throw new Error(`supabase rpc ${fn} → ${msg}`)
    }
    return json
  }

  async pollCommands(): Promise<AgentCommandFrame[]> {
    const rows = (await this.rpc('claim_device_commands', {})) as Array<Record<string, unknown>> | null
    if (!Array.isArray(rows)) return []
    return rows.map((r) => rowToFrame(r, this.deviceId)).filter((f): f is AgentCommandFrame => f !== null)
  }

  /** Ack-start: mark the command 'running' before execution (best-effort). */
  async markRunning(commandId: string): Promise<void> {
    await this.rpc('start_agent_command', { p_command_id: commandId })
  }

  async ackCommand(commandId: string, result: ExecResult): Promise<void> {
    await this.rpc('ack_agent_command', { p_command_id: commandId, p_success: result.success, p_error: result.error?.message ?? null })
  }

  /** Upload a captured screenshot frame (device-key RPC → device_screenshots). The
   *  compressed image bytes ride the RPC body; the dashboard reads the row over RLS.
   *  `commandId` is null for continuous-capture frames (not tied to a queued command). */
  async putScreenshot(commandId: string | null, frame: ScreenshotFrame): Promise<void> {
    await this.rpc('put_device_screenshot', {
      p_command_id: commandId,
      p_image_base64: frame.base64,
      p_format: frame.format,
      p_width: frame.width,
      p_height: frame.height,
    })
  }

  async sendHeartbeat(hb: { status: 'online' | 'busy' | 'warming' | 'offline' | 'error'; battery: number | null; cpuUsage: number | null; memoryUsage: number | null }): Promise<void> {
    if (hb.status === 'offline') {
      if (this.sessionId) { await this.rpc('device_session_end', { p_session_id: this.sessionId }).catch((e) => this.log('transport.session_end.error', { error: errMsg(e) })); this.sessionId = null }
      return
    }
    if (!this.sessionId) {
      const sid = (await this.rpc('device_session_start', { p_agent_version: this.cfg.agentVersion ?? null })) as string | null
      this.sessionId = typeof sid === 'string' ? sid : null
    }
    await this.rpc('device_heartbeat', { p_session_id: this.sessionId, p_status: hb.status, p_battery: hb.battery, p_cpu: hb.cpuUsage, p_mem: hb.memoryUsage })
  }
}

function errMsg(e: unknown): string { return e instanceof Error ? e.message : 'error' }

/**
 * Supabase-mode device command service. In VITE_AUTH_SOURCE=supabase the phone-control
 * UI enqueues + tracks commands here (against the agent_command_channel / agent_device_runtime
 * Supabase tables via RLS) instead of POST /v1/agent/command on the Railway backend — so device
 * control works for the live supabase-mode workspace, no me-mode.
 *
 * Enqueue + read go through normal Supabase auth + RLS (the signed-in operator). The AGENT
 * side (claim/poll/ack) is the device-key RPC path (server/src/agent/supabase-agent-transport).
 * No service-role key anywhere. Truthful states only — status reflects the real row.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { AgentCommandAction } from '@/shared/types'

export interface EnqueuedCommand { id: string; status: CommandStatus }
export type CommandStatus = 'pending' | 'delivered' | 'running' | 'acked' | 'failed' | 'expired'
export interface CommandRow { id: string; action: string; status: CommandStatus; error: string | null; created_at: string }

// agent_commands / device_pairing_tokens were added after database.types.ts was last hand-synced
// with the schema, so use an untyped client for these specific calls (results typed locally).
const sb = (): SupabaseClient => {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase as unknown as SupabaseClient
}

/** Queue a command for a device (RLS: writer + device in the active team). */
export async function enqueueCommand(o: { teamId: string; deviceId: string; action: AgentCommandAction; payload?: Record<string, unknown>; userId: string }): Promise<EnqueuedCommand> {
  const { data, error } = await sb()
    .from('agent_commands')
    .insert({ team_id: o.teamId, device_id: o.deviceId, action: o.action, payload: o.payload ?? {}, issued_by: o.userId })
    .select('id,status')
    .single()
  if (error) throw new Error(error.message)
  return data as EnqueuedCommand
}

/** One command's current row (for status polling). Returns null if not visible. */
export async function getCommand(id: string): Promise<CommandRow | null> {
  if (!supabase) return null
  const { data } = await sb().from('agent_commands').select('id,action,status,error,created_at').eq('id', id).single()
  return (data as CommandRow) ?? null
}

/** Recent commands for a device (newest first) — the live status feed. */
export async function listCommands(deviceId: string, limit = 50): Promise<CommandRow[]> {
  const { data, error } = await sb().from('agent_commands').select('id,action,status,error,created_at').eq('device_id', deviceId).order('created_at', { ascending: false }).limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as CommandRow[]
}

/** The latest agent session for a device (real telemetry source: battery + session
 *  uptime). `endedAt === null` means the agent is currently connected. Returns null
 *  when no agent has ever connected (RLS: team member). Reads device_sessions only —
 *  no schema change, no /v1. */
export interface DeviceSessionInfo { battery: number | null; cpuUsage: number | null; memoryUsage: number | null; startedAt: string; endedAt: string | null; lastHeartbeatAt: string; agentVersion: string | null }
export async function getLatestSession(deviceId: string): Promise<DeviceSessionInfo | null> {
  if (!supabase) return null
  const { data, error } = await sb()
    .from('device_sessions')
    .select('battery,cpu_usage,memory_usage,started_at,ended_at,last_heartbeat_at,agent_version')
    .eq('device_id', deviceId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const r = data as { battery: number | null; cpu_usage: number | null; memory_usage: number | null; started_at: string; ended_at: string | null; last_heartbeat_at: string; agent_version: string | null }
  return { battery: r.battery, cpuUsage: r.cpu_usage, memoryUsage: r.memory_usage, startedAt: r.started_at, endedAt: r.ended_at, lastHeartbeatAt: r.last_heartbeat_at, agentVersion: r.agent_version }
}

/** The latest REAL screenshot frame the agent captured for a device. `width`/`height`
 *  are the device LOGICAL size (points), used to map a tap on the displayed frame to
 *  device coordinates. Returns null when no frame has been captured yet (RLS: member). */
export interface DeviceScreenshot { imageBase64: string; format: string; width: number | null; height: number | null; capturedAt: string; commandId: string | null }
export async function getLatestScreenshot(deviceId: string): Promise<DeviceScreenshot | null> {
  if (!supabase) return null
  const { data, error } = await sb()
    .from('device_screenshots')
    .select('image_base64,format,width,height,captured_at,command_id')
    .eq('device_id', deviceId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const r = data as { image_base64: string; format: string | null; width: number | null; height: number | null; captured_at: string; command_id: string | null }
  return { imageBase64: r.image_base64, format: r.format ?? 'png', width: r.width, height: r.height, capturedAt: r.captured_at, commandId: r.command_id }
}

// Realtime subscriptions need a UNIQUE topic per instance (a fixed topic collides →
// "cannot add postgres_changes callbacks after subscribe"). A per-call suffix keeps them independent.
let screenSeq = 0

/** Subscribe to the latest REAL frame for a device over Supabase Realtime (postgres_changes on
 *  device_screenshots). Fires on insert/update with the new row → onFrame. Requires the table to be
 *  in the `supabase_realtime` publication; if it isn't, the channel is simply inert and the GO LIVE
 *  fallback poll still drives updates. Returns an unsubscribe. */
export function subscribeDeviceScreenshots(deviceId: string, onFrame: (s: DeviceScreenshot) => void): () => void {
  if (!supabase) return () => {}
  const client = sb()
  const ch = client
    .channel(`devscreens:${deviceId}:${++screenSeq}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'device_screenshots', filter: `device_id=eq.${deviceId}` }, (payload) => {
      const r = payload.new as { image_base64?: string; format?: string | null; width?: number | null; height?: number | null; captured_at?: string; command_id?: string | null } | null
      if (r && typeof r.image_base64 === 'string' && r.image_base64.length > 0) {
        onFrame({ imageBase64: r.image_base64, format: r.format ?? 'png', width: r.width ?? null, height: r.height ?? null, capturedAt: r.captured_at ?? '', commandId: r.command_id ?? null })
      }
    })
  // If device_screenshots isn't in the supabase_realtime publication yet, the channel can't subscribe —
  // tear it down quietly (no retries, no recurring console noise) and let the GO LIVE fallback poll drive
  // updates. (CLOSED is the normal unsubscribe path → ignored.)
  ch.subscribe((status) => {
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') void client.removeChannel(ch)
  })
  return () => { void client.removeChannel(ch) }
}

// ─── Installed-app inventory + per-user visibility ──────────────────────────────

let appsSeq = 0

/** A real installed app the agent detected on a device (device_apps, installed = true). */
export interface DeviceApp { bundleId: string; name: string; abbr: string | null; iconColor: string | null; source: string; detectedAt: string }

/** Installed apps for a device (RLS: team member). Only apps the agent CONFIRMED installed. */
export async function listDeviceApps(deviceId: string): Promise<DeviceApp[]> {
  if (!supabase) return []
  const { data, error } = await sb()
    .from('device_apps')
    .select('bundle_id,name,abbr,icon_color,source,detected_at')
    .eq('device_id', deviceId)
    .eq('installed', true)
    .order('name', { ascending: true })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Array<{ bundle_id: string; name: string; abbr: string | null; icon_color: string | null; source: string; detected_at: string }>)
    .map((r) => ({ bundleId: r.bundle_id, name: r.name, abbr: r.abbr, iconColor: r.icon_color, source: r.source, detectedAt: r.detected_at }))
}

/** The signed-in user's visibility prefs for a device (RLS auto-scopes to auth.uid()). */
export interface AppPreference { bundleId: string; visible: boolean }
export async function getAppPreferences(deviceId: string): Promise<AppPreference[]> {
  if (!supabase) return []
  const { data, error } = await sb().from('user_device_app_preferences').select('bundle_id,visible').eq('device_id', deviceId)
  if (error) throw new Error(error.message)
  return ((data ?? []) as Array<{ bundle_id: string; visible: boolean }>).map((r) => ({ bundleId: r.bundle_id, visible: r.visible }))
}

/** Upsert the signed-in user's show/hide for one app on one device (RLS: own row + member). */
export async function setAppVisibility(o: { userId: string; teamId: string; deviceId: string; bundleId: string; visible: boolean }): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured' }
  const { error } = await sb()
    .from('user_device_app_preferences')
    .upsert(
      { user_id: o.userId, team_id: o.teamId, device_id: o.deviceId, bundle_id: o.bundleId, visible: o.visible },
      { onConflict: 'user_id,device_id,bundle_id' },
    )
  if (error) return { error: error.message }
  return {}
}

/** Subscribe to device_apps changes for a device (fires onChange after the agent re-detects).
 *  Inert (and self-torn-down) if device_apps isn't in the realtime publication. */
export function subscribeDeviceApps(deviceId: string, onChange: () => void): () => void {
  if (!supabase) return () => {}
  const client = sb()
  const ch = client
    .channel(`devapps:${deviceId}:${++appsSeq}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'device_apps', filter: `device_id=eq.${deviceId}` }, () => onChange())
  ch.subscribe((status) => {
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') void client.removeChannel(ch)
  })
  return () => { void client.removeChannel(ch) }
}

/** Mint a one-time pairing token (admin/writer) the agent redeems via claim_device. */
export async function createPairingToken(o: { teamId: string; userId: string }): Promise<{ token: string; expiresAt: string }> {
  const { data, error } = await sb().from('device_pairing_tokens').insert({ team_id: o.teamId, created_by: o.userId }).select('token,expires_at').single()
  if (error) throw new Error(error.message)
  const row = data as { token: string; expires_at: string }
  return { token: row.token, expiresAt: row.expires_at }
}

const TERMINAL = new Set<CommandStatus>(['acked', 'failed', 'expired'])

// Realtime topics must be unique per watcher (a fixed topic collides across concurrent commands).
let commandSeq = 0
// Opt-in command round-trip logging in the browser: localStorage 'pfa:debugLatency' = '1'. OFF by default.
const debugLatency = (): boolean => {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem('pfa:debugLatency') === '1' } catch { return false }
}

/** Track a command until it reaches a terminal state (or times out), calling `onStatus` on every
 *  CHANGE. PRIMARY path is Supabase Realtime (postgres_changes on agent_commands, id-filtered) →
 *  near-instant UI feedback the moment the agent acks. A slower poll runs ALONGSIDE as a fallback:
 *  it catches a status reached before the channel subscribes, and fully covers the case where
 *  agent_commands isn't in the realtime publication (the channel just tears itself down). Truthful:
 *  reports the real row status, never a fabricated success. Returns cancel() to stop early. */
export function watchCommand(id: string, onStatus: (status: CommandStatus, error: string | null) => void, opts: { intervalMs?: number; timeoutMs?: number } = {}): () => void {
  const interval = opts.intervalMs ?? 1500 // fallback cadence — unchanged, so no regression if Realtime is absent
  const timeout = opts.timeoutMs ?? 30_000
  const start = Date.now()
  const debug = debugLatency()
  let last: CommandStatus | '' = ''
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let channel: ReturnType<SupabaseClient['channel']> | undefined

  const cancel = () => {
    if (cancelled) return
    cancelled = true
    if (timer) clearTimeout(timer)
    if (channel && supabase) { void sb().removeChannel(channel); channel = undefined }
  }

  const emit = (status: CommandStatus, error: string | null) => {
    if (cancelled || status === last) return
    last = status
    if (debug) console.debug(`[pfa:latency] cmd ${id} → ${status} @+${Date.now() - start}ms`)
    onStatus(status, error)
    if (TERMINAL.has(status)) cancel()
  }

  // PRIMARY: Realtime push (instant). Self-tears-down on channel error → the poll carries it.
  if (supabase) {
    const client = sb()
    channel = client
      .channel(`agentcmd:${id}:${++commandSeq}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_commands', filter: `id=eq.${id}` }, (payload) => {
        const r = payload.new as { status?: CommandStatus; error?: string | null } | null
        if (r && typeof r.status === 'string') emit(r.status, r.error ?? null)
      })
    channel.subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { if (channel) void client.removeChannel(channel); channel = undefined }
    })
  }

  // FALLBACK poll: immediate first read (catches an already-terminal / pre-subscribe status), then
  // every `interval` until terminal or timeout. Dedupes against Realtime via `last`.
  const tick = async () => {
    if (cancelled) return
    const row = await getCommand(id).catch(() => null)
    if (row) emit(row.status, row.error)
    if (!cancelled && Date.now() - start < timeout) timer = setTimeout(() => void tick(), interval)
  }
  void tick()

  return cancel
}

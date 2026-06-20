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

/** Mint a one-time pairing token (admin/writer) the agent redeems via claim_device. */
export async function createPairingToken(o: { teamId: string; userId: string }): Promise<{ token: string; expiresAt: string }> {
  const { data, error } = await sb().from('device_pairing_tokens').insert({ team_id: o.teamId, created_by: o.userId }).select('token,expires_at').single()
  if (error) throw new Error(error.message)
  const row = data as { token: string; expires_at: string }
  return { token: row.token, expiresAt: row.expires_at }
}

const TERMINAL = new Set<CommandStatus>(['acked', 'failed', 'expired'])

/** Poll a command until it reaches a terminal state (or times out), calling `onStatus`
 *  on every CHANGE. Truthful: it reports the real row status, never a fabricated success.
 *  Returns a cancel() to stop early (e.g. on unmount). */
export function watchCommand(id: string, onStatus: (status: CommandStatus, error: string | null) => void, opts: { intervalMs?: number; timeoutMs?: number } = {}): () => void {
  const interval = opts.intervalMs ?? 1500
  const timeout = opts.timeoutMs ?? 30_000
  const start = Date.now()
  let last: CommandStatus | '' = ''
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const tick = async () => {
    if (cancelled) return
    const row = await getCommand(id).catch(() => null)
    if (!cancelled && row && row.status !== last) {
      last = row.status
      onStatus(row.status, row.error)
      if (TERMINAL.has(row.status)) return
    }
    if (!cancelled && Date.now() - start < timeout) timer = setTimeout(() => void tick(), interval)
  }
  void tick()
  return () => { cancelled = true; if (timer) clearTimeout(timer) }
}

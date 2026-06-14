/**
 * Shared heartbeat contract + pure logic — imported by BOTH the React client
 * (live green/red freshness indicators) and the Node server (WS ingestion +
 * staleness sweep). Alias-free (no `@/` imports) so the server compiles it
 * without the Vite path alias, exactly like shared/types.ts.
 */
import type { Device, Heartbeat } from './types'

/** How often a healthy device agent emits a heartbeat. */
export const HEARTBEAT_INTERVAL_MS = 10_000
/** A device whose last heartbeat is older than this is treated as offline. */
export const HEARTBEAT_TIMEOUT_MS = 30_000

const clampPct = (n: number): number => Math.max(0, Math.min(100, n))

/**
 * Merge a heartbeat into a device, stamping the receipt time. Only the fields
 * the agent actually reported are overwritten; everything else is preserved.
 * Returns a NEW device object (immutable update) — battery is rounded to an int
 * and all percentages are clamped to 0–100.
 */
export function mergeHeartbeat(device: Device, hb: Heartbeat, now: number): Device {
  const next: Device = { ...device, lastHeartbeat: now }
  if (hb.status !== undefined) next.status = hb.status
  if (hb.battery !== undefined) next.battery = Math.round(clampPct(hb.battery))
  if (hb.cpuUsage !== undefined) next.cpuUsage = +clampPct(hb.cpuUsage).toFixed(1)
  if (hb.memoryUsage !== undefined) next.memoryUsage = +clampPct(hb.memoryUsage).toFixed(1)
  return next
}

/**
 * True when a device's last heartbeat is missing or older than the timeout —
 * the basis for the live green/red freshness indicator in the UI.
 */
export function isHeartbeatStale(
  lastHeartbeat: number | null | undefined,
  now: number,
  timeoutMs: number = HEARTBEAT_TIMEOUT_MS,
): boolean {
  if (lastHeartbeat == null) return true
  return now - lastHeartbeat > timeoutMs
}

/**
 * Devices the SERVER should flip to offline: they have heartbeat at least once
 * (so they're agent-managed), have since gone silent past the timeout, and
 * aren't already offline. Devices that never heartbeat (lastHeartbeat == null)
 * are left to the normal lifecycle, so the seeded/simulated fleet is never
 * force-offlined before any agent has reported.
 */
export function staleHeartbeatDevices(
  devices: Device[],
  now: number,
  timeoutMs: number = HEARTBEAT_TIMEOUT_MS,
): Device[] {
  return devices.filter(
    (d) => d.lastHeartbeat != null && d.status !== 'offline' && now - d.lastHeartbeat > timeoutMs,
  )
}

import { supabase } from '@/lib/supabase'
import type { DeviceRow } from '@/lib/database.types'

/**
 * Device mutations that aren't simple table writes. Rename goes through the
 * `rename_device` Supabase RPC, which enforces the `phones.rename` permission
 * (owner/admin, or a per-member override) AND validates the name server-side —
 * so an unauthorized caller is rejected even on a direct API attempt. The change
 * lands in the `devices` table and Realtime broadcasts it to every surface
 * (Fleet graph/3D, drawer, Phone Control, Phones registry) with no reload.
 */

export const MAX_DEVICE_NAME = 64

/** Client-side name validation for instant UX feedback. The server (trigger +
 *  RPC) enforces the SAME rules as the source of truth. Returns an error string
 *  or null when valid. `current` lets the caller treat an unchanged name as a no-op. */
export function validateDeviceName(name: string, current?: string): string | null {
  const trimmed = name.trim()
  if (trimmed.length === 0) return 'Name cannot be empty.'
  if (trimmed.length > MAX_DEVICE_NAME) return `Name is too long (max ${MAX_DEVICE_NAME} characters).`
  if (current !== undefined && trimmed === current.trim()) return 'unchanged'
  return null
}

/** Rename a device via the RBAC-enforced RPC. Returns the updated row, or a
 *  truthful error (permission denied / validation / network). Never throws. */
export async function renameDevice(
  deviceId: string,
  name: string,
): Promise<{ device?: DeviceRow; error?: string }> {
  if (!supabase) return { error: 'Not configured' }
  const trimmed = name.trim()
  const invalid = validateDeviceName(trimmed)
  if (invalid && invalid !== 'unchanged') return { error: invalid }
  const { data, error } = await supabase.rpc('rename_device', { p_device_id: deviceId, p_name: trimmed })
  if (error) {
    // Surface a clear message for the most common rejection (the RPC/trigger raise
    // a 42501 'permission denied …'); pass anything else through verbatim.
    const msg = /permission denied/i.test(error.message)
      ? 'You do not have permission to rename this device.'
      : error.message
    return { error: msg }
  }
  return { device: data as DeviceRow }
}

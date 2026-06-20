import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { DeviceRow, DeviceStatusEnum } from '@/lib/database.types'

// Realtime channel topics must be UNIQUE per subscription. useDevices can be mounted
// many times concurrently (Phones view + Fleet via useFleet + the sidebar stats), so a
// fixed `devices:<teamId>` topic would collide ("cannot add postgres_changes callbacks
// after subscribe"). A per-instance suffix keeps each subscription independent.
let deviceChannelSeq = 0

export interface NewDevice {
  name: string
  udid?: string | null
  platform?: string
  os_version?: string | null
  status?: DeviceStatusEnum
  ip_address?: string | null
  wda_port?: number | null
  // `group_name` is a real, updatable `devices` column (see DeviceUpdate). It was
  // omitted from this input contract; updateDevice already passes any patch field
  // straight to `.update(patch)`, so this is a type-only widening — no behavior change.
  group_name?: string
}

export interface UseDevices {
  devices: DeviceRow[]
  loading: boolean
  error: string | null
  addDevice: (input: NewDevice) => Promise<{ error?: string }>
  updateStatus: (id: string, status: DeviceStatusEnum) => Promise<{ error?: string }>
  updateDevice: (id: string, patch: Partial<NewDevice>) => Promise<{ error?: string }>
  deleteDevice: (id: string) => Promise<{ error?: string }>
  refresh: () => Promise<void>
}

const byCreatedAt = (a: DeviceRow, b: DeviceRow) => a.created_at.localeCompare(b.created_at)

/**
 * CRUD for the team's devices, with a live Supabase Realtime subscription so
 * status changes (from any client or the device agent) stream in. All access is
 * RLS-scoped to `teamId`. Mutations apply optimistically from the returned row
 * AND realtime delivers the change — both go through an idempotent upsert keyed
 * by id, so there's no double-insert.
 */
export function useDevices(teamId: string | null): UseDevices {
  const [devices, setDevices] = useState<DeviceRow[]>([])
  const [loading, setLoading] = useState<boolean>(Boolean(teamId))
  const [error, setError] = useState<string | null>(null)
  const chanId = useRef(0)
  if (chanId.current === 0) chanId.current = ++deviceChannelSeq

  const upsertLocal = useCallback((row: DeviceRow) => {
    setDevices((prev) => {
      const next = prev.some((d) => d.id === row.id)
        ? prev.map((d) => (d.id === row.id ? row : d))
        : [...prev, row]
      return next.sort(byCreatedAt)
    })
  }, [])
  const removeLocal = useCallback((id: string) => {
    setDevices((prev) => prev.filter((d) => d.id !== id))
  }, [])

  // `isActive` lets the effect cancel a stale in-flight load (after a team
  // change) before it commits, so the previous team's rows can't clobber the
  // current team's — mirrors the cancellation guard in AuthContext.
  const load = useCallback(async (isActive: () => boolean = () => true) => {
    if (!supabase || !teamId) {
      if (isActive()) { setDevices([]); setLoading(false) }
      return
    }
    if (isActive()) { setLoading(true); setError(null) }
    const { data, error: err } = await supabase
      .from('devices')
      .select('*')
      .eq('team_id', teamId)
      .order('created_at', { ascending: true })
    if (!isActive()) return
    if (err) setError(err.message)
    setDevices((data as DeviceRow[]) ?? [])
    setLoading(false)
  }, [teamId])

  // Initial load (+ reload when the team changes). Async data-load effect — the
  // loading flag it sets is the intended pattern.
  useEffect(() => {
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(() => active)
    return () => { active = false }
  }, [load])

  // Live subscription — only this team's device rows (RLS + filter).
  useEffect(() => {
    if (!supabase || !teamId) return
    const sb = supabase
    const channel: RealtimeChannel = sb
      .channel(`devices:${teamId}:${chanId.current}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'devices', filter: `team_id=eq.${teamId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') removeLocal((payload.old as { id: string }).id)
          else upsertLocal(payload.new as DeviceRow)
        },
      )
      .subscribe()
    return () => {
      void sb.removeChannel(channel)
    }
  }, [teamId, upsertLocal, removeLocal])

  const addDevice = useCallback(async (input: NewDevice) => {
    if (!supabase || !teamId) return { error: 'No active team' }
    const { data, error: err } = await supabase
      .from('devices')
      .insert({ team_id: teamId, platform: 'ios', status: 'offline', ...input })
      .select()
      .single()
    if (err) return { error: err.message }
    upsertLocal(data as DeviceRow)
    return {}
  }, [teamId, upsertLocal])

  const updateDevice = useCallback(async (id: string, patch: Partial<NewDevice>) => {
    if (!supabase) return { error: 'Not configured' }
    const { data, error: err } = await supabase.from('devices').update(patch).eq('id', id).select().single()
    if (err) return { error: err.message }
    upsertLocal(data as DeviceRow)
    return {}
  }, [upsertLocal])

  const updateStatus = useCallback(
    (id: string, status: DeviceStatusEnum) => updateDevice(id, { status }),
    [updateDevice],
  )

  const deleteDevice = useCallback(async (id: string) => {
    if (!supabase) return { error: 'Not configured' }
    const { error: err } = await supabase.from('devices').delete().eq('id', id)
    if (err) return { error: err.message }
    removeLocal(id)
    return {}
  }, [removeLocal])

  return { devices, loading, error, addDevice, updateStatus, updateDevice, deleteDevice, refresh: load }
}

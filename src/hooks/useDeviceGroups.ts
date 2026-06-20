import { useCallback, useEffect, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { DeviceGroupRow } from '@/lib/database.types'

const byName = (a: DeviceGroupRow, b: DeviceGroupRow) => a.name.localeCompare(b.name)

export function useDeviceGroups(teamId: string | null) {
  const [groups, setGroups] = useState<DeviceGroupRow[]>([])
  const [loading, setLoading] = useState(Boolean(teamId))
  const [error, setError] = useState<string | null>(null)

  const upsertLocal = useCallback((row: DeviceGroupRow) => {
    setGroups((prev) => {
      const next = prev.some((g) => g.id === row.id) ? prev.map((g) => (g.id === row.id ? row : g)) : [...prev, row]
      return next.sort(byName)
    })
  }, [])

  const removeLocal = useCallback((id: string) => setGroups((prev) => prev.filter((g) => g.id !== id)), [])

  const load = useCallback(async (isActive: () => boolean = () => true) => {
    if (!supabase || !teamId) {
      if (isActive()) { setGroups([]); setLoading(false) }
      return
    }
    if (isActive()) { setLoading(true); setError(null) }
    const { data, error: err } = await supabase
      .from('device_groups')
      .select('*')
      .eq('team_id', teamId)
      .order('name', { ascending: true })
    if (!isActive()) return
    if (err) setError(err.message)
    setGroups((data as DeviceGroupRow[]) ?? [])
    setLoading(false)
  }, [teamId])

  useEffect(() => {
    let active = true
    void load(() => active)
    return () => { active = false }
  }, [load])

  useEffect(() => {
    if (!supabase || !teamId) return
    const sb = supabase
    const channel: RealtimeChannel = sb
      .channel(`device_groups:${teamId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'device_groups', filter: `team_id=eq.${teamId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') removeLocal((payload.old as { id: string }).id)
          else upsertLocal(payload.new as DeviceGroupRow)
        },
      )
      .subscribe()
    return () => {
      void sb.removeChannel(channel)
    }
  }, [teamId, upsertLocal, removeLocal])

  const ensureGroup = useCallback(async (name: string) => {
    if (!supabase || !teamId) return { error: 'No active team' }
    const clean = name.trim() || 'Unassigned'
    const { data, error: err } = await supabase
      .from('device_groups')
      .upsert({ team_id: teamId, name: clean }, { onConflict: 'team_id,name' })
      .select()
      .single()
    if (err) return { error: err.message }
    upsertLocal(data as DeviceGroupRow)
    return {}
  }, [teamId, upsertLocal])

  const renameGroup = useCallback(async (oldName: string, newName: string) => {
    if (!supabase || !teamId) return { error: 'No active team' }
    const clean = newName.trim() || 'Unassigned'
    await ensureGroup(clean)
    const { error: dErr } = await supabase
      .from('devices')
      .update({ group_name: clean })
      .eq('team_id', teamId)
      .eq('group_name', oldName)
    if (dErr) return { error: dErr.message }
    const { error: gErr } = await supabase
      .from('device_groups')
      .delete()
      .eq('team_id', teamId)
      .eq('name', oldName)
    if (gErr) return { error: gErr.message }
    return {}
  }, [teamId, ensureGroup])

  const assignDevices = useCallback(async (deviceIds: string[], groupName: string) => {
    if (!supabase || !teamId) return { error: 'No active team' }
    const clean = groupName.trim() || 'Unassigned'
    await ensureGroup(clean)
    if (deviceIds.length === 0) return {}
    const { error: err } = await supabase
      .from('devices')
      .update({ group_name: clean })
      .eq('team_id', teamId)
      .in('id', deviceIds)
    if (err) return { error: err.message }
    return {}
  }, [teamId, ensureGroup])

  return { groups, loading, error, ensureGroup, renameGroup, assignDevices, refresh: load }
}

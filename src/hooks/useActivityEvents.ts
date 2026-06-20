import { useCallback, useEffect, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { ActivityCategory, ActivityEventRow, ActivityResult, Json } from '@/lib/database.types'

const byCreatedDesc = (a: ActivityEventRow, b: ActivityEventRow) => b.created_at.localeCompare(a.created_at)

export function useActivityEvents(teamId: string | null, category?: ActivityCategory) {
  const [events, setEvents] = useState<ActivityEventRow[]>([])
  const [loading, setLoading] = useState(Boolean(teamId))
  const [error, setError] = useState<string | null>(null)

  const upsertLocal = useCallback((row: ActivityEventRow) => {
    setEvents((prev) => {
      const next = prev.some((e) => e.id === row.id) ? prev.map((e) => (e.id === row.id ? row : e)) : [row, ...prev]
      return next.sort(byCreatedDesc).slice(0, 250)
    })
  }, [])

  const load = useCallback(async (isActive: () => boolean = () => true) => {
    if (!supabase || !teamId) {
      if (isActive()) { setEvents([]); setLoading(false) }
      return
    }
    if (isActive()) { setLoading(true); setError(null) }
    let query = supabase
      .from('activity_events')
      .select('*')
      .eq('team_id', teamId)
      .order('created_at', { ascending: false })
      .limit(250)
    if (category) query = query.eq('category', category)
    const { data, error: err } = await query
    if (!isActive()) return
    if (err) setError(err.message)
    setEvents((data as ActivityEventRow[]) ?? [])
    setLoading(false)
  }, [teamId, category])

  useEffect(() => {
    let active = true
    void load(() => active)
    return () => { active = false }
  }, [load])

  useEffect(() => {
    if (!supabase || !teamId) return
    const sb = supabase
    const channel: RealtimeChannel = sb
      .channel(`activity_events:${teamId}:${category ?? 'all'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'activity_events', filter: `team_id=eq.${teamId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') return
          const row = payload.new as ActivityEventRow
          if (!category || row.category === category) upsertLocal(row)
        },
      )
      .subscribe()
    return () => {
      void sb.removeChannel(channel)
    }
  }, [teamId, category, upsertLocal])

  return { events, loading, error, refresh: load }
}

export async function logSupabaseActivity(input: {
  teamId: string
  action: string
  category?: ActivityCategory
  targetId?: string | null
  targetLabel?: string | null
  result?: ActivityResult
  detail?: string | null
  metadata?: Json
}) {
  if (!supabase) return
  await supabase.rpc('log_activity_event', {
    p_team_id: input.teamId,
    p_action: input.action,
    p_category: input.category ?? 'operational',
    p_target_id: input.targetId ?? null,
    p_target_label: input.targetLabel ?? null,
    p_result: input.result ?? 'success',
    p_detail: input.detail ?? null,
    p_metadata: input.metadata ?? {},
  })
}

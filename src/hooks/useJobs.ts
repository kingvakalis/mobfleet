import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { AutomationJobRow, Json, JobStatusEnum } from '@/lib/database.types'

// Per-instance suffix so concurrent useJobs mounts (Jobs view + Fleet via useFleet)
// don't share a realtime topic. See the note in useDevices.ts.
let jobChannelSeq = 0

export interface NewJob {
  type: string
  device_id?: string | null
  status?: JobStatusEnum
  config?: Json
}

export interface UseJobs {
  jobs: AutomationJobRow[]
  loading: boolean
  error: string | null
  createJob: (input: NewJob) => Promise<{ error?: string }>
  updateStatus: (id: string, status: JobStatusEnum) => Promise<{ error?: string }>
  deleteJob: (id: string) => Promise<{ error?: string }>
  refresh: () => Promise<void>
}

// Newest first.
const byCreatedDesc = (a: AutomationJobRow, b: AutomationJobRow) => b.created_at.localeCompare(a.created_at)

/**
 * CRUD for the team's automation jobs, with a live Realtime subscription.
 * RLS-scoped to `teamId`. Status transitions stamp started_at / finished_at.
 */
export function useJobs(teamId: string | null): UseJobs {
  const [jobs, setJobs] = useState<AutomationJobRow[]>([])
  const [loading, setLoading] = useState<boolean>(Boolean(teamId))
  const [error, setError] = useState<string | null>(null)
  const chanId = useRef(0)
  if (chanId.current === 0) chanId.current = ++jobChannelSeq

  const upsertLocal = useCallback((row: AutomationJobRow) => {
    setJobs((prev) => {
      const next = prev.some((j) => j.id === row.id) ? prev.map((j) => (j.id === row.id ? row : j)) : [row, ...prev]
      return next.sort(byCreatedDesc)
    })
  }, [])
  const removeLocal = useCallback((id: string) => setJobs((prev) => prev.filter((j) => j.id !== id)), [])

  // `isActive` lets the effect cancel a stale in-flight load (after a team
  // change) before it commits, so the previous team's rows can't clobber the
  // current team's — mirrors the cancellation guard in AuthContext.
  const load = useCallback(async (isActive: () => boolean = () => true) => {
    if (!supabase || !teamId) {
      if (isActive()) { setJobs([]); setLoading(false) }
      return
    }
    if (isActive()) { setLoading(true); setError(null) }
    const { data, error: err } = await supabase
      .from('automation_jobs')
      .select('*')
      .eq('team_id', teamId)
      .order('created_at', { ascending: false })
    if (!isActive()) return
    if (err) setError(err.message)
    setJobs((data as AutomationJobRow[]) ?? [])
    setLoading(false)
  }, [teamId])

  // Async data-load effect — the loading flag it sets is the intended pattern.
  useEffect(() => {
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(() => active)
    return () => { active = false }
  }, [load])

  useEffect(() => {
    if (!supabase || !teamId) return
    const sb = supabase
    const channel: RealtimeChannel = sb
      .channel(`automation_jobs:${teamId}:${chanId.current}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'automation_jobs', filter: `team_id=eq.${teamId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') removeLocal((payload.old as { id: string }).id)
          else upsertLocal(payload.new as AutomationJobRow)
        },
      )
      .subscribe()
    return () => {
      void sb.removeChannel(channel)
    }
  }, [teamId, upsertLocal, removeLocal])

  const createJob = useCallback(async (input: NewJob) => {
    if (!supabase || !teamId) return { error: 'No active team' }
    const { data, error: err } = await supabase
      .from('automation_jobs')
      .insert({ team_id: teamId, status: 'queued', config: {}, ...input })
      .select()
      .single()
    if (err) return { error: err.message }
    upsertLocal(data as AutomationJobRow)
    return {}
  }, [teamId, upsertLocal])

  const updateStatus = useCallback(async (id: string, status: JobStatusEnum) => {
    if (!supabase) return { error: 'Not configured' }
    const patch: { status: JobStatusEnum; started_at?: string; finished_at?: string } = { status }
    const nowIso = new Date().toISOString()
    if (status === 'running') patch.started_at = nowIso
    if (status === 'succeeded' || status === 'failed' || status === 'cancelled') patch.finished_at = nowIso
    const { data, error: err } = await supabase.from('automation_jobs').update(patch).eq('id', id).select().single()
    if (err) return { error: err.message }
    upsertLocal(data as AutomationJobRow)
    return {}
  }, [upsertLocal])

  const deleteJob = useCallback(async (id: string) => {
    if (!supabase) return { error: 'Not configured' }
    const { error: err } = await supabase.from('automation_jobs').delete().eq('id', id)
    if (err) return { error: err.message }
    removeLocal(id)
    return {}
  }, [removeLocal])

  return { jobs, loading, error, createJob, updateStatus, deleteJob, refresh: load }
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { AutomationJobRow, AutomationRow, Json } from '@/lib/database.types'
import type { TaskType } from '@/shared/types'
import type { AutomationStep } from '@/services/automations-local'

export interface SupabaseAutomationInput {
  id?: string
  name: string
  description: string
  taskType: TaskType
  steps: AutomationStep[]
}

export interface SupabaseAutomationSummary {
  id: string
  name: string
  description: string
  taskType: TaskType
  steps: AutomationStep[]
  paused: boolean
  successRate: number
  runs: number
  lastRun: string
  createdAt: number
  custom: true
}

const byCreatedDesc = (a: AutomationRow, b: AutomationRow) => b.created_at.localeCompare(a.created_at)

function asSteps(value: Json): AutomationStep[] {
  if (!Array.isArray(value)) return []
  return value.filter((x) => Boolean(x && typeof x === 'object' && !Array.isArray(x) && 'kind' in x)) as unknown as AutomationStep[]
}

function relTime(iso: string | null): string {
  if (!iso) return 'never'
  const d = Date.now() - new Date(iso).getTime()
  if (d < 60_000) return 'just now'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`
  return `${Math.floor(d / 86_400_000)}d ago`
}

export function useSupabaseAutomations(teamId: string | null) {
  const [automations, setAutomations] = useState<AutomationRow[]>([])
  const [jobs, setJobs] = useState<AutomationJobRow[]>([])
  const [loading, setLoading] = useState(Boolean(teamId))
  const [error, setError] = useState<string | null>(null)

  const upsertAutomation = useCallback((row: AutomationRow) => {
    setAutomations((prev) => {
      const next = prev.some((a) => a.id === row.id) ? prev.map((a) => (a.id === row.id ? row : a)) : [row, ...prev]
      return next.sort(byCreatedDesc)
    })
  }, [])

  const removeAutomation = useCallback((id: string) => setAutomations((prev) => prev.filter((a) => a.id !== id)), [])

  const load = useCallback(async (isActive: () => boolean = () => true) => {
    if (!supabase || !teamId) {
      if (isActive()) { setAutomations([]); setJobs([]); setLoading(false) }
      return
    }
    if (isActive()) { setLoading(true); setError(null) }
    const [autos, runs] = await Promise.all([
      supabase.from('automations').select('*').eq('team_id', teamId).order('created_at', { ascending: false }),
      supabase.from('automation_jobs').select('*').eq('team_id', teamId).order('created_at', { ascending: false }).limit(500),
    ])
    if (!isActive()) return
    if (autos.error) setError(autos.error.message)
    setAutomations((autos.data as AutomationRow[]) ?? [])
    setJobs((runs.data as AutomationJobRow[]) ?? [])
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
    const autoChannel: RealtimeChannel = sb
      .channel(`automations:${teamId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'automations', filter: `team_id=eq.${teamId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') removeAutomation((payload.old as { id: string }).id)
          else upsertAutomation(payload.new as AutomationRow)
        },
      )
      .subscribe()
    const jobsChannel: RealtimeChannel = sb
      .channel(`automation_runs:${teamId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'automation_jobs', filter: `team_id=eq.${teamId}` },
        () => void load(),
      )
      .subscribe()
    return () => {
      void sb.removeChannel(autoChannel)
      void sb.removeChannel(jobsChannel)
    }
  }, [teamId, load, upsertAutomation, removeAutomation])

  const summaries = useMemo<SupabaseAutomationSummary[]>(() => automations.map((a) => {
    const runs = jobs.filter((j) => {
      const cfg = j.config as { automation_id?: string } | null
      return cfg?.automation_id === a.id || j.type === a.task_type
    })
    const completed = runs.filter((j) => j.status === 'succeeded' || j.status === 'failed')
    const succeeded = completed.filter((j) => j.status === 'succeeded').length
    const successRate = completed.length ? Math.round((succeeded / completed.length) * 100) : 0
    return {
      id: a.id,
      name: a.name,
      description: a.description,
      taskType: a.task_type as TaskType,
      steps: asSteps(a.steps),
      paused: a.paused,
      successRate,
      runs: runs.length,
      lastRun: relTime(runs[0]?.created_at ?? null),
      createdAt: new Date(a.created_at).getTime(),
      custom: true,
    }
  }), [automations, jobs])

  const saveAutomation = useCallback(async (input: SupabaseAutomationInput) => {
    if (!supabase || !teamId) return { error: 'No active team' }
    const payload = {
      team_id: teamId,
      name: input.name,
      description: input.description,
      task_type: input.taskType,
      steps: input.steps as unknown as Json,
    }
    const query = input.id
      ? supabase.from('automations').update(payload).eq('id', input.id).select().single()
      : supabase.from('automations').insert(payload).select().single()
    const { data, error: err } = await query
    if (err) return { error: err.message }
    upsertAutomation(data as AutomationRow)
    return {}
  }, [teamId, upsertAutomation])

  const togglePaused = useCallback(async (id: string) => {
    if (!supabase) return { error: 'Not configured' }
    const row = automations.find((a) => a.id === id)
    if (!row) return { error: 'Automation not found' }
    const { data, error: err } = await supabase.from('automations').update({ paused: !row.paused }).eq('id', id).select().single()
    if (err) return { error: err.message }
    upsertAutomation(data as AutomationRow)
    return {}
  }, [automations, upsertAutomation])

  const deleteAutomation = useCallback(async (id: string) => {
    if (!supabase) return { error: 'Not configured' }
    const { error: err } = await supabase.from('automations').delete().eq('id', id)
    if (err) return { error: err.message }
    removeAutomation(id)
    return {}
  }, [removeAutomation])

  const runAutomation = useCallback(async (automation: SupabaseAutomationSummary, deviceId?: string | null) => {
    if (!supabase || !teamId) return { error: 'No active team' }
    const { error: err } = await supabase.from('automation_jobs').insert({
      team_id: teamId,
      device_id: deviceId ?? null,
      type: automation.taskType,
      status: 'queued',
      config: {
        automation_id: automation.id,
        automation_name: automation.name,
        steps: automation.steps,
      } as unknown as Json,
    })
    if (err) return { error: err.message }
    return {}
  }, [teamId])

  return { automations: summaries, loading, error, saveAutomation, togglePaused, deleteAutomation, runAutomation, refresh: load }
}

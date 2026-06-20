import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { AgentCommandRow } from '@/lib/database.types'

const byCreatedDesc = (a: AgentCommandRow, b: AgentCommandRow) => b.created_at.localeCompare(a.created_at)

// Per-instance suffix so concurrent useAgentCommands mounts (Fleet via useFleet, called
// by several components) don't share one realtime topic. See the note in useDevices.ts.
let cmdChannelSeq = 0

export function useAgentCommands(teamId: string | null) {
  const [commands, setCommands] = useState<AgentCommandRow[]>([])
  const chanId = useRef(0)
  if (chanId.current === 0) chanId.current = ++cmdChannelSeq

  const upsertLocal = useCallback((row: AgentCommandRow) => {
    setCommands((prev) => {
      const next = prev.some((c) => c.id === row.id) ? prev.map((c) => (c.id === row.id ? row : c)) : [row, ...prev]
      return next.sort(byCreatedDesc).slice(0, 100)
    })
  }, [])

  const removeLocal = useCallback((id: string) => {
    setCommands((prev) => prev.filter((c) => c.id !== id))
  }, [])

  const load = useCallback(async (isActive: () => boolean = () => true) => {
    if (!supabase || !teamId) {
      if (isActive()) setCommands([])
      return
    }
    const { data } = await supabase
      .from('agent_commands')
      .select('*')
      .eq('team_id', teamId)
      .order('created_at', { ascending: false })
      .limit(100)
    if (isActive()) setCommands((data as AgentCommandRow[]) ?? [])
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
      .channel(`agent_commands:${teamId}:${chanId.current}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agent_commands', filter: `team_id=eq.${teamId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') removeLocal((payload.old as { id: string }).id)
          else upsertLocal(payload.new as AgentCommandRow)
        },
      )
      .subscribe()
    return () => {
      void sb.removeChannel(channel)
    }
  }, [teamId, upsertLocal, removeLocal])

  return { commands, refresh: load }
}

import { useMemo, useSyncExternalStore } from 'react'
import { client } from '@/lib/provider'
import { computeStats, type FleetStats } from '@/lib/provider/stats'
import type { Device, FleetSnapshot, Job, JobStatus } from '@/lib/provider/types'
import { useAuth } from '@/contexts/AuthContext'
import { useTeamContext } from '@/contexts/TeamContext'
import { useDevices } from '@/hooks/useDevices'
import { useJobs } from '@/hooks/useJobs'
import { useAgentCommands } from '@/hooks/useAgentCommands'
import type { AgentCommandRow, AutomationJobRow, DeviceRow } from '@/lib/database.types'

// No-op external-store subscriber. In supabase-mode the snapshot is built from
// Supabase (below), so we must NOT open the Railway/mock provider stream — passing
// this instead of client.subscribe means no /v1 fetch or WS fleet connection is made.
const NOOP_SUBSCRIBE: () => () => void = () => () => {}

function ms(iso: string | null | undefined): number | null {
  return iso ? new Date(iso).getTime() : null
}

function mapJobStatus(status: AutomationJobRow['status']): JobStatus {
  if (status === 'succeeded') return 'succeeded'
  if (status === 'failed' || status === 'cancelled') return 'failed'
  if (status === 'running') return 'running'
  return 'queued'
}

function mapCommandStatus(status: AgentCommandRow['status']): JobStatus {
  if (status === 'acked') return 'succeeded'
  if (status === 'failed') return 'failed'
  if (status === 'running' || status === 'delivered') return 'running'
  return 'queued'
}

function mapDevice(row: DeviceRow, jobs: AutomationJobRow[], commands: AgentCommandRow[]): Device {
  const activeJob = jobs.find((j) => j.device_id === row.id && (j.status === 'queued' || j.status === 'running'))
  const activeCommand = commands.find((c) => c.device_id === row.id && ['pending', 'delivered', 'running'].includes(c.status))
  const group = row.group_name || 'Unassigned'
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    region: '',
    osVersion: row.os_version ?? row.platform,
    model: row.platform === 'ios' ? 'iPhone' : row.platform,
    proxy: '',
    battery: 100,
    group,
    assignedUser: null,
    jobId: activeJob?.id ?? activeCommand?.id ?? null,
    createdAt: new Date(row.created_at).getTime(),
    udid: row.udid ?? undefined,
    platform: row.platform,
    ipAddress: row.ip_address ?? undefined,
    wdaPort: row.wda_port ?? undefined,
    lastHeartbeat: ms(row.last_heartbeat),
    cpuUsage: null,
    memoryUsage: null,
  }
}

function mapAutomationJob(row: AutomationJobRow): Job {
  const status = mapJobStatus(row.status)
  return {
    id: row.id,
    deviceId: row.device_id,
    type: row.type as Job['type'],
    status,
    progress: status === 'succeeded' || status === 'failed' ? 100 : status === 'running' ? 55 : 0,
    createdAt: new Date(row.created_at).getTime(),
    startedAt: ms(row.started_at),
    finishedAt: ms(row.finished_at),
    error: row.error,
    config: typeof row.config === 'object' && row.config !== null && !Array.isArray(row.config)
      ? row.config as Record<string, unknown>
      : {},
  }
}

function mapCommandJob(row: AgentCommandRow): Job {
  const status = mapCommandStatus(row.status)
  return {
    id: row.id,
    deviceId: row.device_id,
    type: 'engage',
    status,
    progress: status === 'succeeded' || status === 'failed' ? 100 : status === 'running' ? 60 : 0,
    createdAt: new Date(row.created_at).getTime(),
    startedAt: ms(row.started_at ?? row.delivered_at),
    finishedAt: ms(row.acked_at),
    error: row.error,
    config: { command: row.action },
  }
}

/** Subscribe to the live fleet snapshot (re-renders on every stream tick). */
export function useFleet(): FleetSnapshot {
  const { enabled } = useAuth()
  const { team } = useTeamContext()
  const teamId = enabled ? team?.id ?? null : null
  const supabaseActive = teamId !== null
  // Demo/me-mode subscribe to the provider stream; supabase-mode uses a no-op so no
  // Railway /v1 or WS fleet connection is opened (getSnapshot is pure → safe to keep).
  const providerSnapshot = useSyncExternalStore(
    supabaseActive ? NOOP_SUBSCRIBE : client.subscribe,
    client.getSnapshot,
    client.getSnapshot,
  )
  const { devices } = useDevices(teamId)
  const { jobs } = useJobs(teamId)
  const { commands } = useAgentCommands(teamId)

  return useMemo(() => {
    if (!enabled || !teamId) return providerSnapshot
    return {
      devices: devices.map((d) => mapDevice(d, jobs, commands)),
      jobs: [...jobs.map(mapAutomationJob), ...commands.map(mapCommandJob)],
      proxies: [],
      ts: Date.now(),
      ready: true,
    }
  }, [enabled, teamId, providerSnapshot, devices, jobs, commands])
}

/** Derived header counters. */
export function useFleetStats(): FleetStats {
  const snapshot = useFleet()
  return useMemo(() => computeStats(snapshot), [snapshot])
}

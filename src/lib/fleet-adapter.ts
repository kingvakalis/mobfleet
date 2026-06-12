import { useMemo } from 'react'
import { useFleet } from '@/hooks/use-fleet'
import { useAutomations } from '@/hooks/use-automations'
import type { Device } from '@/shared/types'
import type { Automation, Group, LogEntry, LogLevel, Phone, PhoneStatus, Proxy } from '@/lib/fleet-data'

/**
 * Adapter: presents the LIVE fleet (my devices/jobs/proxies/automations from
 * useFleet + the backend) in the exact shapes the v2 views consume, so those
 * views switch only their data import (static → these hooks). My shared-types
 * model stays canonical; this maps onto it.
 */

const STATUS_MAP: Record<Device['status'], PhoneStatus> = {
  online: 'online',
  busy: 'running',
  warming: 'booting',
  offline: 'offline',
  error: 'warning',
}

function hash(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}
function uptimeOf(createdAt: number) {
  const m = Math.max(0, Math.floor((Date.now() - createdAt) / 60000))
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export function usePhones(): Phone[] {
  const snap = useFleet()
  return useMemo(() => {
    const proxByIp = new Map(snap.proxies.map((p) => [p.ip, p]))
    const jobById = new Map(snap.jobs.map((j) => [j.id, j]))
    return snap.devices.map((d): Phone => {
      const px = proxByIp.get(d.proxy)
      const proxyStatus: Phone['proxyStatus'] =
        px?.status === 'healthy' ? 'healthy' : px?.status === 'failing' ? 'issue' : 'disconnected'
      const job = d.jobId ? jobById.get(d.jobId) : undefined
      return {
        id: d.id,
        name: d.name,
        group: d.group,
        status: STATUS_MAP[d.status],
        os: d.osVersion,
        model: d.model,
        region: d.region,
        proxyIp: d.proxy,
        proxyStatus,
        uptime: d.status === 'offline' ? '—' : uptimeOf(d.createdAt),
        lastActivity: `${(hash(d.id) % 29) + 1}m ago`,
        job: job ? job.type : 'idle',
        battery: d.battery,
        assignedUser: d.assignedUser ?? 'unassigned',
      }
    })
  }, [snap])
}

export function usePhoneById(id: string | undefined): Phone | undefined {
  const phones = usePhones()
  return useMemo(() => phones.find((p) => p.id === id), [phones, id])
}

export function useGroupsData(): Group[] {
  const snap = useFleet()
  return useMemo(() => {
    const map = new Map<string, Device[]>()
    for (const d of snap.devices) {
      const a = map.get(d.group) ?? []
      a.push(d)
      map.set(d.group, a)
    }
    return [...map.entries()]
      .map(([name, ds], i): Group => ({
        id: 'g-' + i,
        name,
        description: `${ds.length} devices · ${[...new Set(ds.map((d) => d.region))].length} regions`,
        phoneCount: ds.length,
        activeJobs: ds.filter((d) => d.status === 'busy').length,
      }))
      .sort((a, b) => b.phoneCount - a.phoneCount)
  }, [snap])
}

export function useProxiesData(): Proxy[] {
  const snap = useFleet()
  return useMemo(() => {
    const nameById = new Map(snap.devices.map((d) => [d.id, d.name]))
    return snap.proxies.map((p): Proxy => ({
      id: p.ip,
      ip: p.ip,
      port: 8080,
      region: p.region,
      provider: p.provider,
      latencyMs: p.latency,
      status: p.status,
      assignedTo: p.assignedTo ? nameById.get(p.assignedTo) ?? null : null,
    }))
  }, [snap])
}

export function useAutomationsData(): Automation[] {
  const list = useAutomations()
  return useMemo(
    () =>
      list.map((a): Automation => ({
        id: a.id,
        name: a.name,
        description: a.description,
        status: 'active',
        lastRun: a.lastRun,
        successRate: a.successRate,
        totalRuns: a.runs,
        tags: [a.taskType],
      })),
    [list],
  )
}

export function useLiveLogs(): LogEntry[] {
  const snap = useFleet()
  return useMemo(() => {
    const line = (d: Device): { level: LogLevel; message: string } => {
      switch (d.status) {
        case 'error': return { level: 'ERROR', message: 'App crash detected' }
        case 'busy': return { level: 'INFO', message: 'Automation running' }
        case 'warming': return { level: 'INFO', message: 'Booting device' }
        case 'offline': return { level: 'WARN', message: 'Device went offline' }
        default: return { level: 'OK', message: 'Heartbeat OK' }
      }
    }
    return snap.devices.map((d): LogEntry => {
      const l = line(d)
      return { id: 'log-' + d.id, ts: `${hash(d.id) % 59}s ago`, level: l.level, device: d.name, message: l.message }
    })
  }, [snap])
}

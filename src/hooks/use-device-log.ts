import { useCallback, useEffect, useRef, useState } from 'react'
import { regionLabel } from '@/data/regions'
import { useFleet } from '@/hooks/use-fleet'
import type { DeviceStatus } from '@/lib/status'
import type { Device, Job } from '@/lib/provider/types'

export type LogLevel = 'info' | 'ok' | 'warn' | 'error'
export interface LogLine {
  id: number
  t: string
  level: LogLevel
  text: string
}

const MAX_LINES = 120

function clock(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function levelForStatus(s: DeviceStatus): LogLevel {
  if (s === 'error') return 'error'
  if (s === 'warming') return 'warn'
  if (s === 'online') return 'ok'
  return 'info'
}

function heartbeat(device: Device, job: Job | null): { level: LogLevel; text: string } | null {
  const r = (lo: number, hi: number) => Math.floor(lo + Math.random() * (hi - lo))
  switch (device.status) {
    case 'busy':
      return job
        ? { level: 'info', text: `${job.type} ${Math.round(job.progress * 100)}% · ${r(700, 1300)} KB/s` }
        : { level: 'info', text: 'processing' }
    case 'online':
      return { level: 'ok', text: `heartbeat ok · rtt ${r(18, 60)}ms` }
    case 'warming':
      return { level: 'warn', text: 'provisioning runtime…' }
    case 'error':
      return { level: 'error', text: 'agent unreachable · retrying' }
    case 'offline':
      return null
  }
}

export interface DeviceLog {
  lines: LogLine[]
  /** Inject a line (e.g. from a user interaction on the phone). */
  push: (level: LogLevel, text: string) => void
}

/**
 * Synthesizes a live, device-specific log stream from the real fleet snapshot:
 * seeds a backlog on open, reacts to status/job transitions, and emits a
 * heartbeat on an interval. Also exposes `push` so device interactions land in
 * the same stream. Self-contained — no ProviderClient surface.
 */
export function useDeviceLog(deviceId: string | null): DeviceLog {
  const snapshot = useFleet()
  const [lines, setLines] = useState<LogLine[]>([])
  const seq = useRef(0)
  const prev = useRef<{ status?: DeviceStatus; jobId?: string | null }>({})

  const device = deviceId ? snapshot.devices.find((d) => d.id === deviceId) : undefined
  const job = device?.jobId ? snapshot.jobs.find((j) => j.id === device.jobId) ?? null : null

  // Keep the latest device/job for the interval closure.
  const latest = useRef<{ device?: Device; job: Job | null }>({ device, job })
  latest.current = { device, job }

  const push = useCallback((level: LogLevel, text: string) => {
    setLines((ls) => [...ls, { id: seq.current++, t: clock(), level, text }].slice(-MAX_LINES))
  }, [])

  // (Re)seed when the target device changes.
  useEffect(() => {
    setLines([])
    seq.current = 0
    prev.current = {}
    const d = latest.current.device
    if (!d) return
    push('info', `attaching to ${d.id}`)
    push('info', `region ${regionLabel(d.region)} · ${d.osVersion}`)
    push('info', `proxy ${d.proxy}`)
    push(levelForStatus(d.status), `status ${d.status.toUpperCase()}`)
    prev.current = { status: d.status, jobId: d.jobId }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, push])

  // React to live transitions.
  useEffect(() => {
    if (!device) return
    const p = prev.current
    if (p.status !== undefined && p.status !== device.status) {
      push(levelForStatus(device.status), `status → ${device.status.toUpperCase()}`)
    }
    if (p.jobId !== undefined && p.jobId !== device.jobId) {
      const j = latest.current.job
      if (device.jobId && j) push('info', `dispatch ${j.type.toUpperCase()} · ${device.jobId}`)
      else if (!device.jobId && p.jobId) push('ok', `job ${p.jobId} released`)
    }
    prev.current = { status: device.status, jobId: device.jobId }
  }, [device, device?.status, device?.jobId, push])

  // Heartbeat.
  useEffect(() => {
    if (!deviceId) return
    const iv = setInterval(() => {
      const d = latest.current.device
      if (!d) return
      const hb = heartbeat(d, latest.current.job)
      if (hb) push(hb.level, hb.text)
    }, 1100)
    return () => clearInterval(iv)
  }, [deviceId, push])

  return { lines, push }
}

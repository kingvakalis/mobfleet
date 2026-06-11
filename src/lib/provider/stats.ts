import { regionRate } from '@/data/regions'
import type { FleetSnapshot } from './types'

export interface FleetStats {
  /** Total devices in the pool. */
  total: number
  /** Online + no job. */
  idle: number
  busy: number
  /** Jobs awaiting a device. */
  queue: number
  /** Burn rate for all non-offline devices (USD/hr). */
  costPerHr: number
}

export function computeStats(s: FleetSnapshot): FleetStats {
  let idle = 0
  let busy = 0
  let costPerHr = 0

  for (const d of s.devices) {
    if (d.status === 'online') idle++
    else if (d.status === 'busy') busy++
    if (d.status !== 'offline') costPerHr += regionRate(d.region)
  }

  const queue = s.jobs.reduce((n, j) => (j.status === 'queued' ? n + 1 : n), 0)

  return {
    total: s.devices.length,
    idle,
    busy,
    queue,
    costPerHr: +costPerHr.toFixed(2),
  }
}

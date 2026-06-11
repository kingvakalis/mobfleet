import { REGIONS } from '@/data/regions'
import type { DeviceStatus } from '@/lib/status'
import type { Device, Job, TaskType } from './types'

const FLEET_SIZE = 40
const OS_VERSIONS = ['iOS 17.4.1', 'iOS 17.5.1', 'iOS 17.6', 'iOS 18.0', 'iOS 18.1.1']
const TASK_TYPES: TaskType[] = ['upload', 'warmup', 'engage', 'post']

/** Deterministic PRNG → the seeded constellation is stable across reloads. */
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T>(rng: () => number, arr: T[]): T => arr[Math.floor(rng() * arr.length)]
const int = (rng: () => number, min: number, max: number) =>
  Math.floor(rng() * (max - min + 1)) + min

function hexId(rng: () => number, len = 8): string {
  let s = ''
  for (let i = 0; i < len; i++) s += Math.floor(rng() * 16).toString(16)
  return s
}

/** Weighted initial status distribution for a believable live fleet. */
function seedStatus(rng: () => number): DeviceStatus {
  const r = rng()
  if (r < 0.5) return 'online' // idle
  if (r < 0.72) return 'busy'
  if (r < 0.84) return 'warming'
  if (r < 0.95) return 'offline'
  return 'error'
}

export interface SeedResult {
  devices: Device[]
  jobs: Job[]
  /** Next job sequence number for the provider to continue from. */
  jobSeq: number
}

export function seedFleet(now: number = Date.now()): SeedResult {
  const rng = mulberry32(0xc0ffee)
  const devices: Device[] = []
  const jobs: Job[] = []
  let jobSeq = 0
  const jid = () => `job-${String(++jobSeq).padStart(4, '0')}`

  for (let i = 0; i < FLEET_SIZE; i++) {
    const status = seedStatus(rng)
    const region = pick(rng, REGIONS).id
    const device: Device = {
      id: `ios-${hexId(rng)}`,
      status,
      region,
      osVersion: pick(rng, OS_VERSIONS),
      proxy: `10.${int(rng, 0, 9)}.${int(rng, 0, 255)}.${int(rng, 1, 254)}`,
      jobId: null,
      createdAt: now - int(rng, 60, 86_400) * 1000, // up to ~24h uptime
    }

    // Busy devices get a running job.
    if (status === 'busy') {
      const startedAt = now - int(rng, 5, 600) * 1000
      const job: Job = {
        id: jid(),
        deviceId: device.id,
        type: pick(rng, TASK_TYPES),
        status: 'running',
        progress: +(0.1 + rng() * 0.8).toFixed(2),
        createdAt: startedAt - 2000,
        startedAt,
        finishedAt: null,
        error: null,
      }
      device.jobId = job.id
      jobs.push(job)
    }

    devices.push(device)
  }

  // A few queued jobs (unassigned) → non-zero queue depth.
  for (let i = 0; i < int(rng, 3, 6); i++) {
    jobs.push({
      id: jid(),
      deviceId: null,
      type: pick(rng, TASK_TYPES),
      status: 'queued',
      progress: 0,
      createdAt: now - int(rng, 1, 120) * 1000,
      startedAt: null,
      finishedAt: null,
      error: null,
    })
  }

  // Some finished history for the jobs view.
  for (let i = 0; i < 12; i++) {
    const failed = rng() < 0.18
    const finishedAt = now - int(rng, 120, 7200) * 1000
    jobs.push({
      id: jid(),
      deviceId: pick(rng, devices).id,
      type: pick(rng, TASK_TYPES),
      status: failed ? 'failed' : 'succeeded',
      progress: failed ? +(rng()).toFixed(2) : 1,
      createdAt: finishedAt - int(rng, 30, 300) * 1000,
      startedAt: finishedAt - int(rng, 20, 280) * 1000,
      finishedAt,
      error: failed ? 'UPLOAD_TIMEOUT · proxy reset' : null,
    })
  }

  return { devices, jobs, jobSeq }
}

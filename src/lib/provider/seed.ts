import { REGIONS } from '@/data/regions'
import type { DeviceStatus } from '@/lib/status'
import type { Device, Job, Proxy, TaskType } from './types'

const FLEET_SIZE = 40
const PROXY_POOL = 52
const OS_VERSIONS = ['iOS 17.4.1', 'iOS 17.5.1', 'iOS 17.6', 'iOS 18.0', 'iOS 18.1.1']
const MODELS = ['iPhone SE', 'iPhone 11', 'iPhone 12', 'iPhone 13', 'iPhone 14']
const TASK_TYPES: TaskType[] = ['upload', 'warmup', 'engage', 'post']
const GROUPS = ['Carolina', 'Lucia', 'Warmup Pool', 'Instagram Farm', 'TikTok Farm', 'Backup']
const NAME_BASES = ['CAROLINA', 'LUCIA', 'WARMUP', 'IG FARM', 'TIKTOK', 'BACKUP']
const USERS = ['A. Rivera', 'M. Chen', 'K. Novak', 'S. Petrov', null, null]
const PROVIDERS = ['Bright Data', 'Soax', 'IPRoyal', 'Oxylabs']

/** Deterministic PRNG → the seeded fleet is stable across reloads. */
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

function seedStatus(rng: () => number): DeviceStatus {
  const r = rng()
  if (r < 0.5) return 'online'
  if (r < 0.72) return 'busy'
  if (r < 0.84) return 'warming'
  if (r < 0.95) return 'offline'
  return 'error'
}

export interface SeedResult {
  devices: Device[]
  jobs: Job[]
  proxies: Proxy[]
  jobSeq: number
}

export function seedFleet(now: number = Date.now()): SeedResult {
  const rng = mulberry32(0xc0ffee)

  // Proxy pool first — devices draw their exit IP from it.
  const proxies: Proxy[] = Array.from({ length: PROXY_POOL }, (_, i) => {
    const failing = i % 9 === 0
    return {
      ip: `10.0.${int(rng, 0, 255)}.${int(rng, 1, 254)}`,
      region: pick(rng, REGIONS).id,
      provider: pick(rng, PROVIDERS),
      assignedTo: null,
      status: failing ? 'failing' : 'unassigned',
      latency: failing ? 0 : int(rng, 28, 210),
      lastCheck: now - int(rng, 30, 600) * 1000,
    }
  })

  const devices: Device[] = []
  const jobs: Job[] = []
  let jobSeq = 0
  const jid = () => `job-${String(++jobSeq).padStart(4, '0')}`
  let proxyCursor = 0
  const nextProxy = (deviceId: string): string => {
    // hand out the next healthy spare proxy
    while (proxyCursor < proxies.length && proxies[proxyCursor].status !== 'unassigned') proxyCursor++
    const p = proxies[proxyCursor % proxies.length]
    p.assignedTo = deviceId
    p.status = 'healthy'
    proxyCursor++
    return p.ip
  }

  for (let i = 0; i < FLEET_SIZE; i++) {
    const status = seedStatus(rng)
    const region = pick(rng, REGIONS).id
    const base = NAME_BASES[i % NAME_BASES.length]
    const id = `ios-${hexId(rng)}`
    const device: Device = {
      id,
      name: `${base} ${Math.floor(i / NAME_BASES.length) + 1}`,
      status,
      region,
      osVersion: pick(rng, OS_VERSIONS),
      model: pick(rng, MODELS),
      proxy: nextProxy(id),
      battery: int(rng, 32, 100),
      group: pick(rng, GROUPS),
      assignedUser: pick(rng, USERS),
      jobId: null,
      createdAt: now - int(rng, 60, 86_400) * 1000,
    }

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

  for (let i = 0; i < 12; i++) {
    const failed = rng() < 0.18
    const finishedAt = now - int(rng, 120, 7200) * 1000
    jobs.push({
      id: jid(),
      deviceId: pick(rng, devices).id,
      type: pick(rng, TASK_TYPES),
      status: failed ? 'failed' : 'succeeded',
      progress: failed ? +rng().toFixed(2) : 1,
      createdAt: finishedAt - int(rng, 30, 300) * 1000,
      startedAt: finishedAt - int(rng, 20, 280) * 1000,
      finishedAt,
      error: failed ? 'UPLOAD_TIMEOUT · proxy reset' : null,
    })
  }

  return { devices, jobs, proxies, jobSeq }
}

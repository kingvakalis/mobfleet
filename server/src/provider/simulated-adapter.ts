import type {
  CreateDevicesOptions,
  Device,
  DeviceStatus,
  Job,
  Proxy,
  TaskSpec,
  TaskType,
} from '../../../src/shared/types'
import type { FleetStore } from '../fleet-store'
import type { DeviceProvider } from './device-provider'

const TICK_MS = 1800
const TASK_TYPES: TaskType[] = ['upload', 'warmup', 'engage', 'post']
const REGIONS = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-south-1', 'sa-east-1']
const MAX_HISTORY = 40

const rand = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
const hex = (len = 8) =>
  Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join('')

/**
 * The default, credential-free provider: a server-authoritative port of the
 * frontend mock simulation. Drives the FleetStore (which persists + broadcasts)
 * via a tick loop, and implements every lifecycle action locally.
 */
export class SimulatedDeviceAdapter implements DeviceProvider {
  private jobSeq = 0
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private store: FleetStore) {
    for (const j of store.listJobs()) {
      const n = Number(j.id.replace(/^job-/, ''))
      if (Number.isFinite(n) && n > this.jobSeq) this.jobSeq = n
    }
  }

  private nextJobId() {
    return `job-${String(++this.jobSeq).padStart(4, '0')}`
  }
  private makeJob(type: TaskType, now: number, deviceId: string | null): Job {
    const running = deviceId !== null
    return {
      id: this.nextJobId(), deviceId, type,
      status: running ? 'running' : 'queued',
      progress: running ? 0.02 : 0,
      createdAt: now, startedAt: running ? now : null, finishedAt: null, error: null,
    }
  }

  startLoop() {
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS)
  }
  stopLoop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  private tick() {
    const now = Date.now()
    const s = this.store
    s.runBatch(() => {
      // 1 · advance running jobs; finish some
      for (const j of s.listJobs()) {
        if (j.status !== 'running') continue
        const next = Math.min(1, j.progress + 0.08 + Math.random() * 0.12)
        if (next >= 1) {
          const failed = Math.random() < 0.12
          s.putJob({ ...j, progress: 1, status: failed ? 'failed' : 'succeeded', finishedAt: now, error: failed ? 'UPLOAD_TIMEOUT · proxy reset' : null })
          if (j.deviceId) {
            const d = s.getDevice(j.deviceId)
            if (d && d.jobId === j.id) s.putDevice({ ...d, status: 'online', jobId: null })
          }
        } else {
          s.putJob({ ...j, progress: +next.toFixed(2) })
        }
      }
      // 2 · warming → online
      for (const d of s.listDevices()) {
        if (d.status === 'warming' && Math.random() < 0.4) s.putDevice({ ...d, status: 'online' })
      }
      // 3 · assign one queued job to an idle device
      const queued = s.listJobs().find((j) => j.status === 'queued')
      const idle = queued && s.listDevices().find((d) => d.status === 'online')
      if (queued && idle) {
        s.putJob({ ...queued, status: 'running', deviceId: idle.id, startedAt: now, progress: 0.02 })
        s.putDevice({ ...idle, status: 'busy', jobId: queued.id })
      }
      // 4 · enqueue fresh work
      if (Math.random() < 0.5) s.putJob(this.makeJob(rand(TASK_TYPES), now, null))
      // 5 · spin a job on an idle device
      if (Math.random() < 0.4) {
        const d = s.listDevices().find((x) => x.status === 'online')
        if (d) { const job = this.makeJob(rand(TASK_TYPES), now, d.id); s.putJob(job); s.putDevice({ ...d, status: 'busy', jobId: job.id }) }
      }
      // 6 · rare fault + recovery
      if (Math.random() < 0.08) {
        const online = s.listDevices().filter((d) => d.status === 'online')
        if (online.length) { const v = rand(online); s.putDevice({ ...v, status: 'error' }) }
      }
      if (Math.random() < 0.25) {
        const errored = s.listDevices().filter((d) => d.status === 'error')
        if (errored.length) { const v = rand(errored); s.putDevice({ ...v, status: 'warming' }) }
      }
      // 7 · cap finished-job history
      const finished = s.listJobs().filter((j) => j.status === 'succeeded' || j.status === 'failed')
      if (finished.length > MAX_HISTORY) {
        const keep = new Set([...finished].sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0)).slice(0, MAX_HISTORY).map((j) => j.id))
        for (const j of finished) if (!keep.has(j.id)) s.removeJob(j.id)
      }
    })
  }

  // --- lifecycle ---------------------------------------------------------

  async createDevices(count: number, opts: CreateDevicesOptions = {}) {
    const now = Date.now()
    const made: Device[] = []
    this.store.runBatch(() => {
      for (let i = 0; i < count; i++) {
        const id = `ios-${hex()}`
        const region = opts.region ?? rand(REGIONS)
        const ip = `10.0.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`
        this.store.putProxy({ ip, region, provider: 'Bright Data', assignedTo: id, status: 'healthy', latency: 30 + Math.floor(Math.random() * 120), lastCheck: now })
        const device: Device = { id, name: `NEW ${hex(4).toUpperCase()}`, status: 'warming', region, osVersion: 'iOS 18.1.1', model: 'iPhone 14', proxy: ip, battery: 100, group: 'New', assignedUser: null, jobId: null, createdAt: now }
        this.store.putDevice(device)
        made.push(device)
      }
    })
    return made
  }

  async start(id: string) {
    const dev = this.store.getDevice(id)
    if (!dev) throw new Error(`Unknown device: ${id}`)
    const next = { ...dev, status: 'warming' as DeviceStatus }
    this.store.putDevice(next)
    return next
  }

  async stop(id: string) {
    const dev = this.store.getDevice(id)
    if (!dev) throw new Error(`Unknown device: ${id}`)
    this.store.runBatch(() => {
      if (dev.jobId) {
        const j = this.store.getJob(dev.jobId)
        if (j) this.store.putJob({ ...j, status: 'failed', finishedAt: Date.now(), error: 'DEVICE_STOPPED' })
      }
      this.store.putDevice({ ...dev, status: 'offline', jobId: null })
    })
    return this.store.getDevice(id)!
  }

  async delete(id: string) {
    const dev = this.store.getDevice(id)
    if (!dev) return
    this.store.runBatch(() => {
      if (dev.jobId) {
        const j = this.store.getJob(dev.jobId)
        if (j) this.store.putJob({ ...j, status: 'failed', finishedAt: Date.now(), error: 'DEVICE_RETIRED' })
      }
      const proxy = this.store.findProxyForDevice(id)
      if (proxy) this.store.putProxy({ ...proxy, assignedTo: null, status: 'unassigned' })
      this.store.removeDevice(id)
    })
  }

  async getStatus(id: string) {
    const dev = this.store.getDevice(id)
    if (!dev) throw new Error(`Unknown device: ${id}`)
    return dev.status
  }

  async runTask(id: string, task: TaskSpec) {
    const dev = this.store.getDevice(id)
    if (!dev) throw new Error(`Unknown device: ${id}`)
    const now = Date.now()
    const canRun = dev.status === 'online'
    const job = this.makeJob(task.type, now, canRun ? id : null)
    if (!canRun) job.deviceId = id
    this.store.runBatch(() => {
      this.store.putJob(job)
      if (canRun) this.store.putDevice({ ...dev, status: 'busy', jobId: job.id })
    })
    if (task.label) this.store.bumpAutomationRun(task.label)
    return job
  }

  async enqueueTask(task: TaskSpec) {
    const job = this.makeJob(task.type, Date.now(), null)
    this.store.putJob(job)
    if (task.label) this.store.bumpAutomationRun(task.label)
    return job
  }

  async retryJob(jobId: string) {
    const orig = this.store.getJob(jobId)
    if (!orig) throw new Error(`Unknown job: ${jobId}`)
    const now = Date.now()
    const dev = orig.deviceId ? this.store.getDevice(orig.deviceId) : undefined
    const canRun = dev?.status === 'online'
    const job = this.makeJob(orig.type, now, canRun ? dev!.id : null)
    if (!canRun && dev) job.deviceId = dev.id
    this.store.runBatch(() => {
      this.store.putJob(job)
      if (canRun && dev) this.store.putDevice({ ...dev, status: 'busy', jobId: job.id })
    })
    return job
  }

  async assignGroup(ids: string[], group: string) {
    const set = new Set(ids)
    this.store.runBatch(() => {
      for (const d of this.store.listDevices()) if (set.has(d.id)) this.store.putDevice({ ...d, group })
    })
  }

  async rotateProxy(deviceId: string) {
    const dev = this.store.getDevice(deviceId)
    if (!dev) throw new Error(`Unknown device: ${deviceId}`)
    const spare = this.store.spareProxy()
    if (!spare) return
    const now = Date.now()
    this.store.runBatch(() => {
      const old = this.store.findProxyForDevice(deviceId)
      if (old) this.store.putProxy({ ...old, assignedTo: null, status: 'unassigned' })
      this.store.putProxy({ ...spare, assignedTo: deviceId, status: 'healthy', lastCheck: now, latency: 30 + Math.floor(Math.random() * 120) })
      this.store.putDevice({ ...dev, proxy: spare.ip })
    })
  }

  async testProxy(ip: string) {
    const p = this.store.getProxy(ip)
    if (!p) throw new Error(`Unknown proxy: ${ip}`)
    const recovered = p.status === 'failing' ? Math.random() < 0.6 : true
    const status: Proxy['status'] = recovered ? (p.assignedTo ? 'healthy' : 'unassigned') : 'failing'
    const next: Proxy = { ...p, status, latency: status === 'failing' ? 0 : 28 + Math.floor(Math.random() * 200), lastCheck: Date.now() }
    this.store.putProxy(next)
    return next
  }
}

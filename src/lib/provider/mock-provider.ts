import { REGIONS } from '@/data/regions'
import { AUTOMATIONS } from '@/data/automations'
import { seedFleet } from './seed'
import type {
  AgentCommandAction,
  CreateDevicesOptions,
  Device,
  FleetSnapshot,
  Job,
  Proxy,
  ProviderClient,
  TaskSpec,
  TaskType,
} from './types'
import { controlCommandToWire, formatCommandLog, commandTypeForAction } from '@/shared/control-command'
import { createDeviceLogHub } from './device-log-hub'
import type { DeviceStatus } from '@/lib/status'

const TICK_MS = 1800
const TASK_TYPES: TaskType[] = ['upload', 'warmup', 'engage', 'post']
const MAX_HISTORY = 40

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const rand = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
const hex = (len = 8) =>
  Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join('')

/**
 * In-memory ProviderClient. Holds the fleet, applies immutable updates, and
 * runs a self-driving simulation (a stand-in WebSocket feed) so the UI looks
 * alive standalone. Swap this module's export for an HTTP client later.
 */
export function createMockProvider(): ProviderClient {
  const seed = seedFleet()
  let devices: Device[] = seed.devices
  let jobs: Job[] = seed.jobs
  let proxies: Proxy[] = seed.proxies
  let jobSeq = seed.jobSeq
  let ready = false
  let snapshot: FleetSnapshot = { devices, jobs, proxies, ts: Date.now(), ready }

  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setInterval> | null = null
  let bootTimer: ReturnType<typeof setTimeout> | null = null

  function commit() {
    snapshot = { devices, jobs, proxies, ts: Date.now(), ready }
    listeners.forEach((l) => l())
  }

  const nextJobId = () => `job-${String(++jobSeq).padStart(4, '0')}`
  const findDevice = (id: string) => devices.find((d) => d.id === id)

  // No agent in mock mode, so the provider itself echoes the command to the
  // device-log subscribers (the same role the server's command_log broadcast
  // plays in HTTP mode), keeping the Phone Control log alive standalone.
  const logHub = createDeviceLogHub()
  const logCommand = (deviceId: string, action: AgentCommandAction, payload?: Record<string, unknown>) =>
    logHub.emit(deviceId, { ts: Date.now(), text: formatCommandLog(action, payload), commandType: commandTypeForAction(action) })

  function makeJob(type: TaskType, now: number, deviceId: string | null): Job {
    const running = deviceId !== null
    return {
      id: nextJobId(),
      deviceId,
      type,
      status: running ? 'running' : 'queued',
      progress: running ? 0.02 : 0,
      createdAt: now,
      startedAt: running ? now : null,
      finishedAt: null,
      error: null,
    }
  }

  // ----------------------------------------------------------- simulation

  function tick() {
    const now = Date.now()
    let devs = devices
    let js = jobs

    // 1 · advance running jobs; finish some.
    js = js.map((j): Job => {
      if (j.status !== 'running') return j
      const next = Math.min(1, j.progress + 0.08 + Math.random() * 0.12)
      if (next >= 1) {
        const failed = Math.random() < 0.12
        return {
          ...j,
          progress: 1,
          status: failed ? 'failed' : 'succeeded',
          finishedAt: now,
          error: failed ? 'UPLOAD_TIMEOUT · proxy reset' : null,
        }
      }
      return { ...j, progress: +next.toFixed(2) }
    })

    // free devices whose job just finished this tick
    const freed = new Set(
      js
        .filter((j) => j.finishedAt === now && j.deviceId)
        .map((j) => j.deviceId as string),
    )
    if (freed.size) {
      devs = devs.map((d): Device =>
        freed.has(d.id) ? { ...d, status: 'online', jobId: null } : d,
      )
    }

    // 2 · warming → online
    devs = devs.map((d): Device =>
      d.status === 'warming' && Math.random() < 0.4 ? { ...d, status: 'online' } : d,
    )

    // 3 · assign one queued job to an idle device
    const queued = js.find((j) => j.status === 'queued')
    const idleForQueue = queued && devs.find((d) => d.status === 'online')
    if (queued && idleForQueue) {
      js = js.map((j): Job =>
        j.id === queued.id
          ? { ...j, status: 'running', deviceId: idleForQueue.id, startedAt: now, progress: 0.02 }
          : j,
      )
      devs = devs.map((d): Device =>
        d.id === idleForQueue.id ? { ...d, status: 'busy', jobId: queued.id } : d,
      )
    }

    // 4 · enqueue fresh work
    if (Math.random() < 0.5) js = [...js, makeJob(rand(TASK_TYPES), now, null)]

    // 5 · spin up a job directly on an idle device (busy churn)
    if (Math.random() < 0.4) {
      const idle = devs.find((d) => d.status === 'online')
      if (idle) {
        const job = makeJob(rand(TASK_TYPES), now, idle.id)
        js = [...js, job]
        devs = devs.map((d): Device =>
          d.id === idle.id ? { ...d, status: 'busy', jobId: job.id } : d,
        )
      }
    }

    // 6 · rare fault + recovery
    if (Math.random() < 0.08) {
      const online = devs.filter((d) => d.status === 'online')
      if (online.length) {
        const victim = rand(online)
        devs = devs.map((d): Device =>
          d.id === victim.id ? { ...d, status: 'error' } : d,
        )
      }
    }
    if (Math.random() < 0.25) {
      const errored = devs.filter((d) => d.status === 'error')
      if (errored.length) {
        const v = rand(errored)
        devs = devs.map((d): Device =>
          d.id === v.id ? { ...d, status: 'warming' } : d,
        )
      }
    }

    // 7 · cap history growth
    const finished = js.filter((j) => j.status === 'succeeded' || j.status === 'failed')
    if (finished.length > MAX_HISTORY) {
      const active = js.filter((j) => j.status === 'running' || j.status === 'queued')
      const keep = [...finished]
        .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
        .slice(0, MAX_HISTORY)
      js = [...active, ...keep]
    }

    // 8 · stamp a heartbeat + live telemetry on every non-offline device so the
    //     freshness indicators stay green; offline devices keep their old (now
    //     stale) heartbeat and read red. Mirrors the server simulator.
    devs = devs.map((d): Device =>
      d.status === 'offline'
        ? d
        : {
            ...d,
            lastHeartbeat: now,
            cpuUsage: +(d.status === 'busy' ? 55 + Math.random() * 40 : 8 + Math.random() * 32).toFixed(1),
            memoryUsage: +(30 + Math.random() * 45).toFixed(1),
            battery: Math.max(5, d.battery - (Math.random() < 0.1 ? 1 : 0)),
          },
    )

    devices = devs
    jobs = js
    commit()
  }

  // ----------------------------------------------------------- mutations

  async function start(id: string): Promise<Device> {
    await delay(140)
    const dev = findDevice(id)
    if (!dev) throw new Error(`Unknown device: ${id}`)
    devices = devices.map((d): Device =>
      d.id === id ? { ...d, status: 'warming' } : d,
    )
    commit()
    return findDevice(id)!
  }

  async function stop(id: string): Promise<Device> {
    await delay(140)
    const dev = findDevice(id)
    if (!dev) throw new Error(`Unknown device: ${id}`)
    if (dev.jobId) {
      jobs = jobs.map((j): Job =>
        j.id === dev.jobId
          ? { ...j, status: 'failed', finishedAt: Date.now(), error: 'DEVICE_STOPPED' }
          : j,
      )
    }
    devices = devices.map((d): Device =>
      d.id === id ? { ...d, status: 'offline', jobId: null } : d,
    )
    commit()
    return findDevice(id)!
  }

  // ----------------------------------------------------------- client

  return {
    async listDevices() {
      await delay(80)
      return devices
    },
    async getDevice(id) {
      await delay(40)
      return findDevice(id)
    },
    async getStatus(id) {
      await delay(40)
      const dev = findDevice(id)
      if (!dev) throw new Error(`Unknown device: ${id}`)
      return dev.status as DeviceStatus
    },

    async createDevices(count, opts: CreateDevicesOptions = {}) {
      await delay(200)
      const now = Date.now()
      const made: Device[] = []
      const newProxies: Proxy[] = []
      for (let i = 0; i < count; i++) {
        const id = `ios-${hex()}`
        const region = opts.region ?? rand(REGIONS).id
        const ip = `10.0.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`
        newProxies.push({
          ip,
          region,
          provider: 'Bright Data',
          assignedTo: id,
          status: 'healthy',
          latency: 30 + Math.floor(Math.random() * 120),
          lastCheck: now,
        })
        made.push({
          id,
          name: `NEW ${hex(4).toUpperCase()}`,
          status: 'warming',
          region,
          osVersion: 'iOS 18.1.1',
          model: 'iPhone 14',
          proxy: ip,
          battery: 100,
          group: 'New',
          assignedUser: null,
          jobId: null,
          createdAt: now,
        })
      }
      devices = [...devices, ...made]
      proxies = [...proxies, ...newProxies]
      commit()
      return made
    },

    async createPairingToken() {
      await delay(120)
      const pairingToken = crypto.randomUUID()
      // Mirror the HTTP provider's base (VITE_API_URL) so the QR points where a
      // real backend would live; fall back to this origin in pure-demo mode.
      const serverUrl = (import.meta.env.VITE_API_URL as string | undefined) || window.location.origin
      const expiresAt = Date.now() + 10 * 60 * 1000
      // Demo: simulate a device scanning the QR and claiming ~4s later, so the
      // new device streams into the dashboard in real-time exactly as a real
      // claim does over the WebSocket. (No backend in mock mode.)
      setTimeout(() => {
        const now = Date.now()
        const id = `dev-${hex(12)}`
        const device: Device = {
          id,
          name: `PAIRED ${hex(4).toUpperCase()}`,
          status: 'warming',
          region: rand(REGIONS).id,
          osVersion: 'iOS 18.2',
          model: 'iPhone 15',
          proxy: '',
          battery: 100,
          group: 'Unassigned',
          assignedUser: null,
          jobId: null,
          createdAt: now,
          udid: hex(40),
          platform: 'ios',
          lastHeartbeat: now,
        }
        devices = [...devices, device]
        commit()
      }, 4200)
      return { pairingToken, serverUrl, expiresAt }
    },

    start,
    stop,

    async delete(id) {
      await delay(160)
      const dev = findDevice(id)
      if (dev?.jobId) {
        jobs = jobs.map((j): Job =>
          j.id === dev.jobId
            ? { ...j, status: 'failed', finishedAt: Date.now(), error: 'DEVICE_RETIRED' }
            : j,
        )
      }
      if (dev) {
        // free its proxy back to the spare pool
        proxies = proxies.map((p): Proxy =>
          p.assignedTo === id ? { ...p, assignedTo: null, status: 'unassigned' } : p,
        )
      }
      devices = devices.filter((d) => d.id !== id)
      commit()
    },

    async assignGroup(ids, group) {
      await delay(120)
      const set = new Set(ids)
      devices = devices.map((d): Device => (set.has(d.id) ? { ...d, group } : d))
      commit()
    },

    async rotateProxy(deviceId) {
      await delay(160)
      const dev = findDevice(deviceId)
      if (!dev) throw new Error(`Unknown device: ${deviceId}`)
      const spare = proxies.find((p) => p.status === 'unassigned')
      if (!spare) return // pool exhausted
      const now = Date.now()
      proxies = proxies.map((p): Proxy => {
        if (p.assignedTo === deviceId) return { ...p, assignedTo: null, status: 'unassigned' }
        if (p.ip === spare.ip)
          return { ...p, assignedTo: deviceId, status: 'healthy', lastCheck: now, latency: 30 + Math.floor(Math.random() * 120) }
        return p
      })
      devices = devices.map((d): Device => (d.id === deviceId ? { ...d, proxy: spare.ip } : d))
      commit()
    },

    async sendCommand(deviceId, command) {
      // No agent in mock mode — acknowledge as queued so the UI flow is unchanged,
      // and echo a command-log entry to any device-log subscribers.
      await delay(120)
      if (!findDevice(deviceId)) throw new Error(`Unknown device: ${deviceId}`)
      logCommand(deviceId, command.action, command.payload)
      return { commandId: `mock-${hex(12)}`, status: 'pending' as const }
    },

    async sendControlCommand(command) {
      // Map the typed command to the wire shape (same path as HTTP), then echo a
      // log entry. Resolves on acceptance — never claims device execution.
      await delay(80)
      const wire = controlCommandToWire(command)
      if (!findDevice(wire.deviceId)) throw new Error(`Unknown device: ${wire.deviceId}`)
      logCommand(wire.deviceId, wire.action, wire.payload)
    },

    subscribeDeviceLogs(deviceId, callback) {
      return logHub.subscribe(deviceId, callback)
    },

    async listDeviceSessions() {
      // No session persistence in mock mode — matches the simulated provider's [].
      await delay(40)
      return []
    },

    async testProxy(ip) {
      await delay(140)
      const now = Date.now()
      let result: Proxy | undefined
      proxies = proxies.map((p): Proxy => {
        if (p.ip !== ip) return p
        const recovered = p.status === 'failing' ? Math.random() < 0.6 : true
        const status: Proxy['status'] = recovered ? (p.assignedTo ? 'healthy' : 'unassigned') : 'failing'
        result = {
          ...p,
          status,
          latency: status === 'failing' ? 0 : 28 + Math.floor(Math.random() * 200),
          lastCheck: now,
        }
        return result
      })
      commit()
      if (!result) throw new Error(`Unknown proxy: ${ip}`)
      return result
    },

    async runTask(id, task: TaskSpec) {
      await delay(120)
      const dev = findDevice(id)
      if (!dev) throw new Error(`Unknown device: ${id}`)
      const now = Date.now()
      const canRun = dev.status === 'online'
      const job = makeJob(task.type, now, canRun ? id : null)
      if (!canRun) job.deviceId = id // reserve the device; runs when free
      jobs = [...jobs, job]
      if (canRun) {
        devices = devices.map((d): Device =>
          d.id === id ? { ...d, status: 'busy', jobId: job.id } : d,
        )
      }
      commit()
      return job
    },

    async enqueueTask(task: TaskSpec) {
      await delay(120)
      const job = makeJob(task.type, Date.now(), null)
      jobs = [...jobs, job]
      commit()
      return job
    },

    async retryJob(jobId) {
      await delay(120)
      const orig = jobs.find((j) => j.id === jobId)
      if (!orig) throw new Error(`Unknown job: ${jobId}`)
      const now = Date.now()
      const dev = orig.deviceId ? findDevice(orig.deviceId) : undefined
      const canRun = dev?.status === 'online'
      const job = makeJob(orig.type, now, canRun ? dev!.id : null)
      if (!canRun && dev) job.deviceId = dev.id // reserve the original device
      jobs = [...jobs, job]
      if (canRun && dev) {
        devices = devices.map((d): Device =>
          d.id === dev.id ? { ...d, status: 'busy', jobId: job.id } : d,
        )
      }
      commit()
      return job
    },

    async listJobs() {
      await delay(80)
      return jobs
    },

    async listAutomations() {
      await delay(60)
      return AUTOMATIONS
    },

    subscribe(listener) {
      listeners.add(listener)
      if (listeners.size === 1) {
        if (!timer) timer = setInterval(tick, TICK_MS)
        // Simulate the provider uplink handshake before the fleet is "live".
        if (!ready && !bootTimer) {
          bootTimer = setTimeout(() => {
            ready = true
            bootTimer = null
            commit()
          }, 700)
        }
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          if (timer) {
            clearInterval(timer)
            timer = null
          }
          // Also cancel a still-pending boot handshake — otherwise it would fire
          // commit() after every listener has detached (a timer leak that, in
          // dev StrictMode's mount/unmount cycle, runs against a dead store).
          if (bootTimer) {
            clearTimeout(bootTimer)
            bootTimer = null
          }
        }
      }
    },

    getSnapshot() {
      return snapshot
    },
  }
}

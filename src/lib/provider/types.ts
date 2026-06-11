import type { DeviceStatus } from '@/lib/status'

export type { DeviceStatus }

/** Kinds of content-upload work dispatched to a phone. */
export type TaskType = 'upload' | 'warmup' | 'engage' | 'post'

export interface TaskSpec {
  type: TaskType
  /** Human label shown in the jobs table. */
  label?: string
  /** Opaque payload (content ref, target account, …) — provider-defined. */
  payload?: Record<string, unknown>
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export interface Job {
  id: string
  /** Device the job runs on; null while still queued. */
  deviceId: string | null
  type: TaskType
  status: JobStatus
  /** 0..1 */
  progress: number
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  error: string | null
}

export interface Device {
  id: string
  status: DeviceStatus
  /** Region id, see data/regions. */
  region: string
  osVersion: string
  /** Proxy/exit IP. */
  proxy: string
  /** Current job id, or null when idle. */
  jobId: string | null
  /** Provision time (epoch ms) — uptime is derived from this. */
  createdAt: number
}

/** Immutable point-in-time view of the fleet, pushed to subscribers. */
export interface FleetSnapshot {
  devices: Device[]
  jobs: Job[]
  ts: number
  /** False during the initial uplink handshake, then true. */
  ready: boolean
}

export interface CreateDevicesOptions {
  region?: string
}

/**
 * The single seam between the UI and the backend. Today it's an in-memory
 * mock; later, point it at the real provider API without touching the UI.
 */
export interface ProviderClient {
  listDevices(): Promise<Device[]>
  getDevice(id: string): Promise<Device | undefined>
  getStatus(id: string): Promise<DeviceStatus>
  createDevices(count: number, opts?: CreateDevicesOptions): Promise<Device[]>
  start(id: string): Promise<Device>
  stop(id: string): Promise<Device>
  delete(id: string): Promise<void>
  runTask(id: string, task: TaskSpec): Promise<Job>
  /** Queue a task with no fixed device; the scheduler assigns it to an idle one. */
  enqueueTask(task: TaskSpec): Promise<Job>
  /** Re-dispatch a finished job's task (on its device if free, else queued). */
  retryJob(jobId: string): Promise<Job>
  listJobs(): Promise<Job[]>

  /** Live feed: device + job updates. Returns an unsubscribe fn. */
  subscribe(listener: () => void): () => void
  /** Current snapshot (stable reference until state changes). */
  getSnapshot(): FleetSnapshot
}

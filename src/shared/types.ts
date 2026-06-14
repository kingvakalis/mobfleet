/**
 * SHARED domain contract — imported by BOTH the React client and the Node
 * server. Alias-free (no `@/` imports) so the server can compile it without
 * the Vite path alias. This is the single source of truth for the fleet model
 * and the ProviderClient interface the UI talks to.
 */

export type DeviceStatus = 'online' | 'busy' | 'warming' | 'offline' | 'error'

export type TaskType = 'upload' | 'warmup' | 'engage' | 'post'

export interface TaskSpec {
  type: TaskType
  label?: string
  payload?: Record<string, unknown>
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export interface Job {
  id: string
  deviceId: string | null
  type: TaskType
  status: JobStatus
  progress: number
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  error: string | null
  /** Run configuration — maps to the Supabase `automation_jobs.config` jsonb. */
  config?: Record<string, unknown>
}

export type ProxyStatus = 'healthy' | 'failing' | 'unassigned'

export interface Proxy {
  ip: string
  region: string
  provider: string
  assignedTo: string | null
  status: ProxyStatus
  latency: number
  lastCheck: number
}

export interface Device {
  id: string
  name: string
  status: DeviceStatus
  region: string
  osVersion: string
  model: string
  proxy: string
  battery: number
  group: string
  assignedUser: string | null
  jobId: string | null
  createdAt: number
  // ── Infra identity — maps to the Supabase `devices` schema. Optional in this
  //    presentation-focused model (the demo UI uses region/model/battery/group;
  //    the SQL table is the canonical persistence shape). ──
  /** Hardware unique device id (e.g. iOS UDID). */
  udid?: string
  /** Device OS family — 'ios' | 'android'. */
  platform?: string
  /** The device's own IP on the control network. */
  ipAddress?: string
  /** WebDriverAgent port used to drive the device. */
  wdaPort?: number
  /** Last agent heartbeat (epoch ms), or null if never seen. */
  lastHeartbeat?: number | null
}

export interface FleetSnapshot {
  devices: Device[]
  jobs: Job[]
  proxies: Proxy[]
  ts: number
  ready: boolean
}

export interface CreateDevicesOptions {
  region?: string
}

/** A reusable automation flow run across devices (persisted server-side). */
export interface Automation {
  id: string
  name: string
  description: string
  taskType: TaskType
  successRate: number
  runs: number
  lastRun: string
}

/**
 * The single seam between the UI and the backend. Implemented by the in-memory
 * mock (createMockProvider) and the HTTP+WS client (createHttpProvider).
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
  enqueueTask(task: TaskSpec): Promise<Job>
  retryJob(jobId: string): Promise<Job>
  listJobs(): Promise<Job[]>
  listAutomations(): Promise<Automation[]>
  assignGroup(ids: string[], group: string): Promise<void>
  rotateProxy(deviceId: string): Promise<void>
  testProxy(ip: string): Promise<Proxy>
  subscribe(listener: () => void): () => void
  getSnapshot(): FleetSnapshot
}

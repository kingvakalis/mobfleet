/**
 * SHARED domain contract — imported by BOTH the React client and the Node
 * server. Alias-free (no `@/` imports) so the server can compile it without
 * the Vite path alias. This is the single source of truth for the fleet model
 * and the ProviderClient interface the UI talks to.
 */

export type DeviceStatus = 'online' | 'busy' | 'warming' | 'offline' | 'error'

/** Actions the hardware agent can run on a device (mirrors the agent + server
 *  command schema). Queued via ProviderClient.sendCommand. `back`/`switcher` are
 *  the navigation keys driven by the live Phone Control surface. */
export type AgentCommandAction =
  | 'screenshot' | 'tap' | 'swipe' | 'type' | 'home' | 'back' | 'lock' | 'unlock' | 'switcher' | 'launch' | 'install' | 'reboot'

/** Result of queueing a command (POST /v1/agent/command). */
export interface QueuedCommand {
  commandId: string
  status: 'pending' | 'delivered' | 'acked' | 'failed'
}

/**
 * A strict, typed operator control command for the live Phone Control surface.
 * The UI builds these; controlCommandToWire() (shared/control-command.ts) maps
 * each to the existing {action,payload} agent-command wire format
 * (POST /v1/agent/command), so this adds type-safety WITHOUT a second command
 * channel. The discriminant is `type`; fields are never widened to arbitrary
 * strings. `key` maps to the home/back/lock/switcher actions.
 */
export type ControlCommand =
  | { type: 'tap'; deviceId: string; x: number; y: number }
  | { type: 'swipe'; deviceId: string; dir: 'up' | 'down' | 'left' | 'right'; x1?: number; y1?: number; x2?: number; y2?: number; durationMs?: number; scroll?: boolean }
  | { type: 'key'; deviceId: string; key: 'home' | 'back' | 'lock' | 'switcher' }
  | { type: 'launch_app'; deviceId: string; appName: string }
  | { type: 'screenshot'; deviceId: string }
  | { type: 'type_text'; deviceId: string; text: string }

/** One human-readable command-log line for a device, streamed to operators over
 *  the live socket (CommandLogFrame). Never contains typed text — only a count. */
export interface DeviceCommandLogEntry {
  ts: number
  text: string
  commandType?: ControlCommand['type']
  success?: boolean
}

/** Server → browser frame carrying a single command-log entry for a device
 *  (broadcast team-scoped over the existing /ws socket — never a second socket). */
export type CommandLogFrame = {
  type: 'command_log'
  deviceId: string
  entry: DeviceCommandLogEntry
}

/** A past control session for a device (history surface). No session table
 *  exists yet, so the sessions endpoint returns [] today (see routes.ts). */
export interface DeviceSessionRecord {
  id: string
  deviceId: string
  startedAt: number
  endedAt: number | null
  durationMs?: number | null
  userId?: string | null
  userName?: string | null
  /** Device-agent version for this connection session, if the agent reported one. */
  agentVersion?: string | null
}

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
  /** Last reported CPU utilisation, 0–100 (%), or null if unknown. */
  cpuUsage?: number | null
  /** Last reported memory utilisation, 0–100 (%), or null if unknown. */
  memoryUsage?: number | null
}

/**
 * A device → server heartbeat. A device agent emits one every
 * HEARTBEAT_INTERVAL_MS over the live WebSocket; the server stamps
 * `lastHeartbeat` with the receipt time and merges the reported telemetry into
 * the device row (see shared/heartbeat.ts). Every field except `deviceId` is
 * optional so an agent can report only what it knows.
 */
export interface Heartbeat {
  deviceId: string
  status?: DeviceStatus
  /** Battery charge, 0–100 (%). */
  battery?: number
  /** CPU utilisation, 0–100 (%). */
  cpuUsage?: number
  /** Memory utilisation, 0–100 (%). */
  memoryUsage?: number
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

/** A freshly minted device-pairing token (shown to the user as a QR). */
export interface PairingToken {
  /** UUID the device presents to POST /v1/devices/claim. */
  pairingToken: string
  /** Base URL of the server that hosts the claim endpoint (goes in the QR). */
  serverUrl: string
  /** Epoch ms when the token expires (default: minted + 10 min). */
  expiresAt: number
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
  /** Mint a device-pairing token for the active team (QR provisioning flow). */
  createPairingToken(): Promise<PairingToken>
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
  /** Queue a command for a device's agent (reboot, screenshot, lock, …). */
  sendCommand(
    deviceId: string,
    command: { action: AgentCommandAction; payload?: Record<string, unknown> },
  ): Promise<QueuedCommand>
  /** Send a strict, typed operator control command (tap/swipe/key/launch/…).
   *  Resolves once the command is ACCEPTED by the server (queued) — NOT when the
   *  device has executed it. Reuses the same durable queue as sendCommand. */
  sendControlCommand(command: ControlCommand): Promise<void>
  /** Subscribe to a device's command-log stream (delivered over the existing
   *  live socket). Returns an unsubscribe; isolated per deviceId. */
  subscribeDeviceLogs(deviceId: string, callback: (entry: DeviceCommandLogEntry) => void): () => void
  /** Recent control sessions for a device (newest first). [] when no session
   *  history is persisted (e.g. the simulated provider). */
  listDeviceSessions(deviceId: string): Promise<DeviceSessionRecord[]>
  subscribe(listener: () => void): () => void
  getSnapshot(): FleetSnapshot
}

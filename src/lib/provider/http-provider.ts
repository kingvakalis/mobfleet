import type {
  Automation,
  CreateDevicesOptions,
  Device,
  DeviceSessionRecord,
  DeviceStatus,
  FleetSnapshot,
  Job,
  PairingToken,
  ProviderClient,
  Proxy,
  QueuedCommand,
  TaskSpec,
} from '@/shared/types'
import { controlCommandToWire } from '@/shared/control-command'
import { commandLogFrameSchema } from '@/shared/schemas'
import { getActiveTeam, getAuthToken, onAuthChange } from './auth-token'
import { createDeviceLogHub } from './device-log-hub'

const API_BASE = import.meta.env.VITE_API_URL ?? '' // '' → relative (dev Vite proxy)
const WS_BASE = import.meta.env.VITE_WS_URL ?? ''

function wsUrl(): string {
  const base = WS_BASE
    ? `${WS_BASE.replace(/\/$/, '')}/ws`
    : `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`
  // Browsers can't set headers on a WS upgrade → pass auth via the query.
  const params = new URLSearchParams()
  const token = getAuthToken()
  const team = getActiveTeam()
  if (token) params.set('token', token)
  if (team) params.set('teamId', team)
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}

/** Auth headers applied to every REST call (bearer token + active team). */
function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {}
  const token = getAuthToken()
  const team = getActiveTeam()
  if (token) h.Authorization = `Bearer ${token}`
  if (team) h['x-team-id'] = team
  return h
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + path, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(init?.headers as Record<string, string> | undefined) },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

const EMPTY: FleetSnapshot = { devices: [], jobs: [], proxies: [], ts: 0, ready: false }

/**
 * The real ProviderClient: REST for commands, a WebSocket for the live feed.
 *
 * CRITICAL: getSnapshot() returns a STABLE reference between WS pushes (the
 * `snapshot` var is reassigned ONLY when a new frame arrives). This is exactly
 * what React's useSyncExternalStore requires — returning a fresh object per
 * call would tear or infinite-loop. Mirrors the mock provider's store shape so
 * the UI is byte-for-byte unchanged.
 */
export function createHttpProvider(): ProviderClient {
  let snapshot: FleetSnapshot = EMPTY
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((l) => l())
  // Per-device command-log subscribers — fed by 'command_log' frames on the SAME
  // socket as snapshots (no second connection). Survives reconnects: the map is
  // owned by the provider, not the socket.
  const logHub = createDeviceLogHub()

  let socket: WebSocket | null = null
  let started = false
  let backoff = 500

  const connect = () => {
    socket = new WebSocket(wsUrl())
    socket.onopen = () => {
      backoff = 500
    }
    socket.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string) as { type?: string }
        // Existing fleet-snapshot behavior — unchanged.
        if (msg.type === 'snapshot' && (msg as { payload?: FleetSnapshot }).payload) {
          snapshot = (msg as { payload: FleetSnapshot }).payload // new reference → notify
          emit()
        } else if (msg.type === 'command_log') {
          // Validate the frame before fanning it out to that device's subscribers.
          const parsed = commandLogFrameSchema.safeParse(msg)
          if (parsed.success) logHub.emit(parsed.data.deviceId, parsed.data.entry)
        }
      } catch {
        /* ignore malformed frame */
      }
    }
    socket.onclose = () => {
      if (started) {
        setTimeout(connect, backoff)
        backoff = Math.min(backoff * 2, 10_000)
      }
    }
    socket.onerror = () => {
      try {
        socket?.close()
      } catch {
        /* noop */
      }
    }
  }

  // When the user logs in / switches team, drop the socket so it reconnects
  // with the new credentials (onclose → reconnect picks up the new token).
  onAuthChange(() => {
    if (started && socket) {
      try {
        socket.close()
      } catch {
        /* noop */
      }
    }
  })

  return {
    subscribe(listener) {
      listeners.add(listener)
      if (!started) {
        started = true
        connect()
      }
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot() {
      return snapshot
    },

    listDevices: () => api<Device[]>('/v1/devices'),
    async getDevice(id) {
      try {
        return await api<Device>(`/v1/devices/${id}`)
      } catch {
        return undefined
      }
    },
    async getStatus(id) {
      const r = await api<{ status: DeviceStatus }>(`/v1/devices/${id}/status`)
      return r.status
    },
    createDevices: (count, opts?: CreateDevicesOptions) =>
      api<Device[]>('/v1/devices', { method: 'POST', body: JSON.stringify({ count, region: opts?.region }) }),
    createPairingToken: () => api<PairingToken>('/v1/devices/pair', { method: 'POST' }),
    start: (id) => api<Device>(`/v1/devices/${id}/start`, { method: 'POST' }),
    stop: (id) => api<Device>(`/v1/devices/${id}/stop`, { method: 'POST' }),
    async delete(id) {
      await api(`/v1/devices/${id}`, { method: 'DELETE' })
    },
    runTask: (id, task: TaskSpec) =>
      api<Job>(`/v1/devices/${id}/task`, { method: 'POST', body: JSON.stringify(task) }),
    enqueueTask: (task) => api<Job>('/v1/tasks', { method: 'POST', body: JSON.stringify(task) }),
    retryJob: (jobId) => api<Job>(`/v1/jobs/${jobId}/retry`, { method: 'POST' }),
    listJobs: () => api<Job[]>('/v1/jobs'),
    listAutomations: () => api<Automation[]>('/v1/automations'),
    async assignGroup(ids, group) {
      await api('/v1/groups/assign', { method: 'POST', body: JSON.stringify({ ids, group }) })
    },
    async rotateProxy(deviceId) {
      await api(`/v1/devices/${deviceId}/proxy/rotate`, { method: 'POST' })
    },
    testProxy: (ip) => api<Proxy>(`/v1/proxies/${ip}/test`, { method: 'POST' }),
    sendCommand: (deviceId, command) =>
      api<QueuedCommand>('/v1/agent/command', {
        method: 'POST',
        body: JSON.stringify({ deviceId, action: command.action, payload: command.payload }),
      }),
    // Typed control command → the SAME durable queue (POST /v1/agent/command).
    // Resolves once the server accepts (queues) it; the command_log frame the
    // server broadcasts back over /ws is the device-facing record (not faked here).
    async sendControlCommand(command) {
      await api<QueuedCommand>('/v1/agent/command', {
        method: 'POST',
        body: JSON.stringify(controlCommandToWire(command)),
      })
    },
    subscribeDeviceLogs(deviceId, callback) {
      return logHub.subscribe(deviceId, callback)
    },
    async listDeviceSessions(deviceId) {
      const r = await api<{ sessions: DeviceSessionRecord[] }>(`/v1/devices/${deviceId}/sessions`)
      return r.sessions
    },
  }
}

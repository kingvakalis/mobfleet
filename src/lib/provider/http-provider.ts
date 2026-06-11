import type {
  CreateDevicesOptions,
  Device,
  DeviceStatus,
  FleetSnapshot,
  Job,
  ProviderClient,
  Proxy,
  TaskSpec,
} from '@/shared/types'

const API_BASE = import.meta.env.VITE_API_URL ?? '' // '' → relative (dev Vite proxy)
const WS_BASE = import.meta.env.VITE_WS_URL ?? ''

function wsUrl(): string {
  if (WS_BASE) return `${WS_BASE.replace(/\/$/, '')}/ws`
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/ws`
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...init,
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
        const msg = JSON.parse(e.data as string) as { type?: string; payload?: FleetSnapshot }
        if (msg.type === 'snapshot' && msg.payload) {
          snapshot = msg.payload // new reference → notify
          emit()
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
    async assignGroup(ids, group) {
      await api('/v1/groups/assign', { method: 'POST', body: JSON.stringify({ ids, group }) })
    },
    async rotateProxy(deviceId) {
      await api(`/v1/devices/${deviceId}/proxy/rotate`, { method: 'POST' })
    },
    testProxy: (ip) => api<Proxy>(`/v1/proxies/${ip}/test`, { method: 'POST' }),
  }
}

import { getActiveTeam, getAuthToken } from '@/lib/provider/auth-token'
import { ApiError } from '@/services/email-settings'
import type { Proxy } from '@/shared/types'

/**
 * Proxy registry client — `GET /v1/proxies` (perm `phones.view`) and
 * `POST /v1/proxies/:ip/test` (perm `phones.control`). Mirrors the authenticated
 * fetch pattern used by services/me-client.ts + services/email-settings.ts
 * (Bearer token + x-team-id from the provider token-seam) and reuses their
 * `ApiError` so callers can branch on the HTTP status.
 *
 * NOTE: proxies also arrive on the live `FleetSnapshot.proxies` over the WS
 * stream (when VITE_USE_BACKEND is set). This client is the explicit
 * REST surface for the dedicated Proxies page — a deliberate fetch + the
 * per-row connectivity test — independent of the snapshot tick.
 */
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

export { ApiError }
export type { Proxy }

async function proxyApi<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken()
  const team = getActiveTeam()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (team) headers['x-team-id'] = team
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** Fetch the workspace proxy registry. Server gates on `phones.view`. */
export const fetchProxies = (): Promise<Proxy[]> => proxyApi<Proxy[]>('/v1/proxies')

/** Run a connectivity test against one proxy. Server gates on `phones.control`.
 *  Returns the re-checked proxy (fresh status + latency + lastCheck). */
export const testProxy = (ip: string): Promise<Proxy> =>
  proxyApi<Proxy>(`/v1/proxies/${encodeURIComponent(ip)}/test`, { method: 'POST' })

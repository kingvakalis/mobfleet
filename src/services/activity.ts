import { getActiveTeam, getAuthToken } from '@/lib/provider/auth-token'
import { ApiError } from '@/services/email-settings'

/**
 * Activity / security-audit read client — `GET /v1/activity` (cursor-paginated,
 * newest-first, team-scoped, `activity.view_security`). This is the authoritative
 * audit source for the Security Audit view in "me"-mode; it replaces the local
 * session-only Zustand store on the authenticated path. Mirrors the Bearer +
 * x-team-id fetch pattern; reuses ApiError so the UI can show a 403 distinctly.
 */
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

export { ApiError }

/** One audit row. `action` is a backend dotted name (e.g. `role.change`,
 *  `invite.accept`); `result` is `allowed` | `denied`. `createdAt` is epoch ms. */
export interface ActivityItem {
  id: string
  createdAt: number
  action: string
  target: string | null
  result: string
  detail: string | null
  actorId: string
  actorEmail: string | null
  actorName: string | null
}

export interface ActivityPage {
  items: ActivityItem[]
  nextCursor: string | null
}

export async function fetchActivity(opts: { cursor?: string | null; limit?: number } = {}): Promise<ActivityPage> {
  const token = getAuthToken()
  const team = getActiveTeam()
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (team) headers['x-team-id'] = team
  const params = new URLSearchParams()
  if (opts.limit) params.set('limit', String(opts.limit))
  if (opts.cursor) params.set('cursor', opts.cursor)
  const qs = params.toString()
  const res = await fetch(`${API_BASE}/v1/activity${qs ? `?${qs}` : ''}`, { headers })
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(res.status, b.error ?? `HTTP ${res.status}`)
  }
  return (await res.json()) as ActivityPage
}

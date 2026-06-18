import { getActiveTeam, getAuthToken } from '@/lib/provider/auth-token'
import { buildEmailSettingsUpdate, type UpdateTeamEmailSettingsRequest } from '@/services/email-settings-request'
import type { EmailPreferences } from '@/lib/email/preferences'

// Re-export the pure request-builder (defined import-free for engine tests).
export { buildEmailSettingsUpdate }
export type { UpdateTeamEmailSettingsRequest }

/**
 * Team email-sender settings API client (GET/POST /v1/settings/email).
 *
 * Mirrors the authenticated fetch pattern used by services/team.ts (Bearer token
 * + x-team-id from the provider token-seam). The server is authoritative for
 * sender name/email + whether a Resend key is configured (and its last 4 chars);
 * the full key is NEVER returned, and is never persisted on the client.
 */
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

export interface SafeEmailSettings {
  senderEmail: string
  senderName: string
  hasResendApiKey: boolean
  resendApiKeyLast4: string | null
  resendApiKeyMasked?: string | null
  updatedAt: string
}

export interface TeamEmailSettingsResponse {
  settings: SafeEmailSettings | null
  defaults?: { senderEmail: string; senderName: string }
  /** Team-wide transactional email preferences (server-normalized; defaults when
   *  the team's notificationPrefs column is NULL). */
  preferences: EmailPreferences
}

export interface UpdateTeamEmailSettingsResponse {
  settings: SafeEmailSettings
  preferences?: EmailPreferences
}

export interface EmailPreferencesResponse {
  preferences: EmailPreferences
}

/** Error that carries the HTTP status so the UI can distinguish 403 (permission)
 *  from 400 (validation) and other failures. */
export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

async function emailApi<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken()
  const team = getActiveTeam()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (team) headers['x-team-id'] = team
  const res = await fetch(`${API_BASE}${path}`, {
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

export const fetchEmailSettings = (): Promise<TeamEmailSettingsResponse> =>
  emailApi<TeamEmailSettingsResponse>('/v1/settings/email')

export const saveEmailSettings = (body: UpdateTeamEmailSettingsRequest): Promise<UpdateTeamEmailSettingsResponse> =>
  emailApi<UpdateTeamEmailSettingsResponse>('/v1/settings/email', { method: 'POST', body: JSON.stringify(body) })

/** Persist a transactional email-preference patch (no sender-config change).
 *  Works even when the team has no sender row (prefs live on Team). Server returns
 *  the full normalized preferences. Only invite + welcome are surfaced by the UI;
 *  password-reset delivery is owned by Supabase and is not toggled here. */
export const saveEmailPreferences = (patch: Partial<EmailPreferences>): Promise<EmailPreferencesResponse> =>
  emailApi<EmailPreferencesResponse>('/v1/settings/email/preferences', { method: 'POST', body: JSON.stringify(patch) })

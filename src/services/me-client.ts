import { getActiveTeam, getAuthToken } from '@/lib/provider/auth-token'
import { ApiError } from '@/services/email-settings'

/**
 * Authoritative identity/team client — `GET /v1/me` and `POST /v1/onboarding/team`
 * (Prisma-backed, identity-only auth). Mirrors the authenticated fetch pattern used by
 * services/email-settings.ts (Bearer token + x-team-id from the provider token-seam),
 * and reuses its `ApiError` so callers can branch on the HTTP status (401/403/409/500).
 *
 * NOTE on the two id spaces: `team.id` here is the PRISMA team id (`team_<uuid>`), which
 * is NOT a Supabase id and must never be fed to a Supabase query. It is used only for the
 * gate/role and as the backend `x-team-id` (see AuthzContext + the Step 2 plan).
 */
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

export { ApiError }

export interface MeUser {
  id: string
  email: string
}
export interface MeProfile {
  id: string
  displayName: string | null
}
export interface MeMembershipSummary {
  id: string
  teamId: string
  role: string
  status: string
}
export interface MeTeam {
  id: string
  name: string
}
export interface MePendingInvite {
  id: string
  teamId: string
  teamName: string
  role: string
}

/** The authoritative post-login state. DB/identity errors surface as 5xx (an ApiError),
 *  NEVER as `onboardingRequired` — the gate must treat a failure as retryable, not "no team". */
export interface MeResponse {
  user: MeUser
  profile: MeProfile
  membership: MeMembershipSummary | null
  team: MeTeam | null
  role: string | null
  permissions: string[]
  onboardingRequired: boolean
  suspended: boolean
  pendingInvite: MePendingInvite | null
}

export interface OnboardingTeamResponse {
  team: MeTeam
  membership: MeMembershipSummary
}

async function meApi<T>(path: string, init?: RequestInit): Promise<T> {
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

export const fetchMe = (): Promise<MeResponse> => meApi<MeResponse>('/v1/me')

/** Deliberately create this user's FIRST team (as owner) via the authoritative backend.
 *  Idempotent (adopts an existing/concurrent team). 409 = a pending Prisma invite. */
export const createOnboardingTeam = (name: string): Promise<OnboardingTeamResponse> =>
  meApi<OnboardingTeamResponse>('/v1/onboarding/team', { method: 'POST', body: JSON.stringify({ name }) })

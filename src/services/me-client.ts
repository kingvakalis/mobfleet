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
/** One workspace the caller belongs to — projected from a membership for the team
 *  switcher. `current` marks the selected team; `status` distinguishes active
 *  (switchable) from suspended. Mirrors the backend `MeTeamSummary` exactly. */
export interface MeTeamSummary {
  teamId: string
  name: string
  role: string
  status: string
  membershipId: string
  current: boolean
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
  /** The IdP account's email-verified flag — the invite-accept gate depends on it. */
  emailVerified: boolean
  /** The caller's full switchable-team roster (every team they belong to, with their
   *  role + status there; `current` marks the selected one). Active-status entries are
   *  the ones a deliberate switch will accept. */
  teams: MeTeamSummary[]
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

/** DELIBERATELY switch the active team. The server validates `teamId` against the
 *  caller's own ACTIVE memberships and recomputes role + permissions — it REJECTS
 *  (403) a foreign/suspended/removed team instead of silently falling back, so the
 *  client is never switched somewhere it didn't ask for. Returns the fresh /v1/me. */
export const switchTeam = (teamId: string): Promise<MeResponse> =>
  meApi<MeResponse>('/v1/me/team', { method: 'POST', body: JSON.stringify({ teamId }) })

/** Deliberately create this user's FIRST team (as owner) via the authoritative backend.
 *  Idempotent (adopts an existing/concurrent team). 409 = a pending Prisma invite. */
export const createOnboardingTeam = (name: string): Promise<OnboardingTeamResponse> =>
  meApi<OnboardingTeamResponse>('/v1/onboarding/team', { method: 'POST', body: JSON.stringify({ name }) })

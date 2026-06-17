import { getActiveTeam, getAuthToken } from '@/lib/provider/auth-token'
import { ApiError } from '@/services/email-settings'

/**
 * Prisma-authoritative invitation client — `POST /v1/invites/inspect` (public
 * pre-accept preview) and `POST /v1/invites/accept` (identity-auth redeem). This is
 * the authoritative ("me"-mode) invite path: acceptance writes the membership + invite
 * state transactionally against the SAME Prisma team, with NO Supabase accept_invite
 * RPC for business state. The legacy Supabase RPC path remains only for supabase-mode
 * (see pages/invite.tsx). Mirrors the Bearer + x-team-id fetch pattern of the other
 * services; reuses ApiError so callers can branch on the HTTP status.
 */
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

export { ApiError }

export type InviteInspection =
  | { valid: true; teamName: string; role: string; expiresAt: number }
  | { valid: false }

export interface AcceptInviteResult {
  ok: true
  teamId: string
  teamName?: string
  role: string
}

async function invitesApi<T>(path: string, body: unknown): Promise<T> {
  const token = getAuthToken()
  const team = getActiveTeam()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (team) headers['x-team-id'] = team
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(res.status, b.error ?? `HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

/** Read-only pre-accept preview by token (public; the token is the credential).
 *  Returns { valid: false } for an unknown/expired/revoked/accepted token. */
export const inspectInvite = (token: string): Promise<InviteInspection> =>
  invitesApi<InviteInspection>('/v1/invites/inspect', { token })

/** Redeem an invite for the authenticated identity. Idempotent server-side; the
 *  invite email must match the verified identity (a leaked token can't be redeemed
 *  by someone else). 403 = unverified / email-mismatch; 400 = invalid/expired/used. */
export const acceptInvite = (token: string): Promise<AcceptInviteResult> =>
  invitesApi<AcceptInviteResult>('/v1/invites/accept', { token })

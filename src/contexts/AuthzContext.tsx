import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { setActiveTeam } from '@/lib/provider/auth-token'
import { AUTH_SOURCE } from '@/auth/auth-source'
import { ApiError, fetchMe, switchTeam as switchTeamApi, type MeResponse, type MeTeamSummary } from '@/services/me-client'

/**
 * Authoritative identity/team state from the backend `GET /v1/me` (Prisma). This is the
 * GATE + ROLE authority in `me`-mode; it is completely separate from the Supabase-backed
 * TeamContext (which remains the data-layer key for every business screen). The two team
 * id spaces are disjoint and never cross-keyed.
 *
 * In `supabase`-mode (the production default) this provider is INERT — it makes no `/v1/me`
 * request and the gate ignores it — so production behaviour is unchanged.
 *
 * A `/v1/me` failure becomes an `error` the gate retries; it is NEVER downgraded to a fake
 * "no team / onboarding required" (a core Step 1/Step 2 guarantee).
 */
export interface AuthzValue {
  /** True when `me`-mode is active AND auth is enabled — i.e. the gate consults this authority. */
  active: boolean
  loading: boolean
  error: { status: number | null; message: string } | null
  me: MeResponse | null
  /** The caller's switchable-team roster (from /v1/me). Empty in supabase-mode. */
  teams: MeTeamSummary[]
  /** Increments on every successful deliberate team switch. Team-scoped views key
   *  their fetches on it so a switch clears + reloads their cached data (the active-
   *  team header is in-memory, so an in-SPA epoch is the correct cache-clear). */
  teamEpoch: number
  refresh: () => Promise<void>
  /** Deliberately switch the active team via POST /v1/me/team and adopt the fresh
   *  authoritative state. No-op in supabase-mode. Rejects (throws) on a foreign/
   *  suspended team — the gate/caller surfaces it; never a silent wrong-team switch. */
  switchTeam: (teamId: string) => Promise<void>
}

const AuthzContext = createContext<AuthzValue | null>(null)

export function AuthzProvider({ children }: { children: ReactNode }) {
  const { enabled, session } = useAuth()
  // Key reloads on the STABLE user id (not the `session` object, which Supabase swaps on
  // every silent token refresh) — mirrors TeamContext.
  const userId = session?.user?.id ?? null
  const active = AUTH_SOURCE === 'me' && enabled

  const [loading, setLoading] = useState(active)
  const [me, setMe] = useState<MeResponse | null>(null)
  const [error, setError] = useState<{ status: number | null; message: string } | null>(null)
  const [teamEpoch, setTeamEpoch] = useState(0)

  const load = useCallback(async (isActive: () => boolean = () => true): Promise<void> => {
    if (!active || !userId) {
      if (isActive()) { setMe(null); setError(null); setLoading(false) }
      return
    }
    if (isActive()) { setLoading(true); setError(null) }
    try {
      const next = await fetchMe()
      if (!isActive()) return
      setMe(next); setError(null)
    } catch (e) {
      if (!isActive()) return
      // NEVER fall back to a fake "no team" — a failure is a retryable error for the gate.
      const status = e instanceof ApiError ? e.status : null
      const message = e instanceof Error ? e.message : 'Could not load your workspace.'
      setMe(null); setError({ status, message })
    } finally {
      if (isActive()) setLoading(false)
    }
  }, [active, userId])

  useEffect(() => {
    // Inert in supabase-mode: `loading` already initialises to `active` (false), so there is
    // nothing to set and no /v1/me request is made. `active` is constant for the app lifetime.
    if (!active) return
    let alive = true
    // Async data-load effect — the loading flag it sets is the intended pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(() => alive)
    return () => { alive = false }
  }, [active, load])

  // In `me`-mode the backend `x-team-id` must be the PRISMA team id so the server selects the
  // right team. TeamProvider yields ownership of setActiveTeam in this mode (see TeamContext).
  useEffect(() => {
    if (active) setActiveTeam(me?.team?.id ?? null)
  }, [active, me?.team?.id])

  // Deliberate team switch (me-mode only). Reuses the same authority as /v1/me: the
  // server re-validates the requested team against the caller's ACTIVE memberships and
  // recomputes role+permissions, so the new `me` is fully authoritative. A foreign/
  // suspended team throws (ApiError 403) for the caller to surface.
  const switchTeam = useCallback(async (teamId: string): Promise<void> => {
    if (!active) return
    const next = await switchTeamApi(teamId)
    setMe(next)
    setError(null)
    setActiveTeam(next.team?.id ?? null)
    setTeamEpoch((n) => n + 1) // bump so team-scoped views drop stale data + refetch
  }, [active])

  const value: AuthzValue = { active, loading, error, me, teams: me?.teams ?? [], teamEpoch, refresh: () => load(), switchTeam }
  return <AuthzContext.Provider value={value}>{children}</AuthzContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuthz(): AuthzValue {
  const ctx = useContext(AuthzContext)
  if (!ctx) throw new Error('useAuthz must be used within <AuthzProvider>')
  return ctx
}

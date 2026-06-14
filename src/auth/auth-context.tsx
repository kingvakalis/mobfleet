import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '@/lib/supabase'
import { setActiveTeam, setAuthToken } from '@/lib/provider/auth-token'

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''
const PENDING_TEAM_KEY = 'mobfleet-pending-team-name'

/** The acting user's tenant context, resolved from the backend after auth. */
export interface Me {
  userId: string
  email: string
  name?: string
  teamId: string
  teamName: string
  role: 'owner' | 'admin' | 'manager' | 'operator' | 'viewer'
}

interface AuthValue {
  /** True when Supabase is configured (otherwise the app runs without auth). */
  enabled: boolean
  /** Initial session check still in flight. */
  loading: boolean
  session: Session | null
  user: User | null
  /** Backend-resolved team + role (null until /v1/me succeeds). */
  me: Me | null
  signIn: (email: string, password: string) => Promise<{ error?: string }>
  signUp: (email: string, password: string, workspaceName: string) => Promise<{ error?: string; needsConfirmation?: boolean }>
  signOut: () => Promise<void>
  /** Re-resolve /v1/me (e.g. after accepting an invite changes the active team). */
  refreshMe: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

/** Resolve the backend tenant context for a token. Best-effort: when the
 *  backend isn't wired up (mock/demo mode) this simply returns null. */
async function fetchMe(accessToken: string, onboardTeamName?: string): Promise<Me | null> {
  try {
    const res = await fetch(`${API_BASE}/v1/me`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(onboardTeamName ? { 'x-onboard-team-name': onboardTeamName } : {}),
      },
    })
    if (!res.ok) return null
    return (await res.json()) as Me
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const enabled = isSupabaseConfigured
  const [loading, setLoading] = useState(enabled)
  const [session, setSession] = useState<Session | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  // Avoid overlapping /v1/me calls when auth events arrive in quick succession.
  const resolving = useRef(false)

  // Reflect a session into the provider token seam + resolve the tenant context.
  const applySession = useMemo(
    () => async (next: Session | null) => {
      setSession(next)
      setAuthToken(next?.access_token ?? null)
      if (!next) {
        setActiveTeam(null)
        setMe(null)
        return
      }
      if (resolving.current) return
      resolving.current = true
      // A name stashed at signup creates/names the team on first /v1/me (the
      // backend auto-provisions the user as OWNER); survives email-confirmation.
      const onboard = localStorage.getItem(PENDING_TEAM_KEY) ?? undefined
      const resolved = await fetchMe(next.access_token, onboard)
      if (onboard) localStorage.removeItem(PENDING_TEAM_KEY)
      if (resolved) {
        setMe(resolved)
        setActiveTeam(resolved.teamId)
      }
      resolving.current = false
    },
    [],
  )

  useEffect(() => {
    // When auth is disabled, `loading` already initialised to false (= enabled),
    // so there's nothing to do (and no synchronous setState in the effect).
    if (!enabled || !supabase) return
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      void applySession(data.session).finally(() => setLoading(false))
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      void applySession(next)
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [enabled, applySession])

  const value = useMemo<AuthValue>(
    () => ({
      enabled,
      loading,
      session,
      user: session?.user ?? null,
      me,
      async signIn(email, password) {
        if (!supabase) return { error: 'Authentication is not configured.' }
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        return error ? { error: error.message } : {}
      },
      async signUp(email, password, workspaceName) {
        if (!supabase) return { error: 'Authentication is not configured.' }
        // Stash the workspace name so the first authenticated /v1/me call creates
        // the team (with the user as OWNER) — works whether or not the project
        // requires email confirmation.
        localStorage.setItem(PENDING_TEAM_KEY, workspaceName.trim() || `${email.split('@')[0]}'s Workspace`)
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password })
        if (error) {
          localStorage.removeItem(PENDING_TEAM_KEY)
          return { error: error.message }
        }
        // No session → the project requires email confirmation before sign-in.
        if (!data.session) return { needsConfirmation: true }
        return {}
      },
      async signOut() {
        await supabase?.auth.signOut()
      },
      async refreshMe() {
        if (session?.access_token) {
          const resolved = await fetchMe(session.access_token)
          if (resolved) {
            setMe(resolved)
            setActiveTeam(resolved.teamId)
          }
        }
      },
    }),
    [enabled, loading, session, me],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// The provider + its hook intentionally live together (the hook is bound to the
// context defined here); fast-refresh's component-only export rule doesn't apply.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}

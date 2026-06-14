import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '@/lib/supabase'
import { setAuthToken } from '@/lib/provider/auth-token'
import { clearPendingTeamName, stashPendingTeamName } from './onboarding'

/**
 * Supabase auth provider — the single source of session truth. Wraps the app
 * (see main.tsx). Exposes login / signup / logout and the live session/user.
 * The Supabase client auto-attaches the JWT to every query, and we also mirror
 * the access token into the provider token-seam so the optional Fastify backend
 * path keeps working. When Supabase isn't configured, `enabled` is false and the
 * app runs in standalone mock/demo mode (auth is a no-op).
 */
interface AuthValue {
  /** True when Supabase is configured. */
  enabled: boolean
  /** Initial session check still in flight. */
  loading: boolean
  session: Session | null
  user: User | null
  login: (email: string, password: string) => Promise<{ error?: string }>
  signup: (email: string, password: string, workspaceName?: string) => Promise<{ error?: string; needsConfirmation?: boolean }>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const enabled = isSupabaseConfigured
  const [loading, setLoading] = useState(enabled)
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    if (!enabled || !supabase) return
    let active = true
    // Initial session (async → no synchronous setState in the effect body).
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setAuthToken(data.session?.access_token ?? null)
      setLoading(false)
    })
    // Live updates: sign-in, sign-out, token refresh.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setAuthToken(next?.access_token ?? null)
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [enabled])

  const value = useMemo<AuthValue>(
    () => ({
      enabled,
      loading,
      session,
      user: session?.user ?? null,
      async login(email, password) {
        if (!supabase) return { error: 'Authentication is not configured.' }
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        return error ? { error: error.message } : {}
      },
      async signup(email, password, workspaceName) {
        if (!supabase) return { error: 'Authentication is not configured.' }
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password })
        if (error) return { error: error.message }
        // Stash the workspace name ONLY after a successful signUp, so a failed or
        // abandoned attempt can't leak its name into the next user's provisioning
        // on a shared browser. It's consumed later at first authenticated load
        // (useTeam), so it still survives the email-confirmation gap.
        stashPendingTeamName((workspaceName ?? '').trim() || `${email.split('@')[0]}'s Workspace`)
        if (!data.session) return { needsConfirmation: true } // project requires email confirmation
        return {}
      },
      async logout() {
        // Drop any pending workspace name so it can't carry into a different
        // user's first provisioning on a shared browser.
        clearPendingTeamName()
        await supabase?.auth.signOut()
      },
    }),
    [enabled, loading, session],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}

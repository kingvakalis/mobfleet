import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { useNavigate } from 'react-router-dom'
import { isSupabaseConfigured, supabase } from '@/lib/supabase'
import { setAuthToken } from '@/lib/provider/auth-token'
import { passwordResetRedirectUrl } from '@/lib/auth-redirect'
import { clearOnboardingProgress, clearPendingInvite, clearPendingTeamName, stashPendingTeamName } from './onboarding'

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
  /** Email a password-reset link (Supabase). The caller shows a GENERIC success
   *  regardless of the result so account existence is never revealed. */
  forgotPassword: (email: string) => Promise<{ error?: string }>
  /** Set a new password for the active recovery session (from the emailed link). */
  resetPassword: (newPassword: string) => Promise<{ error?: string }>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const enabled = isSupabaseConfigured
  const navigate = useNavigate()
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
    // Live updates: sign-in, sign-out, token refresh, and PASSWORD_RECOVERY.
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next)
      setAuthToken(next?.access_token ?? null)
      // A password-reset link establishes a RECOVERY session wherever it lands —
      // and if the Supabase redirect URL isn't allow-listed, Supabase falls back
      // to the Site URL ("/"), dropping the user into the gated app ("Access
      // Restricted") instead of the reset form. Route any recovery session to the
      // public /reset-password page so the user always gets the new-password form.
      if (event === 'PASSWORD_RECOVERY') {
        navigate('/reset-password', { replace: true })
      }
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [enabled, navigate])

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
        // Drop any pending workspace name / invite / onboarding progress so they
        // can't carry into a different user's session on a shared browser.
        clearPendingTeamName()
        clearPendingInvite()
        clearOnboardingProgress()
        await supabase?.auth.signOut()
      },
      async forgotPassword(email) {
        if (!supabase) return { error: 'Authentication is not configured.' }
        // Supabase emails a recovery link that lands on /reset-password. The
        // redirect target is the deploy URL (VITE_APP_URL) or the current origin
        // (dev → http://localhost:5173/reset-password).
        //
        // SUPABASE DASHBOARD: these URLs MUST be allow-listed under Authentication
        // → URL Configuration → Redirect URLs, or the link is rejected:
        //   http://localhost:5173/reset-password
        //   http://mobfleet.co/reset-password
        //   https://mobfleet.co/reset-password
        const redirectTo = passwordResetRedirectUrl(
          import.meta.env.VITE_APP_URL as string | undefined,
          window.location.origin,
        )
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo })
        return error ? { error: error.message } : {}
      },
      async resetPassword(newPassword) {
        if (!supabase) return { error: 'Authentication is not configured.' }
        // Updates the user behind the active Supabase recovery session, which the
        // client establishes from the emailed link via detectSessionInUrl — the
        // PASSWORD_RECOVERY event is captured by onAuthStateChange above. No tokens
        // are parsed or handled manually here.
        const { error } = await supabase.auth.updateUser({ password: newPassword })
        return error ? { error: error.message } : {}
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

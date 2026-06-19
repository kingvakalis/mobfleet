import type { ReactNode } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { peekPendingInvite } from '@/contexts/onboarding'

/**
 * Global guard for the PUBLIC auth routes (/login, /signup). Once a session exists, an
 * authenticated user must never linger on an auth page — redirect (replace) to the intended
 * destination so the address bar can't stay on /login or /signup:
 *   1. an explicit ?redirect= (deep links, "sign in to continue"),
 *   2. else a pending invite (?invite= or the stashed token) → /invite to redeem it,
 *   3. else the app root "/", where the dashboard renders and its internal view state
 *      owns Fleet/Phones/Jobs/etc. (sections never live in the URL).
 *
 * Centralizes what used to be a per-page check, so the normalization is enforced in ONE
 * place for every auth route. No-op while the initial session check is still loading, and
 * when Supabase auth is disabled (standalone demo build).
 */
export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { enabled, loading, session } = useAuth()
  const [params] = useSearchParams()
  if (enabled && !loading && session) {
    const explicit = params.get('redirect')
    const inviteToken = params.get('invite') || peekPendingInvite()
    const to = explicit || (inviteToken ? `/invite?token=${encodeURIComponent(inviteToken)}` : '/')
    return <Navigate to={to} replace />
  }
  return <>{children}</>
}

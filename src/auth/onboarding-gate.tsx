import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { AlertTriangle, ShieldOff } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/contexts/AuthContext'
import { useTeamContext } from '@/contexts/TeamContext'
import { peekPendingInvite } from '@/contexts/onboarding'
import { resolveAuthRoute } from './auth-route'

/**
 * The authoritative post-auth routing layer for the app root. Delegates the
 * classification to the pure resolveAuthRoute(), then renders/redirects:
 *
 *  loading            → branded loader (never the dashboard, never ACCESS RESTRICTED)
 *  pending invite     → /invite (redeem before any team creation)
 *  suspended/removed  → suspended screen (never a bypass owner team)
 *  API/DB error       → retryable error (never onboarding, never a team during an outage)
 *  no team            → /onboarding (a NEW user is onboarding-required, not forbidden)
 *  owner, !onboarded  → /onboarding (finish the first-run survey)
 *  ready              → the app
 *
 * No-op when Supabase auth is disabled (standalone demo build).
 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const { enabled, user } = useAuth()
  const team = useTeamContext()

  const decision = resolveAuthRoute({
    enabled,
    loading: team.loading,
    suspended: team.suspended,
    error: Boolean(team.error),
    hasTeam: Boolean(team.team),
    role: team.role,
    onboarded: Boolean(user?.user_metadata?.onboarded),
    pendingInvite: peekPendingInvite(),
  })

  switch (decision.kind) {
    case 'loading':
      return (
        <FullScreen>
          <Spinner size={24} />
        </FullScreen>
      )
    case 'suspended':
      return (
        <FullScreen>
          <ShieldOff size={28} className="text-white/40" aria-hidden />
          <div>
            <h1 className="mono text-sm font-bold uppercase tracking-widest text-white/85">Access suspended</h1>
            <p className="mono mt-2 max-w-[340px] text-[11px] leading-relaxed text-white/40">
              Your workspace access has been suspended. Contact a workspace administrator if you believe this is a mistake.
            </p>
          </div>
        </FullScreen>
      )
    case 'error':
      return (
        <FullScreen>
          <AlertTriangle size={28} className="text-white/40" aria-hidden />
          <div>
            <h1 className="mono text-sm font-bold uppercase tracking-widest text-white/85">Couldn’t load your workspace</h1>
            <p className="mono mt-2 max-w-[340px] text-[11px] leading-relaxed text-white/40">
              {team.error ?? 'Please try again in a moment.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void team.refresh()}
            className="btn-ghost mono px-4 py-2 text-[10px] uppercase tracking-widest"
          >
            Try again
          </button>
        </FullScreen>
      )
    case 'redirect':
      return <Navigate to={decision.to} replace />
    case 'render':
      return <>{children}</>
  }
}

function FullScreen({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-canvas px-6 text-center text-fg">
      {children}
    </div>
  )
}

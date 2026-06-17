import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { AlertTriangle, ShieldOff } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/contexts/AuthContext'
import { useAuthz } from '@/contexts/AuthzContext'
import { useTeamContext } from '@/contexts/TeamContext'
import { peekPendingInvite } from '@/contexts/onboarding'
import { AUTH_SOURCE } from '@/auth/auth-source'
import type { TeamRole } from '@/lib/database.types'
import { resolveAuthRoute, type AuthRouteDecision } from './auth-route'
import { resolveAuthzDecision, type AuthzRouteDecision } from './authz-route'

/**
 * The authoritative post-auth routing layer for the app root. Delegates the
 * classification to a pure resolver, then renders/redirects:
 *
 *  loading            → branded loader (never the dashboard, never ACCESS RESTRICTED)
 *  pending invite     → /invite (redeem the Supabase token before any team creation)
 *  suspended/removed  → suspended screen (never a bypass owner team)
 *  API/DB error       → retryable error (never onboarding, never a team during an outage)
 *  awaiting-migration → (me-mode only) existing Supabase member with no Prisma team yet
 *  no team            → /onboarding (a NEW user is onboarding-required, not forbidden)
 *  owner, !onboarded  → /onboarding (finish the first-run survey)
 *  ready              → the app
 *
 * `supabase`-mode (production default) uses the unchanged Supabase-derived resolveAuthRoute.
 * `me`-mode uses the authoritative `GET /v1/me` (Prisma) via resolveAuthzDecision, while the
 * Supabase data layer (TeamContext) still keys every business screen — the gate admits only
 * when BOTH the authority and the Supabase team are ready (no empty/broken dashboard).
 *
 * No-op when Supabase auth is disabled (standalone demo build).
 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const { enabled, user, loading: sessionLoading, session } = useAuth()
  const team = useTeamContext()
  const authz = useAuthz()

  let decision: AuthRouteDecision | AuthzRouteDecision
  if (AUTH_SOURCE === 'me') {
    const me = authz.me
    decision = resolveAuthzDecision({
      enabled,
      sessionLoading,
      hasSession: Boolean(session),
      authzLoading: authz.loading,
      authzFailed: Boolean(authz.error),
      onboardingRequired: Boolean(me?.onboardingRequired),
      suspended: Boolean(me?.suspended),
      meRole: (me?.role ?? null) as TeamRole | null,
      surveyed: Boolean(user?.user_metadata?.onboarded),
      localInviteToken: peekPendingInvite(),
      supabaseTeamPresent: Boolean(team.team),
      supabaseTeamLoading: team.loading,
      supabaseTeamError: Boolean(team.error),
      supabaseRole: team.role,
    })
  } else {
    decision = resolveAuthRoute({
      enabled,
      loading: team.loading,
      suspended: team.suspended,
      error: Boolean(team.error),
      hasTeam: Boolean(team.team),
      role: team.role,
      onboarded: Boolean(user?.user_metadata?.onboarded),
      pendingInvite: peekPendingInvite(),
    })
  }

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
    case 'awaiting-migration':
      return (
        <FullScreen>
          <Spinner size={24} />
          <div>
            <h1 className="mono text-sm font-bold uppercase tracking-widest text-white/85">Finishing workspace setup</h1>
            <p className="mono mt-2 max-w-[340px] text-[11px] leading-relaxed text-white/40">
              We’re finalizing your account. This only takes a moment — refresh shortly, or contact a workspace administrator if it persists.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void authz.refresh()}
            className="btn-ghost mono px-4 py-2 text-[10px] uppercase tracking-widest"
          >
            Refresh
          </button>
        </FullScreen>
      )
    case 'error':
      return (
        <FullScreen>
          <AlertTriangle size={28} className="text-white/40" aria-hidden />
          <div>
            <h1 className="mono text-sm font-bold uppercase tracking-widest text-white/85">Couldn’t load your workspace</h1>
            <p className="mono mt-2 max-w-[340px] text-[11px] leading-relaxed text-white/40">
              {(AUTH_SOURCE === 'me' ? authz.error?.message : team.error) ?? 'Please try again in a moment.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void (AUTH_SOURCE === 'me' ? authz.refresh() : team.refresh())}
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

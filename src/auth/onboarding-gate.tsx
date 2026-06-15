import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/contexts/AuthContext'
import { useTeamContext } from '@/contexts/TeamContext'
import { peekPendingInvite } from '@/contexts/onboarding'

/**
 * Wraps the authenticated app root. Two first-run redirects, in priority order:
 *  1. A pending invite (stashed at signup, survived the email-confirm gap) →
 *     /invite?token=… to redeem it.
 *  2. A workspace CREATOR (owner) who hasn't completed onboarding → /onboarding.
 *     Invited members (non-owners) skip onboarding entirely.
 * No-op when Supabase auth is disabled (standalone demo build).
 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const { enabled, user } = useAuth()
  const team = useTeamContext()

  // #region agent log
  fetch('http://127.0.0.1:7627/ingest/1b257ea2-3233-4b89-b6f7-a1d72b0f2da3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a33ba4'},body:JSON.stringify({sessionId:'a33ba4',runId:'pre-fix',hypothesisId:'A,B,C,D,E',location:'onboarding-gate.tsx:17',message:'OnboardingGate decision inputs',data:{enabled,pendingInvite:peekPendingInvite(),teamLoading:team.loading,teamId:team.team?.id??null,role:team.role,onboarded:Boolean(user?.user_metadata?.onboarded),hasUser:Boolean(user)},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  if (!enabled) return <>{children}</>

  const pendingInvite = peekPendingInvite()
  if (pendingInvite) return <Navigate to={`/invite?token=${encodeURIComponent(pendingInvite)}`} replace />

  // Wait for team/role to resolve so owners aren't misrouted on a slow load.
  if (team.loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-canvas">
        <Spinner size={24} />
      </div>
    )
  }

  const onboarded = Boolean(user?.user_metadata?.onboarded)
  if (team.team && team.role === 'owner' && !onboarded) {
    return <Navigate to="/onboarding" replace />
  }

  return <>{children}</>
}

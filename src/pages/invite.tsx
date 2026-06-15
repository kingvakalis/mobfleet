import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useTeamContext } from '@/contexts/TeamContext'
import { clearPendingInvite } from '@/contexts/onboarding'
import { AuthError, AuthShell } from './auth-shell'

type State =
  | { kind: 'accepting' }
  | { kind: 'done'; teamName?: string; role?: string; switched?: boolean }
  | { kind: 'error'; message: string }

/**
 * /invite?token=… — redeem a team invitation (Supabase-native).
 *
 * Public route: an invitee may arrive without an account. If unauthenticated we
 * send them to /signup?invite=… (the token is stashed so it survives the
 * email-confirmation gap, then redeemed on first login). If authenticated we call
 * the accept_invite() RPC, which validates the token + email and inserts the
 * membership under definer rights.
 */
export function InvitePage() {
  const { enabled, loading, session } = useAuth()
  const { team, refresh } = useTeamContext()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [state, setState] = useState<State>({ kind: 'accepting' })
  const ran = useRef(false)
  // The active team BEFORE acceptance — to detect joining a SECOND team (there is
  // no team switcher yet, so we must not pretend they landed in the new one).
  const priorTeamId = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled || loading || !session || ran.current || !token || !supabase) return
    ran.current = true
    priorTeamId.current = team?.id ?? null
    const accept = async () => {
      const { data, error } = await supabase!.rpc('accept_invite', { p_token: token })
      if (error) {
        // Keep the stash on failure so the invitee can retry and never
        // auto-provisions their own workspace.
        setState({ kind: 'error', message: humanizeRpcError(error.message) })
        return
      }
      // Redeemed — now it's safe to drop the pending-invite stash.
      clearPendingInvite()
      // Invited users are considered onboarded — they join an existing workspace.
      await supabase!.auth.updateUser({ data: { onboarded: true } }).catch(() => undefined)
      await refresh()
      const res = data as { team_id?: string; team_name?: string; role?: string } | null
      const switched = !!priorTeamId.current && !!res?.team_id && priorTeamId.current !== res.team_id
      setState({ kind: 'done', teamName: res?.team_name, role: res?.role, switched })
    }
    void accept()
  }, [enabled, loading, session, token, team, refresh])

  // Standalone build (no Supabase) — invitations require the backend.
  if (!enabled) {
    return (
      <AuthShell title="Invitations unavailable" subtitle="Authentication isn't configured">
        <AuthError message="This deployment isn't connected to Supabase, so invitations can't be accepted here." />
      </AuthShell>
    )
  }

  // Missing token.
  if (!token) {
    return (
      <AuthShell title="Invitation problem">
        <div className="mb-4"><AuthError message="This invitation link is missing its token." /></div>
        <Button variant="outline" className="h-10 w-full" onClick={() => navigate('/')}>Go to dashboard</Button>
      </AuthShell>
    )
  }

  // Not signed in → send to signup, carrying the token through the confirm gap.
  if (!loading && !session) {
    return <Navigate to={`/signup?invite=${encodeURIComponent(token)}&redirect=${encodeURIComponent(`/invite?token=${token}`)}`} replace />
  }

  if (state.kind === 'accepting') {
    return (
      <AuthShell title="Accepting invitation" subtitle="Joining the workspace…">
        <div className="flex justify-center py-4"><Spinner size={22} /></div>
      </AuthShell>
    )
  }

  if (state.kind === 'error') {
    return (
      <AuthShell title="Invitation problem">
        <div className="mb-4"><AuthError message={state.message} /></div>
        <Button variant="outline" className="h-10 w-full" onClick={() => navigate('/')}>Go to dashboard</Button>
      </AuthShell>
    )
  }

  // Joined a SECOND team while already in another one — be honest: there's no
  // team switcher yet, so we can't drop them into the new workspace.
  if (state.switched) {
    return (
      <AuthShell title="Invitation accepted" subtitle={state.teamName ? `Joined ${state.teamName}` : 'Invitation accepted'}>
        <p className="mb-4 text-[13px] leading-relaxed text-white/60">
          You joined{state.teamName ? ` ${state.teamName}` : ' the workspace'}
          {state.role ? ` as ${state.role}` : ''}. Switching between workspaces isn't available yet —
          ask that team's owner for help, or sign in with a separate account.
        </p>
        <Button variant="outline" className="h-10 w-full" onClick={() => navigate('/', { replace: true })}>
          Back to dashboard
        </Button>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="You're in" subtitle={state.teamName ? `Joined ${state.teamName}` : 'Invitation accepted'}>
      <p className="mb-4 text-[13px] text-white/60">
        You joined{state.teamName ? ` ${state.teamName}` : ' the workspace'}
        {state.role ? ` as ${state.role}` : ''}.
      </p>
      <Button variant="primary" className="h-10 w-full" onClick={() => navigate('/', { replace: true })}>
        Enter workspace
      </Button>
    </AuthShell>
  )
}

/** Turn raw RPC errors into plain, user-facing language. */
function humanizeRpcError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('expired')) return 'This invitation has expired. Ask an admin to send a new one.'
  if (m.includes('different email')) return 'This invitation was sent to a different email address. Sign in with that address.'
  if (m.includes('confirm your email')) return 'Please confirm your email address before accepting this invitation.'
  if (m.includes('not found') || m.includes('no longer valid')) return 'This invitation is no longer valid. Ask an admin to send a new one.'
  return 'Could not accept this invitation. Ask an admin to send a new one.'
}

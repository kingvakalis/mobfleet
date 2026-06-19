import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useAuthz } from '@/contexts/AuthzContext'
import { useTeamContext } from '@/contexts/TeamContext'
import { clearPendingInvite } from '@/contexts/onboarding'
import { AUTH_SOURCE } from '@/auth/auth-source'
import { ApiError, acceptInvite, inspectInvite } from '@/services/invites'
import { AuthError, AuthShell } from './auth-shell'

type State =
  | { kind: 'accepting' }
  | { kind: 'done'; teamName?: string; role?: string }
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
  const { teams, refresh } = useTeamContext()
  const authz = useAuthz()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [state, setState] = useState<State>({ kind: 'accepting' })
  const ran = useRef(false)

  useEffect(() => {
    if (!enabled || loading || !session || ran.current || !token || !supabase) return
    ran.current = true
    const accept = async () => {
      // Authoritative ("me") path: inspect + redeem against the Prisma backend — no
      // Supabase accept_invite RPC for business state. Membership is written into the
      // SAME Prisma team the invite was issued for.
      if (AUTH_SOURCE === 'me') {
        try {
          const preview = await inspectInvite(token)
          if (!preview.valid) {
            setState({ kind: 'error', message: 'This invitation is no longer valid. Ask an admin to send a new one.' })
            return
          }
          const res = await acceptInvite(token)
          clearPendingInvite()
          await supabase!.auth.updateUser({ data: { onboarded: true } }).catch(() => undefined)
          await authz.refresh() // /v1/me now lists the joined team (the switcher can enter it)
          setState({ kind: 'done', teamName: res.teamName, role: res.role })
        } catch (e) {
          setState({ kind: 'error', message: humanizeInviteError(e) })
        }
        return
      }
      // Legacy supabase-mode: redeem via the Supabase definer-rights RPC.
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
      await refresh() // teamCtx now lists the joined team (the switcher can enter it)
      const res = data as { team_id?: string; team_name?: string; role?: string } | null
      setState({ kind: 'done', teamName: res?.team_name, role: res?.role })
    }
    void accept()
  }, [enabled, loading, session, token, refresh, authz])

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

  // Copy depends on whether the user now belongs to MORE THAN ONE workspace (computed
  // from the post-accept roster): if so, point them at the workspace switcher; if it's
  // their only workspace, just send them in. me-mode reads its own (/v1/me) team list.
  const hasMultipleTeams =
    AUTH_SOURCE === 'me'
      ? authz.teams.filter((t) => t.status === 'active').length > 1
      : teams.length > 1
  const joined = state.teamName ? ` ${state.teamName}` : ' the workspace'
  const asRole = state.role ? ` as ${state.role}` : ''

  if (hasMultipleTeams) {
    return (
      <AuthShell title="Invitation accepted" subtitle={state.teamName ? `Joined ${state.teamName}` : 'Invitation accepted'}>
        <p className="mb-4 text-[13px] leading-relaxed text-white/60">
          You joined{joined}{asRole}. You can switch to it anytime from the workspace
          dropdown in the sidebar.
        </p>
        <Button variant="primary" className="h-10 w-full" onClick={() => navigate('/', { replace: true })}>
          Continue to dashboard
        </Button>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="You're in" subtitle={state.teamName ? `Joined ${state.teamName}` : 'Invitation accepted'}>
      <p className="mb-4 text-[13px] text-white/60">You joined{joined}{asRole}.</p>
      <Button variant="primary" className="h-10 w-full" onClick={() => navigate('/', { replace: true })}>
        Enter workspace
      </Button>
    </AuthShell>
  )
}

/** Turn a Prisma invite-endpoint error into plain, user-facing language. The server
 *  already returns friendly messages for the 403 cases (email mismatch / unverified);
 *  a 400 is the catch-all invalid/expired/used. */
function humanizeInviteError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403) return e.message
    if (e.status === 400) return 'This invitation is invalid, expired, or already used. Ask an admin to send a new one.'
    if (e.status === 401) return 'Please sign in again to accept this invitation.'
  }
  return 'Could not accept this invitation. Ask an admin to send a new one.'
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

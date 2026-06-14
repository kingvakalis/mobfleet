import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/auth/auth-context'
import { AuthShell } from './auth-shell'

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? ''

type State =
  | { kind: 'accepting' }
  | { kind: 'done'; teamName?: string; role?: string }
  | { kind: 'error'; message: string }

/**
 * /invite?token=… — the authenticated invitee accepts a team invitation. The
 * ProtectedRoute wrapper guarantees a session here; if the user arrived
 * unauthenticated it bounced them through /login?redirect=/invite?token=… so the
 * token survives the round-trip.
 */
export function InvitePage() {
  const { session, refreshMe } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [state, setState] = useState<State>({ kind: 'accepting' })
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current || !token) return
    ran.current = true
    const accept = async () => {
      try {
        const res = await fetch(`${API_BASE}/v1/invites/accept`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
          body: JSON.stringify({ token }),
        })
        const body = (await res.json().catch(() => ({}))) as { error?: string; teamName?: string; role?: string }
        if (!res.ok) {
          setState({ kind: 'error', message: body.error ?? `Could not accept invitation (HTTP ${res.status}).` })
          return
        }
        await refreshMe() // switch the active team to the one just joined
        setState({ kind: 'done', teamName: body.teamName, role: body.role })
      } catch {
        setState({ kind: 'error', message: 'Could not reach the server to accept the invitation.' })
      }
    }
    void accept()
  }, [token, session, refreshMe])

  // Missing token — derived during render (no setState-in-effect needed).
  if (!token) {
    return (
      <AuthShell title="Invitation problem">
        <div role="alert" className="mb-4 rounded-control border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
          This invitation link is missing its token.
        </div>
        <Button variant="outline" className="h-10 w-full" onClick={() => navigate('/')}>
          Go to dashboard
        </Button>
      </AuthShell>
    )
  }

  if (state.kind === 'accepting') {
    return (
      <AuthShell title="Accepting invitation" subtitle="Joining the workspace…">
        <div className="flex justify-center py-4">
          <Spinner size={22} />
        </div>
      </AuthShell>
    )
  }

  if (state.kind === 'error') {
    return (
      <AuthShell title="Invitation problem">
        <div role="alert" className="mb-4 rounded-control border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
          {state.message}
        </div>
        <Button variant="outline" className="h-10 w-full" onClick={() => navigate('/')}>
          Go to dashboard
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

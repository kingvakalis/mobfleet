import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/AuthContext'
import { stashPendingInvite } from '@/contexts/onboarding'
import { AuthError, AuthField, AuthShell, AuthSubmit, PasswordField } from './auth-shell'

export function SignupPage() {
  const { enabled, session, signup } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const inviteToken = params.get('invite') ?? ''
  const isInvited = inviteToken !== ''
  // Invited users are sent back to /invite to redeem; everyone else lands at /.
  const redirect = params.get('redirect') || (isInvited ? `/invite?token=${inviteToken}` : '/')

  const [workspace, setWorkspace] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)

  if (enabled && session) return <Navigate to={redirect} replace />

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!enabled) {
      setError('Authentication is not configured (set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY).')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setBusy(true)
    setError(null)
    // Invited users JOIN an existing workspace — stash the token so it survives the
    // email-confirmation gap, and don't provision a workspace name for them.
    if (isInvited) stashPendingInvite(inviteToken)
    // For workspace creators this captures the workspace name (provisioned with
    // them as OWNER on first authenticated load).
    const { error: err, needsConfirmation } = await signup(email, password, isInvited ? '' : workspace)
    setBusy(false)
    if (err) {
      setError(err)
      return
    }
    if (needsConfirmation) {
      setConfirm(true)
      return
    }
    navigate(redirect, { replace: true })
  }

  if (confirm) {
    return (
      <AuthShell title="Check your email" subtitle="One more step">
        <p className="text-[13px] leading-relaxed text-white/60">
          We sent a confirmation link to <span className="text-white">{email}</span>. Confirm your
          address, then sign in — {isInvited ? 'your invitation will be accepted automatically.' : 'your workspace will be created on first login.'}
        </p>
        <Link to="/login" className="mt-4 block">
          <Button variant="outline" className="h-10 w-full">Back to sign in</Button>
        </Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title={isInvited ? 'Accept your invitation' : 'Create your workspace'}
      subtitle={isInvited ? 'Create your account to join the team' : "You'll be the workspace owner"}
      footer={
        <>
          Already have an account?{' '}
          <Link to={`/login${redirect !== '/' ? `?redirect=${encodeURIComponent(redirect)}` : ''}`} className="text-[var(--accent-text)] hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {!isInvited && (
          <AuthField
            label="Workspace name" id="workspace" type="text" required error={!!error}
            value={workspace} onChange={(e) => setWorkspace(e.target.value)} placeholder="Acme Operations"
          />
        )}
        <AuthField
          label="Email" id="email" type="email" autoComplete="email" required error={!!error}
          value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" icon="email"
        />
        <PasswordField
          label="Password" id="password" autoComplete="new-password" required minLength={8} error={!!error}
          value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters"
        />
        <AuthError message={error} />
        <AuthSubmit busy={busy} busyLabel="Creating…">{isInvited ? 'Create account' : 'Create workspace'}</AuthSubmit>
      </form>
    </AuthShell>
  )
}

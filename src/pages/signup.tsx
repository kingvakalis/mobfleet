import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/auth/auth-context'
import { AuthError, AuthField, AuthShell } from './auth-shell'

export function SignupPage() {
  const { enabled, session, signUp } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const redirect = params.get('redirect') || '/'

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
    // Creating the account also creates the workspace with this user as OWNER
    // (the backend provisions the team on first authenticated request).
    const { error: err, needsConfirmation } = await signUp(email, password, workspace)
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
          address, then sign in — your workspace will be created on first login.
        </p>
        <Link to="/login" className="mt-4 block">
          <Button variant="outline" className="h-10 w-full">Back to sign in</Button>
        </Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Create your workspace"
      subtitle="You'll be the workspace owner"
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
        <AuthField
          label="Workspace name" id="workspace" type="text" required
          value={workspace} onChange={(e) => setWorkspace(e.target.value)} placeholder="Acme Operations"
        />
        <AuthField
          label="Email" id="email" type="email" autoComplete="email" required
          value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com"
        />
        <AuthField
          label="Password" id="password" type="password" autoComplete="new-password" required minLength={8}
          value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters"
        />
        <AuthError message={error} />
        <Button type="submit" variant="primary" className="h-10 w-full" disabled={busy}>
          {busy ? 'Creating…' : 'Create workspace'}
        </Button>
      </form>
    </AuthShell>
  )
}

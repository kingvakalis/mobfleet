import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/auth/auth-context'
import { AuthError, AuthField, AuthShell } from './auth-shell'

export function LoginPage() {
  const { enabled, session, signIn } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const redirect = params.get('redirect') || '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Already signed in → bounce to the intended destination.
  if (enabled && session) return <Navigate to={redirect} replace />

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!enabled) {
      setError('Authentication is not configured (set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY).')
      return
    }
    setBusy(true)
    setError(null)
    const { error: err } = await signIn(email, password)
    setBusy(false)
    if (err) {
      setError(err)
      return
    }
    navigate(redirect, { replace: true })
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="Access your fleet control plane"
      footer={
        <>
          No account?{' '}
          <Link to={`/signup${redirect !== '/' ? `?redirect=${encodeURIComponent(redirect)}` : ''}`} className="text-[var(--accent-text)] hover:underline">
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <AuthField
          label="Email" id="email" type="email" autoComplete="email" required
          value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com"
        />
        <AuthField
          label="Password" id="password" type="password" autoComplete="current-password" required
          value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
        />
        <AuthError message={error} />
        <Button type="submit" variant="primary" className="h-10 w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthShell>
  )
}

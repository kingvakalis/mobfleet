import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { AuthError, AuthField, AuthShell, AuthSubmit } from './auth-shell'

/**
 * Forgot-password — step 1 of recovery. Collects the account email and asks
 * Supabase to send a reset link (which lands on /reset-password). On success we
 * show a GENERIC confirmation regardless of whether the address has an account,
 * so this page never reveals which emails are registered. All auth logic lives
 * in AuthContext.forgotPassword; this page is presentation + form state only.
 */
export function ForgotPasswordPage() {
  const { enabled, session, forgotPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  // Already signed in → no reason to be here.
  if (enabled && session) return <Navigate to="/" replace />

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!enabled) {
      setError('Authentication is not configured (set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY).')
      return
    }
    setBusy(true)
    setError(null)
    const { error: err } = await forgotPassword(email)
    setBusy(false)
    // Only surface real failures (rate limit / config). Otherwise show the generic
    // success below — never confirm or deny that the address exists.
    if (err) {
      setError(err)
      return
    }
    setSent(true)
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll email you a secure link to set a new one"
      footer={
        <>
          Remembered it?{' '}
          <Link to="/login" className="text-[var(--accent-text)] hover:underline">
            Back to sign in
          </Link>
        </>
      }
    >
      {sent ? (
        <div role="status" className="space-y-4">
          <div className="flex items-center gap-2.5 text-[var(--accent-text)]">
            <MailCheck size={18} aria-hidden />
            <span className="text-[13px] font-medium text-white/90">Check your inbox</span>
          </div>
          <p className="text-[13px] leading-relaxed text-white/65">
            If an account exists for{' '}
            <span className="text-white/90">{email.trim() || 'that address'}</span>, a password-reset
            link is on its way. Open it to choose a new password — it expires shortly, so use it soon.
          </p>
          <p className="text-[12px] leading-relaxed text-white/40">
            Didn’t get it? Check spam, or{' '}
            <button
              type="button"
              onClick={() => setSent(false)}
              className="text-[var(--accent-text)] hover:underline"
            >
              try a different email
            </button>
            .
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <AuthField
            label="Email" id="email" type="email" autoComplete="email" required error={!!error}
            value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" icon="email"
          />
          <AuthError message={error} />
          <AuthSubmit busy={busy} busyLabel="Sending…">Send reset link</AuthSubmit>
        </form>
      )}
    </AuthShell>
  )
}

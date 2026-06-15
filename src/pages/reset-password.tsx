import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Spinner } from '@/components/ui/spinner'
import { AuthError, AuthShell, AuthSubmit, PasswordField } from './auth-shell'

/** Minimum new-password length enforced client-side (Supabase enforces its own
 *  project minimum server-side; this is a friendlier early gate). */
const MIN_PASSWORD = 8

/**
 * Reset-password — step 2 of recovery. The emailed link lands here with a Supabase
 * recovery token in the URL; the client establishes a recovery session from it
 * automatically (detectSessionInUrl), surfaced as `session` by AuthContext (which
 * captures the PASSWORD_RECOVERY event). This page never parses tokens itself — it
 * just waits for that session, then calls AuthContext.resetPassword to set the new
 * password. A missing/expired link resolves to no session → the invalid state.
 */
export function ResetPasswordPage() {
  const { enabled, loading, session, resetPassword } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  // Grace window: detectSessionInUrl parses the link asynchronously, so a recovery
  // session can arrive a beat after the initial check. Hold the "Verifying" state
  // briefly before concluding the link is invalid, to avoid a false-negative flash.
  const [grace, setGrace] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setGrace(false), 1500)
    return () => clearTimeout(t)
  }, [])

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`)
      return
    }
    if (password !== confirm) {
      setError('Passwords don’t match.')
      return
    }
    setBusy(true)
    setError(null)
    const { error: err } = await resetPassword(password)
    setBusy(false)
    if (err) {
      setError(err)
      return
    }
    setDone(true)
  }

  // ── State machine ──────────────────────────────────────────────────────────
  let body: ReactNode

  if (!enabled) {
    body = (
      <p className="text-[13px] leading-relaxed text-white/65">
        Authentication is not configured (set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY).
      </p>
    )
  } else if (done) {
    body = (
      <div role="status" className="space-y-4">
        <div className="flex items-center gap-2.5 text-[var(--accent-text)]">
          <ShieldCheck size={18} aria-hidden />
          <span className="text-[13px] font-medium text-white/90">Password updated</span>
        </div>
        <p className="text-[13px] leading-relaxed text-white/65">
          Your password has been changed. You can now sign in with your new credentials.
        </p>
        <Link
          to="/login"
          className="btn-accent mono flex h-11 w-full items-center justify-center rounded-control text-[11px] uppercase tracking-widest"
        >
          Continue to sign in
        </Link>
      </div>
    )
  } else if ((loading || grace) && !session) {
    // Still establishing the recovery session from the link.
    body = (
      <div className="flex items-center gap-3 py-2 text-[13px] text-white/55">
        <Spinner size={16} />
        Verifying your reset link…
      </div>
    )
  } else if (!session) {
    // No recovery session after the grace window → bad or expired link.
    body = (
      <div className="space-y-4">
        <p className="text-[13px] leading-relaxed text-white/65">
          This password-reset link is invalid or has expired. Request a fresh one and try again.
        </p>
        <Link
          to="/forgot-password"
          className="btn-accent mono flex h-11 w-full items-center justify-center rounded-control text-[11px] uppercase tracking-widest"
        >
          Request a new link
        </Link>
      </div>
    )
  } else {
    body = (
      <form onSubmit={onSubmit} className="space-y-4">
        <PasswordField
          label="New password" id="new-password" autoComplete="new-password" required error={!!error}
          value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
        />
        <PasswordField
          label="Confirm new password" id="confirm-password" autoComplete="new-password" required error={!!error}
          value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••"
        />
        <AuthError message={error} />
        <AuthSubmit busy={busy} busyLabel="Saving…">
          <KeyRound size={15} aria-hidden />
          Set new password
        </AuthSubmit>
      </form>
    )
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Set the password you’ll use to sign in"
      footer={
        <>
          Changed your mind?{' '}
          <Link to="/login" className="text-[var(--accent-text)] hover:underline">
            Back to sign in
          </Link>
        </>
      }
    >
      {body}
    </AuthShell>
  )
}

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useToastStore } from '@/state/toast-store'

/**
 * Sign Out action. Calls the Supabase auth logout (clears the session + pending
 * onboarding/invite state) and then redirects to /login. ProtectedRoute also
 * redirects on its own once the session nulls — the explicit navigate is immediate
 * and unmounts the authed app so no stale workspace/device data lingers on screen.
 *
 * Disabled + spinner-labelled while signing out; a failure surfaces a truthful
 * toast and leaves the user signed in. Two variants: the compact sidebar system
 * block and a Settings → Account row.
 */
export function SignOutButton({
  variant = 'sidebar',
  collapsed = false,
}: {
  variant?: 'sidebar' | 'settings'
  collapsed?: boolean
}) {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const addToast = useToastStore((s) => s.addToast)
  const [busy, setBusy] = useState(false)

  const onClick = async () => {
    if (busy) return
    setBusy(true)
    const { error } = await logout()
    if (error) {
      setBusy(false)
      addToast(`Sign out failed: ${error}`, 'error')
      return
    }
    navigate('/login', { replace: true })
  }

  if (variant === 'settings') {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        aria-busy={busy}
        className="btn-ghost flex h-9 items-center gap-2 rounded-control px-3 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        <LogOut size={14} />
        {busy ? 'Signing out…' : 'Sign Out'}
      </button>
    )
  }

  // sidebar — compact, matches the system-status block typography
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-busy={busy}
      title="Sign out"
      aria-label="Sign out"
      className={[
        'flex items-center rounded-control text-[10px] uppercase tracking-wide text-white/50 transition-colors hover:bg-hover hover:text-white/85 disabled:cursor-not-allowed disabled:opacity-50',
        collapsed ? 'h-7 w-7 justify-center' : 'w-full gap-2 px-2 py-1.5',
      ].join(' ')}
    >
      <LogOut size={collapsed ? 15 : 13} className="shrink-0" />
      {!collapsed && <span>{busy ? 'Signing out…' : 'Sign Out'}</span>}
    </button>
  )
}

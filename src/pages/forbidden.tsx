import { ShieldAlert } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useTeamContext } from '@/contexts/TeamContext'
import { AuthShell } from './auth-shell'

/**
 * 403 — shown when an authenticated user lacks the role required for a route
 * (see ProtectedRoute `requiredRole`). Reuses the auth shell for a consistent,
 * on-brand full-screen treatment.
 */
export function ForbiddenPage() {
  const navigate = useNavigate()
  const { role } = useTeamContext()

  return (
    <AuthShell title="Access denied" subtitle="You don't have permission to view this">
      <div className="flex flex-col items-center gap-4 py-2 text-center">
        <span
          className="flex h-12 w-12 items-center justify-center rounded-full border"
          style={{ borderColor: 'var(--status-error)', background: 'rgba(255,77,77,0.08)' }}
        >
          <ShieldAlert size={22} style={{ color: 'var(--status-error)' }} />
        </span>
        <p className="text-[13px] leading-relaxed text-white/60">
          This area requires a higher role than your current one
          {role ? <> (<span className="mono uppercase text-white/80">{role}</span>)</> : null}. If you
          believe this is a mistake, ask a workspace admin to adjust your access.
        </p>
        <Button variant="primary" className="mt-1 h-10 w-full" onClick={() => navigate('/', { replace: true })}>
          Back to dashboard
        </Button>
      </div>
    </AuthShell>
  )
}

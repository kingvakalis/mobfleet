import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/contexts/AuthContext'

/**
 * Gate for authenticated areas. Redirects to /login (preserving the intended
 * destination via ?redirect=) when there is no session. When Supabase isn't
 * configured, auth is disabled and the app renders normally (mock/demo mode),
 * so this can never lock anyone out of the standalone build.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { enabled, loading, session } = useAuth()
  const location = useLocation()

  if (!enabled) return <>{children}</>

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-canvas">
        <Spinner size={24} />
      </div>
    )
  }

  if (!session) {
    const redirect = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?redirect=${redirect}`} replace />
  }

  return <>{children}</>
}

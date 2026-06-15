import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/contexts/AuthContext'
import { useTeamContext } from '@/contexts/TeamContext'
import { roleRank, type RoleId } from '@/lib/authorization/roles'

const LoadingScreen = () => (
  <div className="flex h-screen w-full items-center justify-center bg-canvas">
    <Spinner size={24} />
  </div>
)

/**
 * Gate for authenticated areas. Redirects to /login (preserving the intended
 * destination via ?redirect=) when there is no session. When Supabase isn't
 * configured, auth is disabled and the app renders normally (mock/demo mode),
 * so this can never lock anyone out of the standalone build.
 *
 * Optional `requiredRole` enforces a minimum role using the authority hierarchy
 * (owner > admin > manager > operator > viewer): a higher role always satisfies a
 * lower requirement. Insufficient role → /forbidden. This is a UX guard; the real
 * boundary is Supabase RLS on every query.
 */
export function ProtectedRoute({ children, requiredRole }: { children: ReactNode; requiredRole?: RoleId }) {
  const { enabled, loading, session } = useAuth()
  const team = useTeamContext()
  const location = useLocation()

  if (!enabled) return <>{children}</>

  if (loading) return <LoadingScreen />

  if (!session) {
    const redirect = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?redirect=${redirect}`} replace />
  }

  if (requiredRole) {
    // Wait for the role to resolve before judging access (avoid a false 403 flash).
    if (team.loading) return <LoadingScreen />
    if (!team.role || roleRank(team.role) < roleRank(requiredRole)) {
      return <Navigate to="/forbidden" replace />
    }
  }

  return <>{children}</>
}

import { lazy, Suspense } from 'react'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/contexts/AuthContext'
import { useTeamContext } from '@/contexts/TeamContext'

// Both variants are lazy so neither bloats the entry chunk.
const MockPhonesView = lazy(() => import('./phones-view').then((m) => ({ default: m.PhonesView })))
const SupabaseDevicesView = lazy(() => import('./supabase-devices-view').then((m) => ({ default: m.SupabaseDevicesView })))

const Loading = () => <div className="flex h-full items-center justify-center"><Spinner size={22} /></div>

/**
 * Picks the live Supabase device view when Supabase is configured and a team is
 * loaded; otherwise the existing mock fleet view. The branch lives in this
 * parent so each variant owns its own hooks (stable hook order).
 */
export function PhonesRoute() {
  const { enabled } = useAuth()
  const { team, loading } = useTeamContext()

  if (enabled && loading) return <Loading />
  const useSupabase = enabled && !!team
  return (
    <Suspense fallback={<Loading />}>
      {useSupabase ? <SupabaseDevicesView /> : <MockPhonesView />}
    </Suspense>
  )
}

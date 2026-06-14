import { lazy, Suspense } from 'react'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/contexts/AuthContext'
import { useTeamContext } from '@/contexts/TeamContext'

const MockJobsView = lazy(() => import('./jobs-view').then((m) => ({ default: m.JobsView })))
const SupabaseJobsView = lazy(() => import('./supabase-jobs-view').then((m) => ({ default: m.SupabaseJobsView })))

const Loading = () => <div className="flex h-full items-center justify-center"><Spinner size={22} /></div>

/** Live Supabase job pipeline when configured + team loaded; else the mock view. */
export function JobsRoute() {
  const { enabled } = useAuth()
  const { team, loading } = useTeamContext()

  if (enabled && loading) return <Loading />
  const useSupabase = enabled && !!team
  return (
    <Suspense fallback={<Loading />}>
      {useSupabase ? <SupabaseJobsView /> : <MockJobsView />}
    </Suspense>
  )
}

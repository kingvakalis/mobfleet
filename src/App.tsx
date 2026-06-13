import { lazy, Suspense, useSyncExternalStore, type ComponentType } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AppShell } from '@/components/layout/app-shell'
import { ErrorBoundary } from '@/components/system/error-boundary'
import { DeviceDrawer } from '@/components/drawer/device-drawer'
import { ScalePanel } from '@/components/scale/scale-panel'
import { CommandPalette } from '@/components/palette/command-palette'
import { SubmitJobDialog } from '@/components/jobs/submit-job-dialog'
import { StyleGuide } from '@/components/style/style-guide'
const PhoneControlPage = lazy(() => import('@/components/phone/phone-control-page').then(m => ({ default: m.PhoneControlPage })))
import { Spinner } from '@/components/ui/spinner'
import { AccessDenied } from '@/components/access/Can'
import { EXPO_OUT } from '@/lib/motion'
import { useUIStore } from '@/state/ui-store'
import { VIEW_REQUIRED, type ViewId } from '@/lib/views'
import { useActingMember } from '@/lib/authorization/use-access'
import { canAny } from '@/lib/authorization/effective-access'

const FleetView       = lazy(() => import('@/components/fleet/fleet-view').then(m => ({ default: m.FleetView })))
const JobsView        = lazy(() => import('@/components/jobs/jobs-view').then(m => ({ default: m.JobsView })))
const AutomationsView = lazy(() => import('@/components/automations/automations-view').then(m => ({ default: m.AutomationsView })))
const GroupsView      = lazy(() => import('@/components/groups/groups-view').then(m => ({ default: m.GroupsView })))
const PhonesView      = lazy(() => import('@/components/phones/phones-view').then(m => ({ default: m.PhonesView })))
const ActivityView    = lazy(() => import('@/components/logs/logs-view').then(m => ({ default: m.ActivityView })))
const AccountsView    = lazy(() => import('@/components/accounts/accounts-view').then(m => ({ default: m.AccountsView })))
const TeamView        = lazy(() => import('@/components/team/team-view').then(m => ({ default: m.TeamView })))
const SettingsView    = lazy(() => import('@/components/settings/settings-view').then(m => ({ default: m.SettingsView })))

function Soon({ label }: { label: string }) {
  return <div className="flex h-full items-center justify-center text-white/20 text-sm">{label}</div>
}

const VIEW_MAP: Record<ViewId, ComponentType> = {
  'phone-control': PhoneControlPage,
  fleet:       FleetView,
  phones:      PhonesView,
  accounts:    AccountsView,
  groups:      GroupsView,
  team:        TeamView,
  automations: AutomationsView,
  jobs:        JobsView,
  scale:       () => <Soon label="Scale — coming soon" />,

  logs:        ActivityView,
  settings:    SettingsView,
}

function subscribeHash(cb: () => void) {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}
function useHash() {
  return useSyncExternalStore(subscribeHash, () => window.location.hash)
}
function ViewFallback() {
  return <div className="flex h-full items-center justify-center"><Spinner size={22} /></div>
}

export default function App() {
  const hash = useHash()
  const view = useUIStore(s => s.view)
  const setView = useUIStore(s => s.setView)
  const member = useActingMember()
  const Current = VIEW_MAP[view] ?? VIEW_MAP.fleet
  // Centralized route guard: the active view must be permitted for the acting
  // user. Computed synchronously from the store, so restricted content never
  // flashes before redirect. (Backend remains the source of truth once wired.)
  const allowed = canAny(member, VIEW_REQUIRED[view] ?? [])
  if (hash === '#style') return <StyleGuide />
  return (
    <>
    <AppShell>
      <AnimatePresence mode="wait">
        <motion.div
          key={allowed ? view : `denied-${view}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.24, ease: EXPO_OUT }}
          className="h-full"
        >
          {allowed ? (
            // Per-view fault barrier: a crash in one view shows a recoverable
            // fallback instead of taking down the whole shell, and navigating to
            // another view (resetKeys=[view]) clears it without a reload.
            <ErrorBoundary resetKeys={[view]} label={view}>
              <Suspense fallback={<ViewFallback />}>
                <Current />
              </Suspense>
            </ErrorBoundary>
          ) : (
            <AccessDenied onBack={() => setView('fleet')} />
          )}
        </motion.div>
      </AnimatePresence>
      <DeviceDrawer />
      <ScalePanel />
      <SubmitJobDialog />
      <CommandPalette />
    </AppShell>
    </>
  )
}

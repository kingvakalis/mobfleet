import { lazy, Suspense, useSyncExternalStore, type ComponentType } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AppShell } from '@/components/layout/app-shell'
import { DeviceDrawer } from '@/components/drawer/device-drawer'
import { ScalePanel } from '@/components/scale/scale-panel'
import { CommandPalette } from '@/components/palette/command-palette'
import { SubmitJobDialog } from '@/components/jobs/submit-job-dialog'
import { StyleGuide } from '@/components/style/style-guide'
import { Spinner } from '@/components/ui/spinner'
import { EXPO_OUT } from '@/lib/motion'
import { useUIStore } from '@/state/ui-store'
import type { View } from '@/lib/views'

// Split the heavy view chunks (React Flow lives in FleetView) out of first paint.
const FleetView = lazy(() => import('@/components/fleet/fleet-view').then((m) => ({ default: m.FleetView })))
const JobsView = lazy(() => import('@/components/jobs/jobs-view').then((m) => ({ default: m.JobsView })))
const AutomationsView = lazy(() =>
  import('@/components/automations/automations-view').then((m) => ({ default: m.AutomationsView })),
)
const ProxiesView = lazy(() => import('@/components/proxies/proxies-view').then((m) => ({ default: m.ProxiesView })))
const GroupsView = lazy(() => import('@/components/groups/groups-view').then((m) => ({ default: m.GroupsView })))

const VIEW_MAP: Record<View, ComponentType> = {
  fleet: FleetView,
  jobs: JobsView,
  automations: AutomationsView,
  proxies: ProxiesView,
  groups: GroupsView,
}

// `#style` escape hatch → the Slice-0 design-system page (dev reference).
function subscribeHash(cb: () => void) {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}
function useHash() {
  return useSyncExternalStore(subscribeHash, () => window.location.hash)
}

function ViewFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner size={22} />
    </div>
  )
}

export default function App() {
  const hash = useHash()
  const view = useUIStore((s) => s.view)
  const Current = VIEW_MAP[view]

  if (hash === '#style') return <StyleGuide />

  return (
    <AppShell>
      <AnimatePresence mode="wait">
        <motion.div
          key={view}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.24, ease: EXPO_OUT }}
          className="h-full"
        >
          <Suspense fallback={<ViewFallback />}>
            <Current />
          </Suspense>
        </motion.div>
      </AnimatePresence>
      <DeviceDrawer />
      <ScalePanel />
      <SubmitJobDialog />
      <CommandPalette />
    </AppShell>
  )
}

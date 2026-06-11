import { lazy, Suspense, useSyncExternalStore } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AppShell } from '@/components/layout/app-shell'
import { DeviceDrawer } from '@/components/drawer/device-drawer'
import { ScalePanel } from '@/components/scale/scale-panel'
import { CommandPalette } from '@/components/palette/command-palette'
import { StyleGuide } from '@/components/style/style-guide'
import { EXPO_OUT } from '@/lib/motion'
import { useUIStore } from '@/state/ui-store'

// Split the heavy view chunks (React Flow lives in FleetView) out of first paint.
const FleetView = lazy(() =>
  import('@/components/fleet/fleet-view').then((m) => ({ default: m.FleetView })),
)
const JobsView = lazy(() =>
  import('@/components/jobs/jobs-view').then((m) => ({ default: m.JobsView })),
)

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
      <span className="label text-fg-muted">Loading…</span>
    </div>
  )
}

export default function App() {
  const hash = useHash()
  const view = useUIStore((s) => s.view)

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
            {view === 'fleet' ? <FleetView /> : <JobsView />}
          </Suspense>
        </motion.div>
      </AnimatePresence>
      <DeviceDrawer />
      <ScalePanel />
      <CommandPalette />
    </AppShell>
  )
}

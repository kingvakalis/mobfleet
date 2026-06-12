import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Layers, Box, Network, Activity, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { useFleet, useFleetStats } from '@/hooks/use-fleet'
import { EXPO_OUT } from '@/lib/motion'
import { graphBus } from '@/lib/graph-bus'
import { isLayoutLocked, setLayoutLocked, resetLayout } from '@/lib/layout/constellation'
import { useUIStore } from '@/state/ui-store'
import { FleetGraph } from './fleet-graph'
import { Fleet3D } from './fleet-3d'
import { FleetControls } from './fleet-controls'
import { FleetActivityDrawer } from './fleet-right-panel'

type ViewMode = '2d' | '3d'

function Crosshair() {
  return (
    <svg width="220" height="220" viewBox="0 0 220 220" fill="none" aria-hidden className="opacity-60">
      <circle cx="110" cy="110" r="64" stroke="var(--border)" strokeWidth="1" strokeDasharray="2 6" />
      <path d="M110 14v40 M110 166v40 M14 110h40 M166 110h40" stroke="var(--border)" strokeWidth="1" />
      <circle cx="110" cy="110" r="3" fill="var(--text-muted)" />
    </svg>
  )
}

function FleetBoot() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <Spinner size={22} />
      <Label className="text-fg-muted">Establishing Uplink</Label>
    </div>
  )
}

function FleetEmpty() {
  const openScale = useUIStore((s) => s.openScale)
  return (
    <div className="relative flex h-full items-center justify-center">
      <div className="pointer-events-none absolute"><Crosshair /></div>
      <div className="relative flex flex-col items-center gap-4 text-center">
        <Label className="text-fg-secondary">No Devices In Pool</Label>
        <p className="mono max-w-[260px] text-[11px] leading-relaxed text-fg-muted">
          The fleet is empty. Provision cloud phones to begin running jobs.
        </p>
        <Button variant="primary" size="sm" onClick={openScale}>
          <Layers size={14} /> Provision Devices
        </Button>
      </div>
    </div>
  )
}

export function FleetView() {
  const snapshot = useFleet()
  const stats    = useFleetStats()
  // Filters live in the UI store so they survive 2D↔3D switches and
  // phone-control round-trips (session-scoped, not permanently saved).
  const filters    = useUIStore((s) => s.fleetFilters)
  const setFilters = useUIStore((s) => s.setFleetFilters)

  const [mode, setMode] = useState<ViewMode>('2d')
  const [activityOpen, setActivityOpen] = useState(false)
  const [locked, setLockedState] = useState(() => isLayoutLocked())
  const [layoutEpoch, setLayoutEpoch] = useState(0)

  const setLocked = (v: boolean) => {
    setLayoutLocked(v)
    setLockedState(v)
  }

  const handleResetPositions = () => {
    if (!window.confirm('Reset all phone positions? This deletes your custom arrangement.')) return
    resetLayout()
    // Remount the graph so phyllotaxis re-applies, then refit.
    setLayoutEpoch((e) => e + 1)
    setTimeout(() => graphBus.fitView?.(), 80)
  }

  return (
    <AnimatePresence mode="wait">
      {!snapshot.ready ? (
        <motion.div key="boot" className="h-full" exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          <FleetBoot />
        </motion.div>
      ) : snapshot.devices.length === 0 ? (
        <motion.div key="empty" className="h-full" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <FleetEmpty />
        </motion.div>
      ) : (
        <motion.div
          key="graph"
          className="relative flex h-full w-full"
          initial={{ opacity: 0, scale: 0.99 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.45, ease: EXPO_OUT }}
        >
          <div className="flex-1 relative">
            {/* View mode toggle + activity */}
            <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
              <div className="flex items-center gap-1 rounded-lg bg-black/40 border border-line p-1 backdrop-blur-sm">
                <button
                  onClick={() => setMode('3d')}
                  className={['mono flex items-center gap-1.5 px-3 py-1.5 text-[9px] uppercase tracking-widest transition-colors', mode === '3d' ? 'bg-white text-black' : 'text-white/40 hover:text-white/70'].join(' ')}
                >
                  <Box size={12} /> 3D
                </button>
                <button
                  onClick={() => setMode('2d')}
                  className={['mono flex items-center gap-1.5 px-3 py-1.5 text-[9px] uppercase tracking-widest transition-colors', mode === '2d' ? 'bg-white text-black' : 'text-white/40 hover:text-white/70'].join(' ')}
                >
                  <Network size={12} /> Graph
                </button>
              </div>
              <button
                onClick={() => setActivityOpen(o => !o)}
                title="Live activity & fleet health"
                className={[
                  'mono flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[9px] uppercase tracking-widest backdrop-blur-sm transition-colors',
                  activityOpen
                    ? 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]'
                    : 'border-line bg-black/40 text-white/40 hover:text-white/70',
                ].join(' ')}
              >
                <Activity size={12} /> Activity
              </button>
            </div>

            {/* Fleet info HUD */}
            <div className="absolute left-4 top-4 z-20">
              <div className="pointer-events-none px-3 py-2 rounded-lg bg-black/40 border border-line backdrop-blur-sm">
                <Label className="text-fg-muted">FLEET · CONSTELLATION</Label>
                <div className="mono mt-1 text-[11px] text-fg-secondary">
                  {stats.total} NODES · {stats.busy} ACTIVE · {stats.idle} IDLE
                </div>
              </div>
              {locked && (
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-control border border-amber-400/35 bg-amber-400/10 px-2.5 py-1.5">
                  <Lock size={10} className="text-amber-400" />
                  <span className="mono text-[9px] uppercase tracking-wider text-amber-400">Layout locked</span>
                </div>
              )}
            </div>

            {/* Floating filter + layout bar */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20">
              <FleetControls
                filters={filters}
                setFilters={setFilters}
                locked={locked}
                setLocked={setLocked}
                onResetPositions={handleResetPositions}
                onFocusMatches={() => graphBus.focusMatches?.()}
              />
            </div>

            {/* Visualization */}
            {mode === '3d'
              ? <Fleet3D filters={filters} />
              : <FleetGraph key={layoutEpoch} filters={filters} locked={locked} />}
          </div>

          {/* Collapsible activity / health drawer */}
          <FleetActivityDrawer open={activityOpen} onClose={() => setActivityOpen(false)} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

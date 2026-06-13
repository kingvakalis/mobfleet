import { lazy, Suspense, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Layers, Box, Network, Activity, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { useFleet } from '@/hooks/use-fleet'
import { useScopedDevices, useScopedFleetStats } from '@/lib/authorization/use-access'
import { STATUS, type DeviceStatus } from '@/lib/status'
import { EXPO_OUT } from '@/lib/motion'
import { graphBus } from '@/lib/graph-bus'
import { isLayoutLocked, setLayoutLocked, resetLayout } from '@/lib/layout/constellation'
import { useUIStore } from '@/state/ui-store'
import { FleetGraph } from './fleet-graph'
// Fleet3D pulls in three.js / @react-three (~1.3 MB). Lazy-load it so that
// weight is code-split into its own chunk and only fetched when an operator
// actually switches to the 3D view — the default 2D graph stays light.
const Fleet3D = lazy(() => import('./fleet-3d').then((m) => ({ default: m.Fleet3D })))
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

/**
 * Fleet Status strip for the 2D view — same telemetry as the 3D health bar,
 * but rendered in the flat hairline HUD language of the 2D page (segmented,
 * mono, backdrop-blur) so it reads as part of the constellation overlay.
 */
function FleetStatusStrip() {
  const devices = useScopedDevices()
  const stats = useScopedFleetStats()
  const counts = useMemo(() => {
    const c: Record<DeviceStatus, number> = { online: 0, busy: 0, warming: 0, offline: 0, error: 0 }
    for (const d of devices) c[d.status as DeviceStatus]++
    return c
  }, [devices])

  const segments: { label: string; value: number; color: string; dot?: boolean }[] = [
    { label: 'Total',   value: stats.total,    color: 'rgba(255,255,255,0.72)' },
    { label: 'Online',  value: counts.online,  color: STATUS.online.color,  dot: true },
    { label: 'Busy',    value: counts.busy,    color: STATUS.busy.color,    dot: true },
    { label: 'Warming', value: counts.warming, color: STATUS.warming.color, dot: true },
    { label: 'Offline', value: counts.offline, color: 'rgba(255,255,255,0.32)', dot: true },
    { label: 'Error',   value: counts.error,   color: STATUS.error.color,   dot: true },
    { label: 'Queue',   value: stats.queue,    color: 'rgba(255,255,255,0.5)' },
  ]

  return (
    <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2">
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EXPO_OUT }}
        className="flex items-stretch overflow-hidden rounded-lg border border-line bg-black/40 backdrop-blur-sm"
      >
        <div className="flex items-center gap-1.5 border-r border-line px-3">
          <Activity size={10} className="text-fg-muted" />
          <span className="mono text-[9px] uppercase tracking-[0.18em] text-fg-muted">Fleet Status</span>
        </div>
        {segments.map((s) => (
          <div key={s.label} className="flex min-w-[52px] flex-col items-center justify-center gap-0.5 border-l border-line/60 px-3 py-1.5 first:border-l-0">
            <span className="mono text-[13px] font-bold leading-none tabular-nums" style={{ color: s.color }}>{s.value}</span>
            <span className="mono flex items-center gap-1 text-[7.5px] uppercase tracking-[0.16em] text-white/30">
              {s.dot && <span className="h-1 w-1 rounded-full" style={{ background: s.color }} />}
              {s.label}
            </span>
          </div>
        ))}
      </motion.div>
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
  const scopedDevices = useScopedDevices()
  const stats    = useScopedFleetStats()
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
      ) : scopedDevices.length === 0 ? (
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

            {/* Fleet status — 2D view (3D has its own collapsible health bar) */}
            {mode === '2d' && <FleetStatusStrip />}

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
              ? <Suspense fallback={<FleetBoot />}><Fleet3D filters={filters} /></Suspense>
              : <FleetGraph key={layoutEpoch} filters={filters} locked={locked} />}
          </div>

          {/* Collapsible activity / health drawer */}
          <FleetActivityDrawer open={activityOpen} onClose={() => setActivityOpen(false)} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

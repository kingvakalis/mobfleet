import { AnimatePresence, motion } from 'framer-motion'
import { Layers, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { useFleet, useFleetStats } from '@/hooks/use-fleet'
import { EXPO_OUT } from '@/lib/motion'
import { useUIStore } from '@/state/ui-store'
import { FleetGraph } from './fleet-graph'

function Crosshair() {
  return (
    <svg width="220" height="220" viewBox="0 0 220 220" fill="none" aria-hidden className="opacity-60">
      <circle cx="110" cy="110" r="64" stroke="var(--border)" strokeWidth="1" strokeDasharray="2 6" />
      <path d="M110 14v40 M110 166v40 M14 110h40 M166 110h40" stroke="var(--border)" strokeWidth="1" />
      <circle cx="110" cy="110" r="3" fill="var(--text-muted)" />
    </svg>
  )
}

/** Uplink handshake — before the fleet snapshot is live. */
function FleetBoot() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <Spinner size={22} />
      <Label className="text-fg-muted">Establishing Uplink</Label>
    </div>
  )
}

/** Pool drained to zero. */
function FleetEmpty() {
  const openScale = useUIStore((s) => s.openScale)
  return (
    <div className="relative flex h-full items-center justify-center">
      <div className="pointer-events-none absolute">
        <Crosshair />
      </div>
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

/** The default screen: the live node constellation with a HUD overlay. */
export function FleetView() {
  const snapshot = useFleet()
  const stats = useFleetStats()
  const groupFilter = useUIStore((s) => s.groupFilter)
  const setGroupFilter = useUIStore((s) => s.setGroupFilter)

  const inGroup = groupFilter
    ? snapshot.devices.filter((d) => d.group === groupFilter).length
    : stats.total

  return (
    <AnimatePresence mode="wait">
      {!snapshot.ready ? (
        <motion.div
          key="boot"
          className="h-full"
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.2, ease: EXPO_OUT }}
        >
          <FleetBoot />
        </motion.div>
      ) : snapshot.devices.length === 0 ? (
        <motion.div
          key="empty"
          className="h-full"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, ease: EXPO_OUT }}
        >
          <FleetEmpty />
        </motion.div>
      ) : (
        <motion.div
          key="graph"
          className="relative h-full w-full"
          initial={{ opacity: 0, scale: 0.99 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.45, ease: EXPO_OUT }}
        >
          <FleetGraph />
          <div className="absolute left-4 top-4 z-10">
            <div className="pointer-events-none">
              <Label className="text-fg-muted">FLEET · CONSTELLATION</Label>
              <div className="mono mt-1 text-[11px] text-fg-secondary">
                {stats.total} NODES · {stats.busy} ACTIVE · {stats.idle} IDLE
              </div>
            </div>
            {groupFilter && (
              <button
                type="button"
                onClick={() => setGroupFilter(null)}
                className="mt-3 inline-flex items-center gap-2 rounded-control border border-accent/40 bg-accent/10 px-2.5 py-1.5 transition-colors hover:bg-accent/20"
              >
                <span className="label text-accent">{groupFilter}</span>
                <span className="mono text-[10px] text-fg-muted">{inGroup}</span>
                <X size={12} className="text-fg-muted" />
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

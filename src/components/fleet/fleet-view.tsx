import { Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useFleet, useFleetStats } from '@/hooks/use-fleet'
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
    <div className="flex h-full flex-col items-center justify-center gap-6">
      <div className="flex gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-14 rounded-[10px]" />
        ))}
      </div>
      <div className="text-center">
        <Label className="text-fg-secondary">Establishing Uplink</Label>
        <div className="mono mt-2 text-[11px] text-fg-muted">syncing fleet state…</div>
      </div>
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

  if (!snapshot.ready) return <FleetBoot />
  if (snapshot.devices.length === 0) return <FleetEmpty />

  return (
    <div className="relative h-full w-full">
      <FleetGraph />
      <div className="pointer-events-none absolute left-4 top-4 z-10">
        <Label className="text-fg-muted">FLEET · CONSTELLATION</Label>
        <div className="mono mt-1 text-[11px] text-fg-secondary">
          {stats.total} NODES · {stats.busy} ACTIVE · {stats.idle} IDLE
        </div>
      </div>
    </div>
  )
}

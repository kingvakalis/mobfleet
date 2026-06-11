import { Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Hairline } from '@/components/ui/hairline'
import { useFleet, useFleetStats } from '@/hooks/use-fleet'
import { formatCost } from '@/lib/format'
import { useUIStore } from '@/state/ui-store'
import { KbdHint } from './kbd-hint'
import { LiveIndicator } from './live-indicator'
import { OrchestratorMark } from './orchestrator-mark'
import { StatCell } from './stat-cell'
import { ViewSwitcher } from './view-switcher'

/** Always-visible mission-control strip: identity · views · live telemetry. */
export function HeaderStrip() {
  const stats = useFleetStats()
  const ready = useFleet().ready
  const view = useUIStore((s) => s.view)
  const onViewChange = useUIStore((s) => s.setView)
  const openScale = useUIStore((s) => s.openScale)
  const openPalette = useUIStore((s) => s.openPalette)

  return (
    <header className="flex h-16 shrink-0 items-stretch border-b border-line bg-canvas">
      {/* Identity */}
      <div className="flex items-center gap-3 pl-5 pr-4">
        <OrchestratorMark />
        <div className="leading-tight">
          <div className="label text-fg">ORCHESTRATOR</div>
          <div className="mono mt-0.5 text-[10px] text-fg-muted">FLEET CONTROL · V0</div>
        </div>
      </div>

      <Hairline vertical />
      <div className="flex items-center px-4">
        <ViewSwitcher value={view} onChange={onViewChange} />
      </div>
      <Hairline vertical />

      {/* Live counter rail */}
      <div className="flex flex-1 items-stretch overflow-x-auto">
        <StatCell label="DEVICES" value={stats.total} loading={!ready} />
        <StatCell label="IDLE" value={stats.idle} dotStatus="online" loading={!ready} />
        <StatCell label="BUSY" value={stats.busy} dotStatus="busy" loading={!ready} />
        <StatCell label="QUEUE DEPTH" value={stats.queue} dotStatus="warming" loading={!ready} />
        <StatCell label="COST/HR" value={stats.costPerHr} format={formatCost} accent loading={!ready} />
      </div>

      {/* Actions + stream status */}
      <div className="flex items-center gap-3 px-5">
        <Button variant="outline" size="sm" onClick={openScale}>
          <Layers size={14} /> Scale
        </Button>
        <Hairline vertical className="h-6 self-center" />
        <LiveIndicator />
        <KbdHint keys={['⌘', 'K']} onClick={openPalette} />
      </div>
    </header>
  )
}

import { Maximize, Minus, Plus } from 'lucide-react'
import { useReactFlow, useStore } from '@xyflow/react'

const btn =
  'flex h-8 items-center justify-center text-fg-muted transition-colors hover:bg-elevated hover:text-fg'

/** HUD zoom controls with a live zoom readout. */
export function GraphControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const zoom = useStore((s) => s.transform[2])

  return (
    <div className="absolute bottom-4 left-4 z-10 flex items-center overflow-hidden rounded-control border border-line bg-panel">
      <button type="button" aria-label="Zoom out" className={`${btn} w-8`} onClick={() => zoomOut({ duration: 200 })}>
        <Minus size={14} />
      </button>
      <div className="h-8 w-px bg-line" />
      <button
        type="button"
        aria-label="Fit to screen"
        className={`${btn} gap-1.5 px-2.5`}
        onClick={() => fitView({ padding: 0.28, duration: 400 })}
      >
        <Maximize size={12} />
        <span className="mono text-[11px] tabular-nums">{Math.round(zoom * 100)}%</span>
      </button>
      <div className="h-8 w-px bg-line" />
      <button type="button" aria-label="Zoom in" className={`${btn} w-8`} onClick={() => zoomIn({ duration: 200 })}>
        <Plus size={14} />
      </button>
    </div>
  )
}

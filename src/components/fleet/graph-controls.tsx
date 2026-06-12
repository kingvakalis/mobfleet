import { LayoutGrid, Maximize, Minus, Plus } from 'lucide-react'
import { useReactFlow, useStore } from '@xyflow/react'
import { resetLayout, positionFor } from '@/lib/layout/constellation'
import { NODE_H, NODE_W } from './device-node'

const btn =
  'flex h-8 items-center justify-center text-fg-muted transition-colors hover:bg-elevated hover:text-fg'

/** HUD zoom + layout controls with a live zoom readout. */
export function GraphControls() {
  const { zoomIn, zoomOut, fitView, setNodes } = useReactFlow()
  const zoom = useStore((s) => s.transform[2])

  const autoArrange = () => {
    resetLayout()
    setNodes((ns) =>
      ns.map((n) => {
        if (n.type !== 'device') return n
        const p = positionFor(n.id)
        return { ...n, position: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 } }
      }),
    )
    setTimeout(() => void fitView({ padding: 0.28, duration: 400 }), 50)
  }

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
      <div className="h-8 w-px bg-line" />
      <button
        type="button"
        aria-label="Auto-arrange layout"
        title="Auto-arrange (clears saved positions)"
        className={`${btn} w-8`}
        onClick={autoArrange}
      >
        <LayoutGrid size={13} />
      </button>
    </div>
  )
}

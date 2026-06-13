import { useEffect, useState } from 'react'
import { useViewport } from '@xyflow/react'
import type { FleetForceSim } from '@/lib/layout/force-sim'

/**
 * DEV-ONLY physics visualiser (toggle with "g" on the Fleet graph). Draws the
 * preferred orbit rings, each phone's target slot, live velocity vectors, the
 * core's home anchor, and a numeric HUD (energy / settled / dragging). Never
 * mounted in production — purely a tool to verify the simulation is doing what
 * the spec requires (back-reaction exists, drags release, the field settles).
 */
export function PhysicsDebugLayer({ sim }: { sim: FleetForceSim }) {
  const vp = useViewport()
  const [, force] = useState(0)

  // Re-render every frame so the overlay tracks the live simulation.
  useEffect(() => {
    let raf = 0
    const loop = () => {
      force((n) => (n + 1) % 1_000_000)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  const snap = sim.debugSnapshot()
  const rings = [...new Set(snap.nodes.map((n) => Math.round(n.targetR)))].sort((a, b) => a - b)
  const VSCALE = 0.25 // velocity vector length scale

  return (
    <>
      <svg className="pointer-events-none absolute inset-0 z-50 h-full w-full" style={{ overflow: 'visible' }}>
        <g transform={`translate(${vp.x},${vp.y}) scale(${vp.zoom})`}>
          {/* preferred orbit rings */}
          {rings.map((r) => (
            <circle
              key={r}
              cx={snap.core.x}
              cy={snap.core.y}
              r={r}
              fill="none"
              stroke="rgba(45,212,191,0.18)"
              strokeWidth={1 / vp.zoom}
              strokeDasharray={`${4 / vp.zoom} ${4 / vp.zoom}`}
            />
          ))}
          {/* core home anchor */}
          <circle cx={snap.home.x} cy={snap.home.y} r={6 / vp.zoom} fill="none" stroke="#fbbf24" strokeWidth={1 / vp.zoom} />
          <line x1={snap.home.x} y1={snap.home.y} x2={snap.core.x} y2={snap.core.y} stroke="#fbbf24" strokeWidth={1 / vp.zoom} opacity={0.5} />
          {snap.nodes.map((n) => {
            const tx = snap.core.x + n.targetR * Math.cos(n.targetA)
            const ty = snap.core.y + n.targetR * Math.sin(n.targetA)
            const col = n.pinned ? '#fbbf24' : n.dragging ? '#ff4d4d' : '#7ce8da'
            return (
              <g key={n.id}>
                {/* target orbital slot */}
                <circle cx={tx} cy={ty} r={3 / vp.zoom} fill="none" stroke="rgba(124,232,218,0.5)" strokeWidth={1 / vp.zoom} />
                {/* velocity vector */}
                <line x1={n.x} y1={n.y} x2={n.x + n.vx * VSCALE} y2={n.y + n.vy * VSCALE} stroke={col} strokeWidth={1.5 / vp.zoom} />
                <circle cx={n.x} cy={n.y} r={2.5 / vp.zoom} fill={col} />
              </g>
            )
          })}
        </g>
      </svg>
      <div className="pointer-events-none absolute bottom-3 left-3 z-50 rounded border border-line bg-black/70 px-2.5 py-1.5 font-mono text-[10px] leading-relaxed text-white/70 backdrop-blur">
        <div className="mb-0.5 uppercase tracking-widest text-[var(--accent-text)]">physics · debug (g)</div>
        <div>nodes: {snap.nodes.length} · pinned: {snap.nodes.filter((n) => n.pinned).length}</div>
        <div>maxSpeed: {snap.maxSpeed.toFixed(1)} px/s · energy: {snap.energy.toFixed(3)}</div>
        <div>settled: {String(snap.settled)} · dragging: {String(snap.dragging)}</div>
        <div>core: {snap.core.x.toFixed(0)},{snap.core.y.toFixed(0)} {snap.core.dragging ? '(dragging)' : ''}</div>
      </div>
    </>
  )
}

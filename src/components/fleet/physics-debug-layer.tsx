import { useEffect, useState, type RefObject } from 'react'
import { useViewport } from '@xyflow/react'
import type { FleetForceSim } from '@/lib/layout/force-sim'

/**
 * DEV-ONLY physics visualiser (toggle with "g" on the Fleet graph). Draws the
 * preferred orbit rings, each phone's target slot, live velocity vectors, the
 * core's home anchor, a numeric HUD, a per-phone inspector, and the spec §16
 * warnings (leaked drag anchors, selection coupling, non-finite state, sim
 * membership drift). Never mounted in production — purely a tool to verify the
 * simulation is doing what the spec requires.
 */
export function PhysicsDebugLayer({
  sim,
  selectedIds,
  draggingIdRef,
  activeIds,
}: {
  sim: FleetForceSim
  selectedIds: string[]
  draggingIdRef: RefObject<string | null>
  activeIds: string[]
}) {
  const vp = useViewport()
  const [, force] = useState(0)
  // Mirror the pointer-owned id into state from inside the RAF effect — reading
  // a ref during render is disallowed, but reading it in an effect is fine.
  const [draggingId, setDraggingId] = useState<string | null>(null)

  // Re-render every frame so the overlay tracks the live simulation.
  useEffect(() => {
    let raf = 0
    const loop = () => {
      force((n) => (n + 1) % 1_000_000)
      setDraggingId(draggingIdRef.current)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [draggingIdRef])

  const snap = sim.debugSnapshot()
  const selected = new Set(selectedIds)
  const rings = [...new Set(snap.nodes.map((n) => Math.round(n.targetR)))].sort((a, b) => a - b)
  const VSCALE = 0.25 // velocity vector length scale

  // ── §16 warnings ───────────────────────────────────────────────────────────
  const warnings: string[] = []
  // Membership: the single sim must hold exactly the active phones.
  const simIds = new Set(snap.nodes.map((n) => n.id))
  const missing = activeIds.filter((id) => !simIds.has(id))
  if (snap.nodes.length !== activeIds.length || missing.length > 0) {
    warnings.push(`sim/active mismatch: ${snap.nodes.length} vs ${activeIds.length}` + (missing.length ? ` (missing ${missing.slice(0, 3).join(',')}${missing.length > 3 ? '…' : ''})` : ''))
  }
  for (const n of snap.nodes) {
    // Leaked drag anchor — anchored but neither pinned nor actively dragged.
    if (n.dragging && !n.pinned && n.id !== draggingId) {
      warnings.push(`${n.id}: leaked drag anchor (frozen, no active drag)`)
    }
    // Selection must never anchor a phone.
    if (selected.has(n.id) && n.dragging && !n.pinned && n.id !== draggingId) {
      warnings.push(`${n.id}: selected AND anchored (selection coupled to physics)`)
    }
    if (!n.finite) warnings.push(`${n.id}: non-finite physics state`)
  }
  if (snap.repaired > 0) warnings.push(`repaired ${snap.repaired} invalid value(s) last tick`)
  if (!Number.isFinite(snap.core.x) || !Number.isFinite(snap.core.y)) warnings.push('core: non-finite position')

  // Inspector focus: the selected phone, else the dragged one, else the fastest.
  const focusId = selectedIds[0] ?? draggingId ?? null
  const focus = focusId ? snap.nodes.find((n) => n.id === focusId) ?? null : null

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
          {/* core velocity vector */}
          <line x1={snap.core.x} y1={snap.core.y} x2={snap.core.x + snap.core.vx * VSCALE} y2={snap.core.y + snap.core.vy * VSCALE} stroke="#fbbf24" strokeWidth={2 / vp.zoom} />
          {snap.nodes.map((n) => {
            const tx = snap.core.x + n.targetR * Math.cos(n.targetA)
            const ty = snap.core.y + n.targetR * Math.sin(n.targetA)
            const isFocus = n.id === focusId
            const col = !n.finite ? '#ff00ff' : n.pinned ? '#fbbf24' : n.dragging ? '#ff4d4d' : selected.has(n.id) ? '#a78bfa' : '#7ce8da'
            return (
              <g key={n.id}>
                {/* target orbital slot */}
                <circle cx={tx} cy={ty} r={3 / vp.zoom} fill="none" stroke="rgba(124,232,218,0.5)" strokeWidth={1 / vp.zoom} />
                {/* velocity vector */}
                <line x1={n.x} y1={n.y} x2={n.x + n.vx * VSCALE} y2={n.y + n.vy * VSCALE} stroke={col} strokeWidth={1.5 / vp.zoom} />
                <circle cx={n.x} cy={n.y} r={(isFocus ? 4 : 2.5) / vp.zoom} fill={col} />
                {isFocus && <circle cx={n.x} cy={n.y} r={9 / vp.zoom} fill="none" stroke={col} strokeWidth={1 / vp.zoom} />}
              </g>
            )
          })}
        </g>
      </svg>

      {/* HUD */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-50 rounded border border-line bg-black/70 px-2.5 py-1.5 font-mono text-[10px] leading-relaxed text-white/70 backdrop-blur">
        <div className="mb-0.5 uppercase tracking-widest text-[var(--accent-text)]">physics · debug (g)</div>
        <div>nodes: {snap.nodes.length}/{activeIds.length} · pinned: {snap.nodes.filter((n) => n.pinned).length} · sel: {selectedIds.length}</div>
        <div>maxSpeed: {snap.maxSpeed.toFixed(1)} px/s · energy: {snap.energy.toFixed(3)}</div>
        <div>settled: {String(snap.settled)} · dragging: {String(snap.dragging)}{draggingId ? ` (${draggingId})` : ''}</div>
        <div>
          core: {snap.core.x.toFixed(0)},{snap.core.y.toFixed(0)} v=
          {Math.hypot(snap.core.vx, snap.core.vy).toFixed(0)} F={snap.core.forceMag.toFixed(0)} m=
          {snap.core.mass} bR={snap.core.backReaction} {snap.core.dragging ? '(dragging)' : ''}
        </div>
        {snap.repaired > 0 && <div className="text-amber-400">repaired: {snap.repaired}</div>}
      </div>

      {/* Per-phone inspector (focused node) */}
      {focus && (
        <div className="pointer-events-none absolute bottom-3 right-3 z-50 w-56 rounded border border-line bg-black/70 px-2.5 py-1.5 font-mono text-[10px] leading-relaxed text-white/70 backdrop-blur">
          <div className="mb-0.5 uppercase tracking-widest text-[var(--accent-text)]">inspector · {focus.id}</div>
          <div>selected: {String(selected.has(focus.id))} · dragged: {String(focus.id === draggingId)}</div>
          <div>pinned: {String(focus.pinned)} · inSim: {String(simIds.has(focus.id))}</div>
          <div>fx/fy: {focus.dragX === null ? 'null' : focus.dragX.toFixed(0)},{focus.dragY === null ? 'null' : focus.dragY.toFixed(0)}</div>
          <div>x,y: {focus.x.toFixed(0)},{focus.y.toFixed(0)}</div>
          <div>v: {focus.vx.toFixed(1)},{focus.vy.toFixed(1)} (|v|={Math.hypot(focus.vx, focus.vy).toFixed(1)})</div>
          <div>F: {focus.forceMag.toFixed(0)}</div>
          <div>distCore: {focus.distCore.toFixed(0)} · radialErr: {focus.radialErr.toFixed(0)}</div>
          <div>finite: {String(focus.finite)}</div>
        </div>
      )}

      {/* §16 warnings */}
      {warnings.length > 0 && (
        <div className="pointer-events-none absolute top-3 right-3 z-50 max-w-xs rounded border border-red-500/60 bg-black/80 px-2.5 py-1.5 font-mono text-[10px] leading-relaxed text-red-300 backdrop-blur">
          <div className="mb-0.5 uppercase tracking-widest text-red-400">physics warnings</div>
          {warnings.slice(0, 8).map((w, i) => (
            <div key={i}>⚠ {w}</div>
          ))}
        </div>
      )}
    </>
  )
}

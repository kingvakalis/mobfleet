/**
 * Lightweight d3-force-style simulation for the fleet constellation.
 * Custom (no dependency): at fleet scale (≤ a few hundred nodes) naive O(n²)
 * repulsion is far below frame budget, and owning the integrator lets drags,
 * pinning, persistence, and "breathing" behave exactly as specified.
 *
 * Model: every phone is tethered to the core by a spring whose rest length is
 * its saved radius (manual arrangements stay equilibria), phones repel each
 * other, the core is heavy. Pin a node (drag) and its neighbors are pulled
 * elastically, then settle with damping. A tiny per-node oscillation keeps the
 * field alive at rest.
 */

export interface SimNode {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  /** Pointer pin (drag) — overrides integration while set. */
  fx: number | null
  fy: number | null
  /** Spring rest distance from the core. */
  restLen: number
  /** Unique breathing phase. */
  phase: number
  mass: number
}

const REPULSE = 5200        // phone↔phone charge
const CORE_REPULSE = 16000  // keeps phones off the core
const SPRING_K = 6.5        // spring stiffness (accel per px stretch, /s²)
const DAMP_RATE = 3.4       // exponential velocity damping (/s)
const MAX_V = 1100          // px/s velocity cap (stability on stretched release)
const BREATHE_AMP = 26      // px/s² — reads as ~±1.5px drift at rest
const MIN_DIST = 26

function hashPhase(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return (h % 628) / 100
}

export class FleetForceSim {
  private nodes = new Map<string, SimNode>()
  core: SimNode

  constructor(corePos: { x: number; y: number }) {
    this.core = { id: 'orchestrator', x: corePos.x, y: corePos.y, vx: 0, vy: 0, fx: null, fy: null, restLen: 0, phase: 0, mass: 26 }
  }

  /** Add new devices at their seed positions, drop removed ones. */
  sync(items: { id: string; x: number; y: number }[]) {
    const seen = new Set<string>()
    for (const it of items) {
      seen.add(it.id)
      if (!this.nodes.has(it.id)) {
        const dx = it.x - this.core.x
        const dy = it.y - this.core.y
        this.nodes.set(it.id, {
          id: it.id, x: it.x, y: it.y, vx: 0, vy: 0, fx: null, fy: null,
          restLen: Math.max(120, Math.hypot(dx, dy)),
          phase: hashPhase(it.id),
          mass: 1,
        })
      }
    }
    for (const id of [...this.nodes.keys()]) {
      if (!seen.has(id)) this.nodes.delete(id)
    }
  }

  get(id: string): SimNode | undefined {
    return id === 'orchestrator' ? this.core : this.nodes.get(id)
  }

  all(): SimNode[] {
    return [...this.nodes.values()]
  }

  pin(id: string, x: number, y: number) {
    const n = this.get(id)
    if (!n) return
    n.fx = x
    n.fy = y
  }

  /** Rigid tow: shift every phone by the same offset (core drag carries the
   *  whole constellation — springs stay at rest, so nothing snaps back). */
  translatePhones(dx: number, dy: number) {
    for (const n of this.nodes.values()) {
      n.x += dx
      n.y += dy
      if (n.fx !== null && n.fy !== null) {
        n.fx += dx
        n.fy += dy
      }
    }
  }

  /** Release a pin; phones re-anchor their spring at the dropped radius so
   *  the released position is the new equilibrium. */
  unpin(id: string) {
    const n = this.get(id)
    if (!n) return
    n.fx = null
    n.fy = null
    n.vx = 0
    n.vy = 0
    if (n !== this.core) {
      n.restLen = Math.max(120, Math.hypot(n.x - this.core.x, n.y - this.core.y))
    }
  }

  /** One integration step. `breathe` keeps the field subtly alive at rest. */
  tick(dtRaw: number, t: number, breathe: boolean) {
    const dt = Math.min(dtRaw, 1 / 30)
    const list = this.all()
    const damp = Math.exp(-DAMP_RATE * dt)

    for (let i = 0; i < list.length; i++) {
      const a = list[i]
      if (a.fx !== null) continue
      let ax = 0
      let ay = 0

      // phone ↔ phone repulsion
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue
        const b = list[j]
        let dx = a.x - b.x
        let dy = a.y - b.y
        let d = Math.hypot(dx, dy)
        if (d < 1) { dx = Math.sin(a.phase + i); dy = Math.cos(a.phase + i); d = 1 }
        const dd = Math.max(d, MIN_DIST)
        const f = REPULSE / (dd * dd)
        ax += (dx / d) * f
        ay += (dy / d) * f
      }

      // core repulsion + spring tether
      {
        let dx = a.x - this.core.x
        let dy = a.y - this.core.y
        let d = Math.hypot(dx, dy)
        if (d < 1) { dx = 1; dy = 0; d = 1 }
        const dd = Math.max(d, MIN_DIST)
        const rep = CORE_REPULSE / (dd * dd)
        const stretch = d - a.restLen
        const spring = -SPRING_K * stretch
        ax += (dx / d) * (rep + spring)
        ay += (dy / d) * (rep + spring)
      }

      // breathing — restrained, unique per node
      if (breathe) {
        ax += BREATHE_AMP * Math.sin(t * 0.9 + a.phase)
        ay += BREATHE_AMP * Math.cos(t * 0.7 + a.phase * 1.31)
      }

      a.vx = (a.vx + ax * dt) * damp
      a.vy = (a.vy + ay * dt) * damp
      const v = Math.hypot(a.vx, a.vy)
      if (v > MAX_V) {
        a.vx = (a.vx / v) * MAX_V
        a.vy = (a.vy / v) * MAX_V
      }
    }

    // Core: pulled by every spring (heavy mass — barely drifts unless dragged).
    if (this.core.fx === null) {
      let ax = 0
      let ay = 0
      for (const n of list) {
        let dx = this.core.x - n.x
        let dy = this.core.y - n.y
        let d = Math.hypot(dx, dy)
        if (d < 1) { dx = 1; dy = 0; d = 1 }
        const stretch = d - n.restLen
        ax += (dx / d) * (-SPRING_K * stretch)
        ay += (dy / d) * (-SPRING_K * stretch)
      }
      this.core.vx = (this.core.vx + (ax / this.core.mass) * dt) * damp
      this.core.vy = (this.core.vy + (ay / this.core.mass) * dt) * damp
    }

    // integrate
    for (const n of [...list, this.core]) {
      if (n.fx !== null && n.fy !== null) {
        n.x = n.fx
        n.y = n.fy
        n.vx = 0
        n.vy = 0
      } else {
        n.x += n.vx * dt
        n.y += n.vy * dt
      }
    }
  }
}

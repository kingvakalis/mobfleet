/**
 * Force-directed simulation for the fleet constellation (Obsidian-style).
 * Custom d3-force-style integrator — at fleet scale naive O(n²) repulsion is
 * far below frame budget, and owning the solver lets drags, pinning,
 * persistence, and "breathing" behave exactly as specified.
 *
 * Model
 * - Every phone is tethered to the core by a SPRING (rest length = its saved
 *   radius). Dragging the core pulls phones through these springs: near
 *   phones react sooner/stronger, far ones lag, distances deform organically.
 *   No rigid translation is ever applied.
 * - Phones repel each other (charge) and refuse to overlap (collision).
 * - The CORE is an anchor: it sits exactly where the operator leaves it
 *   (no rebound after release) — only drags move it.
 * - PINNED phones hold their saved coordinates and ignore the field;
 *   unpinned phones participate fully.
 * - A tiny per-node oscillation keeps the field alive at rest (optional).
 */

// ─── Tuning — all physics constants live here ────────────────────────────────
export const FORCE_CONFIG = {
  /** Phone↔phone charge repulsion (px²·px/s²). */
  repulsion: 5200,
  /** Extra repulsion around the core so phones never sit on it. */
  coreRepulsion: 16000,
  /** Spring stiffness toward each phone's rest radius (accel per px stretch /s²). */
  springK: 7.5,
  /** Exponential velocity damping (/s) — settles quickly, no endless float. */
  dampRate: 3.2,
  /** Velocity cap (px/s) for stability when stretched springs release. */
  maxVelocity: 1100,
  /** Collision: minimum center distance between two phones (px). */
  collideRadius: 78,
  /** Collision separation stiffness (0..1 per tick fraction). */
  collideStrength: 0.45,
  /** Breathing amplitude (px/s²) — reads as ~±1.5px drift at rest. */
  breatheAmp: 26,
  /** Below this speed (px/s) a node is considered settled. */
  settleSpeed: 2,
  /** Numeric guard for near-zero distances. */
  minDist: 26,
} as const

export interface SimNode {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  /** Hard anchor (pointer drag or pinned placement). */
  fx: number | null
  fy: number | null
  /** Whether the anchor is a persistent operator pin (vs a live drag). */
  pinned: boolean
  /** Spring rest distance from the core. */
  restLen: number
  /** Unique breathing phase. */
  phase: number
}

function hashPhase(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return (h % 628) / 100
}

const C = FORCE_CONFIG

export class FleetForceSim {
  private nodes = new Map<string, SimNode>()
  core: SimNode

  constructor(corePos: { x: number; y: number }) {
    // The core is anchored from birth — it moves only while dragged.
    this.core = {
      id: 'orchestrator', x: corePos.x, y: corePos.y, vx: 0, vy: 0,
      fx: corePos.x, fy: corePos.y, pinned: true, restLen: 0, phase: 0,
    }
  }

  /** Add new devices at their seed positions, drop removed ones. */
  sync(items: { id: string; x: number; y: number; pinned?: boolean }[]) {
    const seen = new Set<string>()
    for (const it of items) {
      seen.add(it.id)
      if (!this.nodes.has(it.id)) {
        const pinned = Boolean(it.pinned)
        this.nodes.set(it.id, {
          id: it.id, x: it.x, y: it.y, vx: 0, vy: 0,
          fx: pinned ? it.x : null, fy: pinned ? it.y : null, pinned,
          restLen: Math.max(120, Math.hypot(it.x - this.core.x, it.y - this.core.y)),
          phase: hashPhase(it.id),
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

  /** Pointer drag: hard-anchor the node to the pointer each frame. */
  pin(id: string, x: number, y: number) {
    const n = this.get(id)
    if (!n) return
    n.fx = x
    n.fy = y
  }

  /**
   * Pointer release.
   * - Core: stays anchored exactly where dropped (no spring rebound); the
   *   phones are left to settle toward it through their tethers.
   * - Phone: `keepPinned` (manual placement) anchors it at the drop spot;
   *   otherwise it rejoins the field with its spring re-anchored there.
   */
  release(id: string, keepPinned: boolean) {
    const n = this.get(id)
    if (!n) return
    n.vx = 0
    n.vy = 0
    if (n === this.core) {
      n.fx = n.x
      n.fy = n.y
      return
    }
    n.restLen = Math.max(120, Math.hypot(n.x - this.core.x, n.y - this.core.y))
    n.pinned = keepPinned
    if (keepPinned) {
      n.fx = n.x
      n.fy = n.y
    } else {
      n.fx = null
      n.fy = null
    }
  }

  setPinned(id: string, pinned: boolean) {
    const n = this.nodes.get(id)
    if (!n) return
    n.pinned = pinned
    if (pinned) {
      n.fx = n.x
      n.fy = n.y
    } else {
      n.fx = null
      n.fy = null
      n.restLen = Math.max(120, Math.hypot(n.x - this.core.x, n.y - this.core.y))
    }
  }

  unpinAll() {
    for (const n of this.nodes.values()) {
      if (n.pinned) this.setPinned(n.id, false)
    }
  }

  isPinned(id: string): boolean {
    return this.nodes.get(id)?.pinned ?? false
  }

  /** One integration step. Returns the fastest node speed (settle signal). */
  tick(dtRaw: number, t: number, breathe: boolean): number {
    const dt = Math.min(dtRaw, 1 / 30)
    const list = this.all()
    const damp = Math.exp(-C.dampRate * dt)
    let maxSpeed = 0

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
        const dd = Math.max(d, C.minDist)
        const f = C.repulsion / (dd * dd)
        ax += (dx / d) * f
        ay += (dy / d) * f
      }

      // core repulsion + spring tether — this is what tows phones when the
      // core is dragged: stretch grows, pull grows, near phones feel it most.
      {
        let dx = a.x - this.core.x
        let dy = a.y - this.core.y
        let d = Math.hypot(dx, dy)
        if (d < 1) { dx = 1; dy = 0; d = 1 }
        const dd = Math.max(d, C.minDist)
        const rep = C.coreRepulsion / (dd * dd)
        const stretch = d - a.restLen
        const spring = -C.springK * stretch
        ax += (dx / d) * (rep + spring)
        ay += (dy / d) * (rep + spring)
      }

      // breathing — restrained, unique per node
      if (breathe) {
        ax += C.breatheAmp * Math.sin(t * 0.9 + a.phase)
        ay += C.breatheAmp * Math.cos(t * 0.7 + a.phase * 1.31)
      }

      a.vx = (a.vx + ax * dt) * damp
      a.vy = (a.vy + ay * dt) * damp
      const v = Math.hypot(a.vx, a.vy)
      if (v > C.maxVelocity) {
        a.vx = (a.vx / v) * C.maxVelocity
        a.vy = (a.vy / v) * C.maxVelocity
      }
      if (v > maxSpeed) maxSpeed = v
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

    // collision pass — positional separation, prevents overlap without energy
    for (let i = 0; i < list.length; i++) {
      const a = list[i]
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]
        let dx = b.x - a.x
        let dy = b.y - a.y
        let d = Math.hypot(dx, dy)
        if (d >= C.collideRadius) continue
        if (d < 1) { dx = Math.sin(i + j); dy = Math.cos(i - j); d = 1 }
        const overlap = (C.collideRadius - d) * C.collideStrength
        const ux = dx / d
        const uy = dy / d
        const aFree = a.fx === null
        const bFree = b.fx === null
        if (aFree && bFree) {
          a.x -= ux * overlap * 0.5; a.y -= uy * overlap * 0.5
          b.x += ux * overlap * 0.5; b.y += uy * overlap * 0.5
        } else if (aFree) {
          a.x -= ux * overlap; a.y -= uy * overlap
        } else if (bFree) {
          b.x += ux * overlap; b.y += uy * overlap
        }
      }
    }

    return maxSpeed
  }
}

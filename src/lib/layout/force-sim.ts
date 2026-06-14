/**
 * Fleet constellation physics — a continuous, connected elastic system
 * (Obsidian-graph feel). Custom integrator: at fleet scale naive O(n²) is far
 * below frame budget, and owning the solver lets drag / pin / persistence /
 * settling behave exactly as specified.
 *
 * THE MODEL (every visible motion emerges from these forces — never from shared
 * offsets, tweens, or fixed radial coordinates):
 *
 *  • The CORE is a free heavy body (mass ≫ a phone) held loosely in place by a
 *    weak "home" spring. It is NOT anchored — so when a phone is pulled, the
 *    core feels the spring tension and drifts toward it (back-reaction). When
 *    the phones surround it symmetrically the net pull is ~zero and it rests.
 *
 *  • Each phone is tethered to the core by a RADIAL SPRING whose rest length is
 *    that phone's preferred orbit radius. This single spring is both the elastic
 *    link AND the orbit-restoration force: too far → pulled in, too close →
 *    pushed out, near the orbit → almost free. The spring is symmetric (Newton's
 *    third law): the phone pulls the core back, scaled by the core's mass.
 *
 *  • Each phone also has a preferred ANGLE (a stable orbital slot). A tangential
 *    spring nudges it toward that angle so phones distribute around the ring
 *    instead of clumping. Large fleets fan out across concentric rings.
 *
 *  • Phones REPEL each other and resolve COLLISIONS positionally, so they keep
 *    readable spacing and never overlap — and moving one ripples to neighbours.
 *
 *  • DRAG is a temporary pointer anchor, completely separate from PIN. Releasing
 *    a drag returns the phone to the field (it flows back to its orbit through
 *    the forces above). Only an explicit pin freezes a phone.
 *
 *  • Velocity damping + acceleration/velocity clamps keep it stable and make it
 *    SETTLE (and then stop) rather than float forever. No idle "breathing".
 */

// ─── Tuning — every physics constant lives here, nothing scattered ───────────
export interface FleetPhysicsConfig {
  /** Core is this many times heavier than a phone (slower to accelerate). */
  coreMass: number
  phoneMass: number
  /** Radius of the innermost orbit ring (px from core centre). */
  baseRadius: number
  /** Radial gap between concentric rings. */
  ringGap: number
  /** Minimum arc length between phones on a ring → sets ring capacity. */
  minArc: number
  /** Core↔phone spring stiffness (accel per px of stretch, per unit mass).
   *  This is the elastic link and the radial-orbit restoration in one. */
  radialStrength: number
  /** Weak anchor holding the core near its home position (stops cluster drift,
   *  preserves a dragged core's drop spot). Much softer than radialStrength. */
  coreHomeStrength: number
  /** 0..1 scale on the spring tension fed back into the core (back-reaction). */
  coreBackReaction: number
  /** Tangential restoration toward a phone's preferred angle. */
  angularStrength: number
  /** Phone↔phone charge repulsion (px²·accel). */
  repulsion: number
  /** Beyond this centre distance phone↔phone repulsion is ignored (locality). */
  repulsionRange: number
  /** Extra repulsion around the core so phones never sit on it. */
  coreRepulsion: number
  /** Collision: minimum centre distance between two phones (px). */
  collideRadius: number
  /** Collision: minimum centre distance between a phone and the core (px). */
  coreCollideRadius: number
  /** Collision separation stiffness (0..1 per pass). */
  collideStrength: number
  /** Exponential velocity damping (/s) — settles quickly, no endless float. */
  damping: number
  /** Velocity cap (px/s) — keeps released far-drags from overshooting wildly. */
  maxVelocity: number
  /** Acceleration cap (px/s²) — prevents violent jerks on extreme stretches. */
  maxAcceleration: number
  /** Below this speed (px/s) a node counts as still. */
  settleSpeed: number
  /** While the fastest node still exceeds this, the field is treated as "still
   *  organising": alpha is held high (forces stay full) so reorganisation can
   *  finish. Only once motion drops below it does alpha cool to freeze the
   *  residual. This gives full organisation AND a clean final settle. */
  warmSpeed: number
  /** Consecutive still frames (no drag) required before the field is settled. */
  settleFrames: number
  /** Simulation "energy": forces are scaled by alpha, which cools toward 0 each
   *  tick (per `alphaDecay`). Interaction reheats it to 1. This guarantees the
   *  field settles instead of riding a low-amplitude limit cycle forever. */
  alphaDecay: number
  /** Field is settled once alpha drops to/below this (and nothing is dragging). */
  alphaMin: number
  /** Numeric guard for near-zero distances. */
  minDist: number
}

export const FLEET_PHYSICS: FleetPhysicsConfig = {
  coreMass: 6,
  phoneMass: 1,
  baseRadius: 240,
  ringGap: 132,
  minArc: 118,
  radialStrength: 7,
  coreHomeStrength: 3,
  coreBackReaction: 1,
  angularStrength: 3,
  repulsion: 5200,
  repulsionRange: 230,
  coreRepulsion: 16000,
  collideRadius: 78,
  coreCollideRadius: 110,
  collideStrength: 0.5,
  damping: 5,
  maxVelocity: 1200,
  maxAcceleration: 4200,
  settleSpeed: 4,
  warmSpeed: 26,
  settleFrames: 40,
  alphaDecay: 0.05,
  alphaMin: 0.005,
  minDist: 28,
}

export interface SimNode {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  ax: number
  ay: number
  /** Temporary pointer anchor while being dragged (null = not dragging). */
  dragX: number | null
  dragY: number | null
  /** Explicit operator pin (independent of drag and of selection). */
  pinned: boolean
  /** Preferred orbit radius (rest length of the radial spring). */
  targetR: number
  /** Preferred orbital angle (radians). */
  targetA: number
}

const TAU = Math.PI * 2

/** Wrap an angle delta to [-π, π]. */
function wrapAngle(a: number): number {
  let x = a % TAU
  if (x > Math.PI) x -= TAU
  if (x < -Math.PI) x += TAU
  return x
}

export class FleetForceSim {
  private nodes = new Map<string, SimNode>()
  /** Stable insertion order — fixes each phone's orbital identity. */
  private order: string[] = []
  core: SimNode
  private home: { x: number; y: number }
  private cfg: FleetPhysicsConfig
  /** Simulation energy in [0,1]; cools toward 0, reheated to 1 on interaction. */
  private alpha = 1
  /** Last integration's fastest node speed (px/s) — exposed for debug/settle. */
  lastMaxSpeed = 0
  /** Count of invalid (NaN/Infinity) physics values repaired on the last tick —
   *  surfaced to the DEV inspector so a silently-corrupted node is visible. */
  lastRepaired = 0

  constructor(corePos: { x: number; y: number }, cfg: FleetPhysicsConfig = FLEET_PHYSICS) {
    this.cfg = cfg
    this.home = { x: corePos.x, y: corePos.y }
    this.core = {
      id: 'orchestrator', x: corePos.x, y: corePos.y, vx: 0, vy: 0, ax: 0, ay: 0,
      dragX: null, dragY: null, pinned: false, targetR: 0, targetA: 0,
    }
  }

  /** Add new devices at their seed positions, drop removed ones, and recompute
   *  ring/angle slots. Returns true if membership changed (caller may reheat). */
  sync(items: { id: string; x: number; y: number; pinned?: boolean }[]): boolean {
    const seen = new Set<string>()
    let changed = false
    for (const it of items) {
      seen.add(it.id)
      let n = this.nodes.get(it.id)
      if (!n) {
        const pinned = Boolean(it.pinned)
        n = {
          id: it.id, x: it.x, y: it.y, vx: 0, vy: 0, ax: 0, ay: 0,
          dragX: null, dragY: null, pinned,
          targetR: this.cfg.baseRadius, targetA: 0,
        }
        this.nodes.set(it.id, n)
        this.order.push(it.id)
        changed = true
      } else if (it.pinned !== undefined && it.pinned !== n.pinned) {
        n.pinned = it.pinned
      }
    }
    for (const id of [...this.nodes.keys()]) {
      if (!seen.has(id)) {
        this.nodes.delete(id)
        this.order = this.order.filter((x) => x !== id)
        changed = true
      }
    }
    if (changed) this.assignSlots()
    return changed
  }

  /** Distribute phones across concentric rings (stable order) and give each a
   *  preferred radius + evenly-spaced angle. Recomputed only on membership
   *  change, so orbital identity is stable during normal interaction. */
  private assignSlots() {
    const ids = this.order.filter((id) => this.nodes.has(id))
    let i = 0
    let ring = 0
    while (i < ids.length) {
      const radius = this.cfg.baseRadius + ring * this.cfg.ringGap
      const capacity = Math.max(3, Math.floor((TAU * radius) / this.cfg.minArc))
      const slice = ids.slice(i, i + capacity)
      const count = slice.length
      for (let k = 0; k < count; k++) {
        const n = this.nodes.get(slice[k])!
        n.targetR = radius
        // Offset alternate rings so phones nestle between the inner ring's gaps.
        n.targetA = (k / count) * TAU + ring * 0.55
      }
      i += capacity
      ring++
    }
  }

  get(id: string): SimNode | undefined {
    return id === 'orchestrator' ? this.core : this.nodes.get(id)
  }

  all(): SimNode[] {
    return [...this.nodes.values()]
  }

  private anchored(n: SimNode): boolean {
    return n.dragX !== null || n.pinned
  }

  /** Guarantee a node carries only finite physics. A single NaN/Infinity (bad
   *  seed, divide-by-zero, external write) must never silently exclude a phone
   *  from the field, so we repair in place toward a sane fallback rather than
   *  letting the corruption propagate. Returns the number of fields repaired. */
  private sanitize(n: SimNode): number {
    let fixes = 0
    const ok = (v: number) => Number.isFinite(v)
    if (!ok(n.targetR)) { n.targetR = this.cfg.baseRadius; fixes++ }
    if (!ok(n.targetA)) { n.targetA = 0; fixes++ }
    // Position falls back to the preferred orbital slot relative to the core (or
    // the home anchor for the core itself), so a repaired node lands somewhere
    // meaningful instead of (0,0).
    if (!ok(n.x) || !ok(n.y)) {
      if (n === this.core) { n.x = this.home.x; n.y = this.home.y }
      else {
        const bx = ok(this.core.x) ? this.core.x : this.home.x
        const by = ok(this.core.y) ? this.core.y : this.home.y
        n.x = bx + Math.cos(n.targetA) * n.targetR
        n.y = by + Math.sin(n.targetA) * n.targetR
      }
      fixes++
    }
    if (!ok(n.vx)) { n.vx = 0; fixes++ }
    if (!ok(n.vy)) { n.vy = 0; fixes++ }
    if (!ok(n.ax)) { n.ax = 0; fixes++ }
    if (!ok(n.ay)) { n.ay = 0; fixes++ }
    // A non-finite drag anchor would freeze the node at NaN — drop it instead.
    if (n.dragX !== null && !ok(n.dragX)) { n.dragX = null; fixes++ }
    if (n.dragY !== null && !ok(n.dragY)) { n.dragY = null; fixes++ }
    return fixes
  }

  // ── Drag: a TEMPORARY pointer anchor, separate from pinning ────────────────
  beginDrag(id: string, x: number, y: number) {
    const n = this.get(id)
    if (!n) return
    n.dragX = x
    n.dragY = y
    n.vx = 0
    n.vy = 0
    this.reheat()
  }

  drag(id: string, x: number, y: number) {
    const n = this.get(id)
    if (!n) return
    n.dragX = x
    n.dragY = y
    this.reheat()
  }

  /** Release a drag. The node rejoins the field (flows back to its orbit)
   *  UNLESS it is explicitly pinned. A released core records its new home so it
   *  keeps the position the operator dropped it at. */
  endDrag(id: string) {
    const n = this.get(id)
    if (!n) return
    if (n === this.core) {
      this.home = { x: n.x, y: n.y }
      n.dragX = null
      n.dragY = null
    } else if (n.pinned) {
      // Stay where dropped: pin coordinates follow the drop point.
      n.dragX = n.x
      n.dragY = n.y
    } else {
      n.dragX = null
      n.dragY = null
    }
    n.vx = 0
    n.vy = 0
    this.reheat()
  }

  isDragging(): boolean {
    if (this.core.dragX !== null) return true
    for (const n of this.nodes.values()) if (n.dragX !== null) return true
    return false
  }

  // ── Explicit pin (the ONLY thing that freezes a phone) ─────────────────────
  setPinned(id: string, pinned: boolean) {
    const n = this.nodes.get(id)
    if (!n) return
    n.pinned = pinned
    if (pinned) {
      // Freeze at its current spot.
      n.dragX = n.x
      n.dragY = n.y
    } else {
      // Unpinning returns it to the field so it flows back to its orbit.
      n.dragX = null
      n.dragY = null
    }
    n.vx = 0
    n.vy = 0
    this.reheat()
  }

  unpinAll() {
    for (const n of this.nodes.values()) {
      if (n.pinned) {
        n.pinned = false
        n.dragX = null
        n.dragY = null
      }
    }
    this.reheat()
  }

  isPinned(id: string): boolean {
    return this.nodes.get(id)?.pinned ?? false
  }

  pinnedIds(): string[] {
    return [...this.nodes.values()].filter((n) => n.pinned).map((n) => n.id)
  }

  reheat() {
    this.alpha = 1
  }

  /** Current simulation energy (0 = fully cooled / settled). */
  get energy(): number {
    return this.alpha
  }

  isSettled(): boolean {
    // Settled = annealing energy spent AND structural motion (e.g. a far-drag
    // return still in flight) has died down AND nothing is being dragged.
    return this.alpha <= this.cfg.alphaMin && this.lastMaxSpeed < this.cfg.settleSpeed && !this.isDragging()
  }

  /** One integration step (semi-implicit Euler). dtRaw in seconds. */
  tick(dtRaw: number): number {
    const c = this.cfg
    const dt = Math.min(Math.max(dtRaw, 0), 1 / 30)
    if (dt === 0) return this.lastMaxSpeed
    const list = this.all()

    // Repair any invalid physics BEFORE integrating so a single bad value can't
    // poison neighbours (repulsion/collision read every node) or freeze a phone.
    let repaired = this.sanitize(this.core)
    for (const n of list) repaired += this.sanitize(n)
    this.lastRepaired = repaired

    const damp = Math.exp(-c.damping * dt)
    const coreFree = this.core.dragX === null
    const alpha = this.alpha // forces fade with cooling energy → guaranteed settle

    // reset accelerations
    this.core.ax = 0
    this.core.ay = 0
    for (const n of list) { n.ax = 0; n.ay = 0 }

    // weak home spring keeps the (free) core near its anchor — prevents the
    // whole cluster from drifting and preserves a dragged core's drop spot.
    if (coreFree) {
      this.core.ax += -c.coreHomeStrength * (this.core.x - this.home.x)
      this.core.ay += -c.coreHomeStrength * (this.core.y - this.home.y)
    }

    // core↔phone: radial spring (elastic link + orbit) + core repulsion +
    // angular distribution. Spring is symmetric → core gets the back-reaction.
    for (const n of list) {
      let dx = n.x - this.core.x
      let dy = n.y - this.core.y
      let d = Math.hypot(dx, dy)
      if (d < 1e-3) { dx = Math.cos(n.targetA); dy = Math.sin(n.targetA); d = 1 }
      const ux = dx / d
      const uy = dy / d

      const stretch = d - n.targetR
      const springMag = -c.radialStrength * stretch // <0 when stretched → inward
      const dd = Math.max(d, c.minDist)
      const repMag = c.coreRepulsion / (dd * dd) // >0 outward

      // tangential nudge toward the preferred angle (phone only)
      const ang = Math.atan2(dy, dx)
      const aErr = wrapAngle(ang - n.targetA)
      const tangMag = -c.angularStrength * aErr * d
      const tx = -uy
      const ty = ux

      if (!this.anchored(n)) {
        n.ax += (ux * (springMag + repMag) + tx * tangMag) / c.phoneMass
        n.ay += (uy * (springMag + repMag) + ty * tangMag) / c.phoneMass
      }
      // Newton's third law: the spring (not the local repulsion/angular terms)
      // pulls the core back, softened by the core's mass + back-reaction scale.
      if (coreFree) {
        this.core.ax += (-ux * springMag) / c.coreMass * c.coreBackReaction
        this.core.ay += (-uy * springMag) / c.coreMass * c.coreBackReaction
      }
    }

    // phone↔phone repulsion (local) — symmetric ripple between neighbours
    for (let i = 0; i < list.length; i++) {
      const a = list[i]
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]
        let dx = a.x - b.x
        let dy = a.y - b.y
        let d = Math.hypot(dx, dy)
        if (d > c.repulsionRange) continue
        if (d < 1e-3) { dx = Math.cos(i + j); dy = Math.sin(i - j); d = 1 }
        const dd = Math.max(d, c.minDist)
        const f = c.repulsion / (dd * dd)
        const ux = (dx / d) * f
        const uy = (dy / d) * f
        if (!this.anchored(a)) { a.ax += ux / c.phoneMass; a.ay += uy / c.phoneMass }
        if (!this.anchored(b)) { b.ax -= ux / c.phoneMass; b.ay -= uy / c.phoneMass }
      }
    }

    // clamp acceleration (anti-jerk), integrate velocity + position
    let maxSpeed = 0
    const integrate = (n: SimNode, free: boolean) => {
      if (!free) {
        const ax = n.dragX !== null ? n.dragX : n.x
        const ay = n.dragY !== null ? n.dragY : n.y
        n.x = ax
        n.y = ay
        n.vx = 0
        n.vy = 0
        return
      }
      // All forces fade with the cooling energy → the field anneals to a calm
      // formation and then truly stops (no idle drift / limit cycle). A drag
      // reheats alpha to 1, so interaction always feels fully elastic.
      const am = Math.hypot(n.ax, n.ay)
      if (am > c.maxAcceleration) { n.ax = (n.ax / am) * c.maxAcceleration; n.ay = (n.ay / am) * c.maxAcceleration }
      n.vx = (n.vx + n.ax * alpha * dt) * damp
      n.vy = (n.vy + n.ay * alpha * dt) * damp
      const v = Math.hypot(n.vx, n.vy)
      if (v > c.maxVelocity) { n.vx = (n.vx / v) * c.maxVelocity; n.vy = (n.vy / v) * c.maxVelocity }
      n.x += n.vx * dt
      n.y += n.vy * dt
      if (v > maxSpeed) maxSpeed = v
    }

    for (const n of list) integrate(n, !this.anchored(n))
    integrate(this.core, coreFree)

    // positional collision pass — phones never overlap each other or the core
    for (let i = 0; i < list.length; i++) {
      const a = list[i]
      const aFree = !this.anchored(a)
      // phone ↔ core
      {
        let dx = a.x - this.core.x
        let dy = a.y - this.core.y
        let d = Math.hypot(dx, dy)
        if (d < c.coreCollideRadius) {
          if (d < 1e-3) { dx = Math.cos(a.targetA); dy = Math.sin(a.targetA); d = 1 }
          const push = (c.coreCollideRadius - d) * c.collideStrength
          if (aFree) { a.x += (dx / d) * push; a.y += (dy / d) * push }
        }
      }
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]
        let dx = b.x - a.x
        let dy = b.y - a.y
        let d = Math.hypot(dx, dy)
        if (d >= c.collideRadius) continue
        if (d < 1e-3) { dx = Math.cos(i + j); dy = Math.sin(i - j); d = 1 }
        const overlap = (c.collideRadius - d) * c.collideStrength
        const ux = dx / d
        const uy = dy / d
        const bFree = !this.anchored(b)
        if (aFree && bFree) {
          a.x -= ux * overlap * 0.5; a.y -= uy * overlap * 0.5
          b.x += ux * overlap * 0.5; b.y += uy * overlap * 0.5
          // Dissipate the approaching relative velocity so collisions can't
          // pump energy into a perpetual jitter (the layout truly comes to rest).
          const rel = (b.vx - a.vx) * ux + (b.vy - a.vy) * uy
          if (rel < 0) {
            a.vx += ux * rel * 0.5; a.vy += uy * rel * 0.5
            b.vx -= ux * rel * 0.5; b.vy -= uy * rel * 0.5
          }
        } else if (aFree) {
          a.x -= ux * overlap; a.y -= uy * overlap
        } else if (bFree) {
          b.x += ux * overlap; b.y += uy * overlap
        }
      }
    }

    this.lastMaxSpeed = maxSpeed
    if (!this.isDragging()) {
      // Hold full energy while the field is still actively organising; once it
      // calms, cool quickly to freeze the residual (no idle drift / limit cycle).
      if (maxSpeed >= c.warmSpeed) this.alpha = 1
      else this.alpha += (0 - this.alpha) * c.alphaDecay
    }

    return maxSpeed
  }

  /** Number of phones currently in the simulation (excludes the core). Used by
   *  the DEV single-simulation invariant: this must equal the active phone count. */
  count(): number {
    return this.nodes.size
  }

  /** IDs of every phone in the simulation (excludes the core). */
  ids(): string[] {
    return [...this.nodes.keys()]
  }

  /** Dev diagnostics snapshot — never used in production UI. Carries the full
   *  per-phone + core physics state the §16 inspector reports on. */
  debugSnapshot() {
    const c = this.cfg
    return {
      home: { ...this.home },
      core: {
        x: this.core.x, y: this.core.y, vx: this.core.vx, vy: this.core.vy,
        ax: this.core.ax, ay: this.core.ay,
        forceMag: Math.hypot(this.core.ax, this.core.ay) * c.coreMass,
        dragging: this.core.dragX !== null,
        mass: c.coreMass, backReaction: c.coreBackReaction,
      },
      maxSpeed: this.lastMaxSpeed,
      energy: this.alpha,
      settled: this.isSettled(),
      dragging: this.isDragging(),
      repaired: this.lastRepaired,
      nodes: this.all().map((n) => {
        const dx = n.x - this.core.x
        const dy = n.y - this.core.y
        const distCore = Math.hypot(dx, dy)
        return {
          id: n.id, x: n.x, y: n.y, vx: n.vx, vy: n.vy, ax: n.ax, ay: n.ay,
          targetR: n.targetR, targetA: n.targetA,
          pinned: n.pinned, dragging: n.dragX !== null,
          dragX: n.dragX, dragY: n.dragY,
          forceMag: Math.hypot(n.ax, n.ay) * c.phoneMass,
          distCore, radialErr: distCore - n.targetR,
          finite: Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.vx) && Number.isFinite(n.vy),
        }
      }),
    }
  }
}

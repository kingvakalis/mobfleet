import { test, expect } from 'playwright/test'
import { FleetForceSim, FLEET_PHYSICS } from '../src/lib/layout/force-sim'

/**
 * Pure-function tests for the fleet constellation physics. No browser, no
 * server — the solver is deterministic (dt is supplied, no Date/random), so
 * these assertions pin the behaviour the spec requires: selection ≠ pinning,
 * the core receives back-reaction, far drags return to orbit, phones form a
 * circle without collapsing or overlapping, and the field settles.
 */

const DT = 1 / 60

function makeSim(n: number, seed: (i: number) => { x: number; y: number }) {
  const sim = new FleetForceSim({ x: 0, y: 0 })
  sim.sync(Array.from({ length: n }, (_, i) => ({ id: `p${i}`, ...seed(i) })))
  return sim
}

/** Advance the sim by `frames` steps. */
function run(sim: FleetForceSim, frames: number) {
  for (let i = 0; i < frames; i++) sim.tick(DT)
}

/** Tick until settled (no interaction) or the budget runs out. */
function settle(sim: FleetForceSim, max = 2000) {
  for (let i = 0; i < max; i++) {
    sim.tick(DT)
    if (sim.isSettled()) return i
  }
  return max
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

// ─── Selection / drag are NOT pinning ────────────────────────────────────────

test('a freshly synced phone is reactive (not pinned, not anchored)', () => {
  const sim = makeSim(3, (i) => ({ x: 200 + i * 10, y: 0 }))
  for (const n of sim.all()) expect(n.pinned).toBe(false)
})

test('dragging a phone and releasing does NOT pin it', () => {
  const sim = makeSim(6, (i) => ({ x: 240 * Math.cos((i / 6) * 2 * Math.PI), y: 240 * Math.sin((i / 6) * 2 * Math.PI) }))
  sim.beginDrag('p0', 800, 800)
  run(sim, 10)
  sim.endDrag('p0')
  expect(sim.isPinned('p0')).toBe(false)
  // It must rejoin the field — no residual hard anchor.
  const n = sim.get('p0')!
  expect(n.dragX).toBeNull()
  expect(n.dragY).toBeNull()
})

test('a free phone keeps reacting after the core moves (selection never freezes it)', () => {
  const sim = makeSim(6, (i) => ({ x: 240 * Math.cos((i / 6) * 2 * Math.PI), y: 240 * Math.sin((i / 6) * 2 * Math.PI) }))
  settle(sim)
  const before = { ...sim.get('p3')! }
  // Move the core well away and hold it there.
  sim.beginDrag('orchestrator', 400, 0)
  for (let i = 0; i < 120; i++) { sim.drag('orchestrator', 400, 0); sim.tick(DT) }
  const after = sim.get('p3')!
  expect(dist(before, after)).toBeGreaterThan(20) // it moved with the field
})

// ─── Core movement → independent (non-translated) phone response ─────────────

test('dragging the core moves phones by DIFFERENT deltas, never one shared offset', () => {
  const sim = makeSim(8, (i) => ({ x: 240 * Math.cos((i / 8) * 2 * Math.PI), y: 240 * Math.sin((i / 8) * 2 * Math.PI) }))
  settle(sim)
  const start = sim.all().map((n) => ({ id: n.id, x: n.x, y: n.y }))
  const CORE = { x: 350, y: 120 }
  sim.beginDrag('orchestrator', CORE.x, CORE.y)
  for (let i = 0; i < 90; i++) { sim.drag('orchestrator', CORE.x, CORE.y); sim.tick(DT) }
  const deltas = sim.all().map((n, i) => ({ dx: n.x - start[i].x, dy: n.y - start[i].y }))
  // No phone is rigidly translated by the core delta.
  for (const d of deltas) {
    expect(Math.hypot(d.dx - CORE.x, d.dy - CORE.y)).toBeGreaterThan(1)
  }
  // The deltas are not all identical to each other.
  const d0 = deltas[0]
  const someDiffer = deltas.some((d) => Math.hypot(d.dx - d0.dx, d.dy - d0.dy) > 5)
  expect(someDiffer).toBe(true)
})

// ─── Phone drag → back-reaction on the core ──────────────────────────────────

test('holding a phone away pulls the (free, heavy) core toward it, but less far', () => {
  const sim = makeSim(5, (i) => ({ x: 240 * Math.cos((i / 5) * 2 * Math.PI), y: 240 * Math.sin((i / 5) * 2 * Math.PI) }))
  settle(sim)
  const coreStart = { x: sim.core.x, y: sim.core.y }
  // Pull one phone far out along +x and hold it.
  sim.beginDrag('p0', 1000, 0)
  for (let i = 0; i < 240; i++) { sim.drag('p0', 1000, 0); sim.tick(DT) }
  const coreMove = sim.core.x - coreStart.x
  expect(coreMove).toBeGreaterThan(3) // back-reaction exists
  expect(coreMove).toBeLessThan(1000 * 0.6) // but the core is heavy — restrained
})

// ─── Far drag returns to orbit (elastic, not pinned, not scripted) ───────────

test('a phone dragged far away returns toward its orbit after release', () => {
  const sim = makeSim(6, (i) => ({ x: 240 * Math.cos((i / 6) * 2 * Math.PI), y: 240 * Math.sin((i / 6) * 2 * Math.PI) }))
  settle(sim)
  sim.beginDrag('p0', 820, 360) // far out (~900px, ~3.7× orbit), held
  run(sim, 10)
  expect(dist(sim.get('p0')!, sim.core)).toBeGreaterThan(700)
  sim.endDrag('p0') // release reheats the field — it returns at full strength
  settle(sim)
  const target = sim.get('p0')!.targetR
  const settledDist = dist(sim.get('p0')!, sim.core)
  // Pulled back near its orbit (not stuck far away, not collapsed onto core).
  expect(settledDist).toBeLessThan(target * 1.6)
  expect(settledDist).toBeGreaterThan(FLEET_PHYSICS.coreCollideRadius * 0.8)
})

// ─── Circular formation: orbit, no collapse, no overlap, spread ──────────────

test('phones settle into a circular band around the core (no collapse, no overlap)', () => {
  // Phyllotaxis seed — the same spread the production layout starts from.
  const sim = makeSim(8, (i) => {
    const r = 200 + 50 * Math.sqrt(i)
    const a = i * 2.39996 // golden angle
    return { x: r * Math.cos(a), y: r * Math.sin(a) }
  })
  settle(sim)
  const nodes = sim.all()
  for (const n of nodes) {
    const d = dist(n, sim.core)
    expect(d).toBeGreaterThan(FLEET_PHYSICS.coreCollideRadius * 0.8) // not collapsed
    expect(d).toBeLessThan(n.targetR * 2) // not flung away
  }
  // No two phones overlap (within a fraction of the collision radius).
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++)
      expect(dist(nodes[i], nodes[j])).toBeGreaterThan(FLEET_PHYSICS.collideRadius * 0.6)
  // They spread around the core rather than clumping: at least 3 of 4 quadrants.
  const quads = new Set(nodes.map((n) => `${n.x - sim.core.x >= 0 ? 'E' : 'W'}${n.y - sim.core.y >= 0 ? 'S' : 'N'}`))
  expect(quads.size).toBeGreaterThanOrEqual(3)
})

test('phones bunched on one side spread apart (no permanent clumping)', () => {
  // Six phones seeded within a tight ~30° wedge — the angular force must fan
  // them out so they do not collect on one side of the core.
  const sim = makeSim(6, (i) => {
    const a = -0.26 + (i / 5) * 0.52 // ~±15°
    return { x: 220 * Math.cos(a), y: 220 * Math.sin(a) }
  })
  const span = (s: FleetForceSim) => {
    const angs = s.all().map((n) => Math.atan2(n.y - s.core.y, n.x - s.core.x)).sort((a, b) => a - b)
    let max = (angs[0] + 2 * Math.PI) - angs[angs.length - 1] // wrap gap
    for (let i = 1; i < angs.length; i++) max = Math.max(max, angs[i] - angs[i - 1])
    return max // largest empty arc — smaller means more evenly spread
  }
  const before = span(sim)
  settle(sim)
  const after = span(sim)
  console.log(`SPREAD before=${before.toFixed(2)} after=${after.toFixed(2)}`)
  // The biggest empty arc shrinks substantially (they no longer clump in a wedge).
  expect(after).toBeLessThan(before - 1) // radians
})

test('large fleets fan out onto more than one concentric ring', () => {
  const sim = makeSim(40, (i) => ({ x: 200 + (i % 7) * 20, y: (i % 5) * 20 }))
  settle(sim, 3000)
  const radii = new Set(sim.all().map((n) => Math.round(n.targetR)))
  expect(radii.size).toBeGreaterThan(1)
})

// ─── Pinning: the only thing that freezes a phone ────────────────────────────

test('an explicitly pinned phone holds position; unpinning returns it to the field', () => {
  const sim = makeSim(6, (i) => ({ x: 240 * Math.cos((i / 6) * 2 * Math.PI), y: 240 * Math.sin((i / 6) * 2 * Math.PI) }))
  settle(sim)
  // Move a phone somewhere unusual, then pin it there.
  sim.beginDrag('p0', 600, 600)
  run(sim, 20)
  sim.endDrag('p0')
  sim.setPinned('p0', true)
  const pinnedAt = { x: sim.get('p0')!.x, y: sim.get('p0')!.y }
  run(sim, 600)
  expect(dist(sim.get('p0')!, pinnedAt)).toBeLessThan(1) // frozen
  // A pinned phone still tugs the core (spring remains) — sanity: core finite.
  expect(Number.isFinite(sim.core.x)).toBe(true)
  // Unpin → it flows back toward orbit.
  sim.setPinned('p0', false)
  settle(sim)
  expect(dist(sim.get('p0')!, pinnedAt)).toBeGreaterThan(40)
})

// ─── Settling + idle stability ───────────────────────────────────────────────

test('the field settles and then stays still (no idle drift)', () => {
  const sim = makeSim(8, (i) => ({ x: 320 + i * 8, y: -60 + i * 6 }))
  const frames = settle(sim)
  expect(frames).toBeLessThan(2000)
  expect(sim.isSettled()).toBe(true)
  expect(sim.lastMaxSpeed).toBeLessThan(FLEET_PHYSICS.settleSpeed)
  // No drift once settled.
  const snap = sim.all().map((n) => ({ x: n.x, y: n.y }))
  run(sim, 120)
  sim.all().forEach((n, i) => expect(dist(n, snap[i])).toBeLessThan(1))
})

test('isSettled is false while a drag is active', () => {
  const sim = makeSim(4, (i) => ({ x: 240, y: i * 30 }))
  settle(sim)
  sim.beginDrag('p0', 500, 500)
  run(sim, 5)
  expect(sim.isSettled()).toBe(false)
})

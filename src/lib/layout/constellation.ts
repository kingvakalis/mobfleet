/**
 * App-global constellation layout. Positions and warp-state live here (not in
 * component refs) so they survive view-switch remounts: the constellation is a
 * persistent entity, not rebuilt each time you return to the FLEET view.
 */

export type Pos = { x: number; y: number }

// Phyllotaxis spread — even density, organic, deterministic by insertion order.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const BASE_RADIUS = 200
const RING_SPACING = 50

const positions = new Map<string, Pos>()
let count = 0

/** Stable position for a device; new ids take the next open phyllotaxis slot. */
export function positionFor(id: string): Pos {
  let p = positions.get(id)
  if (!p) {
    const i = count++
    const r = BASE_RADIUS + RING_SPACING * Math.sqrt(i)
    const a = i * GOLDEN_ANGLE
    p = { x: Math.cos(a) * r, y: Math.sin(a) * r }
    positions.set(id, p)
  }
  return p
}

// Warp registry — a device warps in exactly once per session.
const warped = new Set<string>()
export const hasWarped = (id: string) => warped.has(id)
export const markWarped = (id: string) => {
  warped.add(id)
}

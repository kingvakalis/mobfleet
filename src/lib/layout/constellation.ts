/**
 * App-global constellation layout. Positions and warp-state live here (not in
 * component refs) so they survive view-switch remounts: the constellation is a
 * persistent entity, not rebuilt each time you return to the FLEET view.
 *
 * Operator-customized positions (drag) persist locally.
 * BACKEND INTEGRATION POINT: when the server grows a layout resource, swap
 * `loadSaved`/`persist` for client calls — the rest of this module is unchanged.
 */

export type Pos = { x: number; y: number }

const STORAGE_KEY = 'mobfleet-fleet-layout-v1'

// Phyllotaxis spread — even density, organic, deterministic by insertion order.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const BASE_RADIUS = 200
const RING_SPACING = 50

const positions = new Map<string, Pos>()
let count = 0

function loadSaved(): Record<string, Pos> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, Pos>
  } catch {
    return {}
  }
}

let saved: Record<string, Pos> = loadSaved()

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
  } catch {
    /* storage unavailable — layout stays session-only */
  }
}

/** Stable position for a device; operator-saved spots win, new ids take the
 *  next open phyllotaxis slot. */
export function positionFor(id: string): Pos {
  const custom = saved[id]
  if (custom) return custom
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

/** Persist an operator-dragged position (node center coordinates). */
export function savePosition(id: string, pos: Pos) {
  saved[id] = pos
  persist()
}

/** Drop all custom positions — layout returns to auto-arrange. */
export function resetLayout() {
  saved = {}
  positions.clear()
  count = 0
  persist()
}

export function hasCustomLayout(): boolean {
  return Object.keys(saved).length > 0
}

// Warp registry — a device warps in exactly once per session.
const warped = new Set<string>()
export const hasWarped = (id: string) => warped.has(id)
export const markWarped = (id: string) => {
  warped.add(id)
}

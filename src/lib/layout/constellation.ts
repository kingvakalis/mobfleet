/**
 * App-global constellation layout. Positions and warp-state live here (not in
 * component refs) so they survive view-switch remounts: the constellation is a
 * persistent entity, not rebuilt each time you return to the FLEET view.
 *
 * Versioned, operator-customized layout (node drags, orchestrator position,
 * viewport, lock state) persists locally.
 * BACKEND INTEGRATION POINT: when the server grows a layout resource, swap
 * `load`/`persist` for client calls — `FleetLayout` is the typed contract.
 */

import { useToastStore } from '@/state/toast-store'

export type Pos = { x: number; y: number }
export type Viewport = { x: number; y: number; zoom: number }

export interface FleetLayout {
  version: number
  viewport: Viewport | null
  orchestrator: Pos | null
  devices: Record<string, Pos>
  /** Operator-pinned phones — anchored, immune to the force simulation. */
  pinned: string[]
  locked: boolean
  updatedAt: string
}

const STORAGE_KEY = 'mobfleet-fleet-layout-v2'
const LEGACY_KEY = 'mobfleet-fleet-layout-v1'
const VERSION = 2

// Phyllotaxis spread — even density, organic, deterministic by insertion order.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const BASE_RADIUS = 200
const RING_SPACING = 50

const positions = new Map<string, Pos>()
let count = 0

function emptyLayout(): FleetLayout {
  return { version: VERSION, viewport: null, orchestrator: null, devices: {}, pinned: [], locked: false, updatedAt: '' }
}

function load(): FleetLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as FleetLayout
      if (parsed.version === VERSION && parsed.devices) {
        return { ...parsed, pinned: parsed.pinned ?? [] }
      }
    }
    // Migrate v1 (plain id→pos map) once.
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      const devices = JSON.parse(legacy) as Record<string, Pos>
      const migrated = { ...emptyLayout(), devices }
      localStorage.removeItem(LEGACY_KEY)
      return migrated
    }
  } catch {
    /* corrupted layout — start fresh */
  }
  return emptyLayout()
}

let layout: FleetLayout = load()

let persistTimer: ReturnType<typeof setTimeout> | null = null
/** Debounced write — callers may save on every viewport tick safely. */
function persist() {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    try {
      layout.updatedAt = new Date().toISOString()
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
    } catch {
      // Storage unavailable — keep the UI stable, surface it, allow retry on
      // the next movement instead of silently reverting the graph.
      useToastStore.getState().addToast('Could not save fleet layout — storage unavailable', 'error')
    }
  }, 250)
}

/** Stable position for a device; operator-saved spots win, new ids take the
 *  next open phyllotaxis slot (existing phones are never moved). */
export function positionFor(id: string): Pos {
  const custom = layout.devices[id]
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

/** Persist an operator-dragged device position (node center coordinates). */
export function savePosition(id: string, pos: Pos) {
  layout.devices[id] = pos
  persist()
}

export function orchestratorPos(): Pos {
  return layout.orchestrator ?? { x: 0, y: 0 }
}

export function saveOrchestratorPos(pos: Pos) {
  layout.orchestrator = pos
  persist()
}

export function savedViewport(): Viewport | null {
  return layout.viewport
}

export function saveViewport(vp: Viewport) {
  layout.viewport = vp
  persist()
}

export function pinnedIds(): string[] {
  return layout.pinned
}

export function setPinnedId(id: string, pinned: boolean) {
  const has = layout.pinned.includes(id)
  if (pinned && !has) layout.pinned = [...layout.pinned, id]
  if (!pinned && has) layout.pinned = layout.pinned.filter((x) => x !== id)
  persist()
}

export function clearPinned() {
  layout.pinned = []
  persist()
}

export function isLayoutLocked(): boolean {
  return layout.locked
}

export function setLayoutLocked(locked: boolean) {
  layout.locked = locked
  persist()
}

/** Drop all custom positions — layout returns to auto-arrange. Destructive;
 *  callers must confirm with the operator first. */
export function resetLayout() {
  layout = { ...emptyLayout(), locked: layout.locked }
  positions.clear()
  count = 0
  persist()
}

export function hasCustomLayout(): boolean {
  return Object.keys(layout.devices).length > 0 || layout.orchestrator !== null
}

// Warp registry — a device warps in exactly once per session.
const warped = new Set<string>()
export const hasWarped = (id: string) => warped.has(id)
export const markWarped = (id: string) => {
  warped.add(id)
}

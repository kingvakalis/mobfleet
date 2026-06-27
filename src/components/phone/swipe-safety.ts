/**
 * Safe-edge clamping for on-screen SWIPE / DRAG coordinates (device LOGICAL points).
 *
 * iOS reserves screen-edge zones for SYSTEM gestures: the top status bar / Dynamic Island +
 * Control/Notification-Center pull-down, the BOTTOM home-indicator / app-switcher swipe, and the
 * left/right back-swipe edges. A finger drag that STARTS (or ends) inside one of these zones is
 * hijacked by iOS instead of scrolling the app — e.g. an up-swipe beginning at y≈824 on an 844pt
 * screen lands in the bottom home-indicator zone and never scrolls.
 *
 * We clamp ONLY swipe/drag start+end into the usable area; TAPS are never clamped (so bottom dock /
 * app icons stay tappable). A point already inside the usable area keeps its EXACT coordinates, so
 * normal mid-screen gestures map exactly as before — only unsafe edge starts/ends are pulled in.
 *
 * Pure + dependency-free → unit-testable in plain Node (no DOM, no React).
 */
export type SwipeDir = 'up' | 'down' | 'left' | 'right'

/** Margins kept clear of the iOS system-gesture zones, in device LOGICAL points (pt). */
export const SWIPE_SAFE_MARGIN = { top: 60, bottom: 80, left: 16, right: 16 } as const

/** Clamp v into [lo,hi]; if the safe band collapses (tiny screen) fall back to its midpoint. */
const clamp1 = (v: number, lo: number, hi: number): number =>
  lo >= hi ? Math.round((lo + hi) / 2) : Math.max(lo, Math.min(hi, v))

/** Clamp a single point into the usable area (away from the unsafe edges). Rounded LOGICAL points. */
export function clampSwipePoint(x: number, y: number, devW: number, devH: number): { x: number; y: number } {
  return {
    x: Math.round(clamp1(x, SWIPE_SAFE_MARGIN.left, devW - SWIPE_SAFE_MARGIN.right)),
    y: Math.round(clamp1(y, SWIPE_SAFE_MARGIN.top, devH - SWIPE_SAFE_MARGIN.bottom)),
  }
}

export interface SwipeSeg { x1: number; y1: number; x2: number; y2: number }

/**
 * Clamp a swipe's start + end into the usable area. ONLY swipe/drag gestures use this — taps keep
 * exact coords. Each endpoint is clamped independently, so a real swipe (start in the bottom zone,
 * end higher up) keeps its travel + direction; only the unsafe endpoint is pulled in.
 */
export function clampSwipeSeg(seg: SwipeSeg, devW: number, devH: number): SwipeSeg {
  const a = clampSwipePoint(seg.x1, seg.y1, devW, devH)
  const b = clampSwipePoint(seg.x2, seg.y2, devW, devH)
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y }
}

/**
 * Generate a safe, centre-anchored directional swipe segment for the D-pad arrows (no pointer drag
 * available). Travels ~40% of the screen through the centre and is clamped into the safe area, so it
 * never starts/ends on an edge — `up` moves the finger upward (y2 < y1) to scroll content up, etc.
 */
export function dpadSwipeSeg(dir: SwipeDir, devW: number, devH: number): SwipeSeg {
  const cx = Math.round(devW / 2), cy = Math.round(devH / 2)
  const ax = Math.round(devW * 0.2), ay = Math.round(devH * 0.2) // ~40% span across the centre
  const raw: SwipeSeg = {
    up:    { x1: cx, y1: cy + ay, x2: cx, y2: cy - ay },
    down:  { x1: cx, y1: cy - ay, x2: cx, y2: cy + ay },
    left:  { x1: cx + ax, y1: cy, x2: cx - ax, y2: cy },
    right: { x1: cx - ax, y1: cy, x2: cx + ax, y2: cy },
  }[dir]
  return clampSwipeSeg(raw, devW, devH)
}

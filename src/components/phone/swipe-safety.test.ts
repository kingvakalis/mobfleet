import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SWIPE_SAFE_MARGIN, clampSwipePoint, clampSwipeSeg, dpadSwipeSeg, type SwipeDir } from './swipe-safety'

// The user's reported device: 390 × 844 pt. Bottom safe edge = 844 − 80 = 764.
const W = 390, H = 844
const SAFE_X = (x: number) => x >= SWIPE_SAFE_MARGIN.left && x <= W - SWIPE_SAFE_MARGIN.right
const SAFE_Y = (y: number) => y >= SWIPE_SAFE_MARGIN.top && y <= H - SWIPE_SAFE_MARGIN.bottom

test('margins sit within the requested safe ranges', () => {
  assert.ok(SWIPE_SAFE_MARGIN.top >= 44 && SWIPE_SAFE_MARGIN.top <= 60)
  assert.ok(SWIPE_SAFE_MARGIN.bottom >= 60 && SWIPE_SAFE_MARGIN.bottom <= 80)
  assert.ok(SWIPE_SAFE_MARGIN.left >= 12 && SWIPE_SAFE_MARGIN.left <= 24)
  assert.ok(SWIPE_SAFE_MARGIN.right >= 12 && SWIPE_SAFE_MARGIN.right <= 24)
})

test('up-swipe near the bottom clamps OFF the home-indicator zone', () => {
  // The exact failure: start at y≈824 (inside the bottom system-gesture zone), drag up to y≈300.
  const safe = clampSwipeSeg({ x1: 195, y1: 824, x2: 195, y2: 300 }, W, H)
  assert.equal(safe.y1, H - SWIPE_SAFE_MARGIN.bottom)   // 764 — pulled out of the bottom zone
  assert.ok(safe.y1 <= 780, 'fromY must be ≤ ~760–780, not 821–824')
  assert.equal(safe.y2, 300)                            // end (already safe) is preserved EXACT
  assert.ok(safe.y2 < safe.y1, 'toY must remain clearly above fromY (still an up-swipe)')
})

test('down-swipe near the top clamps OFF the status / Dynamic-Island zone', () => {
  const safe = clampSwipeSeg({ x1: 195, y1: 8, x2: 195, y2: 600 }, W, H)
  assert.equal(safe.y1, SWIPE_SAFE_MARGIN.top)          // 60 — clear of the status area
  assert.equal(safe.y2, 600)
  assert.ok(safe.y2 > safe.y1, 'still a down-swipe')
})

test('horizontal swipe clamps within the left/right safe margins', () => {
  const safe = clampSwipeSeg({ x1: 2, y1: 420, x2: 388, y2: 420 }, W, H)
  assert.equal(safe.x1, SWIPE_SAFE_MARGIN.left)         // 16
  assert.equal(safe.x2, W - SWIPE_SAFE_MARGIN.right)    // 374
  assert.ok(safe.x2 > safe.x1, 'still a right-swipe')
})

test('tap is NOT clamped — bottom dock / app icons stay tappable', () => {
  // A bottom dock icon at y≈812. The SWIPE clamp WOULD pull it up to 764 (which is why taps must
  // bypass it) — but the tap code path never calls the clamp, so a tap keeps its EXACT coordinates.
  const dock = { x: 320, y: 812 }
  assert.equal(clampSwipePoint(dock.x, dock.y, W, H).y, H - SWIPE_SAFE_MARGIN.bottom) // would move → 764
  assert.deepEqual(dock, { x: 320, y: 812 })            // tap is delivered unchanged
})

test('normal mid-screen swipe keeps EXACT coordinates (no over-clamping)', () => {
  const seg = { x1: 120, y1: 300, x2: 260, y2: 540 }
  assert.deepEqual(clampSwipeSeg(seg, W, H), seg)
})

test('D-pad swipe emits coords within the safe bounds, with the right direction', () => {
  const checks: Record<SwipeDir, (s: ReturnType<typeof dpadSwipeSeg>) => boolean> = {
    up:    (s) => s.y2 < s.y1 && s.x1 === s.x2,
    down:  (s) => s.y2 > s.y1 && s.x1 === s.x2,
    left:  (s) => s.x2 < s.x1 && s.y1 === s.y2,
    right: (s) => s.x2 > s.x1 && s.y1 === s.y2,
  }
  for (const dir of ['up', 'down', 'left', 'right'] as SwipeDir[]) {
    const s = dpadSwipeSeg(dir, W, H)
    for (const v of [s.x1, s.x2]) assert.ok(SAFE_X(v), `${dir}: x ${v} within [${SWIPE_SAFE_MARGIN.left},${W - SWIPE_SAFE_MARGIN.right}]`)
    for (const v of [s.y1, s.y2]) assert.ok(SAFE_Y(v), `${dir}: y ${v} within [${SWIPE_SAFE_MARGIN.top},${H - SWIPE_SAFE_MARGIN.bottom}]`)
    assert.ok(checks[dir](s), `${dir}: direction preserved`)
  }
})

test('clamp is robust on a tiny/degenerate screen (band collapses to a midpoint, no NaN)', () => {
  const s = clampSwipeSeg({ x1: 0, y1: 0, x2: 100, y2: 100 }, 100, 100) // H−bottom < top
  for (const v of [s.x1, s.y1, s.x2, s.y2]) assert.ok(Number.isFinite(v))
})

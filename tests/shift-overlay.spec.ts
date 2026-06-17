import { test, expect } from 'playwright/test'
import { useShiftOverlay } from '../src/state/shift-overlay'

/**
 * Pure state-machine tests for the in-session shift overlay (release validation,
 * Subagent 5). The Start/Break/End shift buttons drive this ephemeral, non-persistent
 * zustand store (src/state/shift-overlay.ts) — there is no shift backend yet. These
 * assertions lock the transition contract: start → on-shift; toggleBreak flips
 * on-shift↔on-break and accrues break minutes; end clears the entry.
 *
 * Runs in the `engine` project (Node, no browser/server). zustand's vanilla store
 * works outside React. The store's only `@/` import is type-only (erased at build).
 */

function reset() {
  // Clear all overlay entries between tests.
  useShiftOverlay.setState({ overlay: {} })
}

test.beforeEach(reset)

test('startShift puts a member on-shift with a start time and zeroed break', () => {
  useShiftOverlay.getState().startShift('emp-1')
  const o = useShiftOverlay.getState().overlay['emp-1']
  expect(o.shiftStatus).toBe('on-shift')
  expect(typeof o.shiftStart).toBe('number')
  expect(o.breakStart).toBeNull()
  expect(o.breakMinutesToday).toBe(0)
})

test('toggleBreak from on-shift → on-break and records a break start', () => {
  useShiftOverlay.getState().startShift('emp-1')
  useShiftOverlay.getState().toggleBreak('emp-1')
  const o = useShiftOverlay.getState().overlay['emp-1']
  expect(o.shiftStatus).toBe('on-break')
  expect(typeof o.breakStart).toBe('number')
})

test('toggleBreak from on-break → on-shift and accrues elapsed break minutes', () => {
  useShiftOverlay.getState().startShift('emp-1')
  // Force an on-break state whose breakStart is 6 minutes ago.
  useShiftOverlay.setState((s) => ({
    overlay: { ...s.overlay, ['emp-1']: { ...s.overlay['emp-1'], shiftStatus: 'on-break', breakStart: Date.now() - 6 * 60_000 } },
  }))
  useShiftOverlay.getState().toggleBreak('emp-1')
  const o = useShiftOverlay.getState().overlay['emp-1']
  expect(o.shiftStatus).toBe('on-shift')
  expect(o.breakStart).toBeNull()
  expect(o.breakMinutesToday).toBeGreaterThanOrEqual(5)
})

test('toggleBreak on an unknown member is a no-op (no entry created)', () => {
  useShiftOverlay.getState().toggleBreak('ghost')
  expect(useShiftOverlay.getState().overlay['ghost']).toBeUndefined()
})

test('endShift removes the overlay entry entirely', () => {
  useShiftOverlay.getState().startShift('emp-1')
  useShiftOverlay.getState().endShift('emp-1')
  expect(useShiftOverlay.getState().overlay['emp-1']).toBeUndefined()
})

test('overlays for different members are independent', () => {
  useShiftOverlay.getState().startShift('a')
  useShiftOverlay.getState().startShift('b')
  useShiftOverlay.getState().endShift('a')
  expect(useShiftOverlay.getState().overlay['a']).toBeUndefined()
  expect(useShiftOverlay.getState().overlay['b'].shiftStatus).toBe('on-shift')
})

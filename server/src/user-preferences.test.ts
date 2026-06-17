import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  preferencesPatch,
  byteLength,
  normalizePreferences,
  applyPreferencesPatch,
} from './user-preferences'

// ── normalizePreferences ─────────────────────────────────────────────────────
test('normalizePreferences coerces non-objects to {}', () => {
  assert.deepEqual(normalizePreferences(null), {})
  assert.deepEqual(normalizePreferences('x'), {})
  assert.deepEqual(normalizePreferences([1, 2]), {})
  assert.deepEqual(normalizePreferences({ a: 1 }), { a: 1 })
})

// ── applyPreferencesPatch (shallow merge, patch wins) ────────────────────────
test('applyPreferencesPatch shallow-merges with patch winning', () => {
  assert.deepEqual(applyPreferencesPatch({ a: 1, b: 2 }, { b: 9, c: 3 }), { a: 1, b: 9, c: 3 })
  assert.deepEqual(applyPreferencesPatch(null, { a: 1 }), { a: 1 })
})

// ── byteLength ───────────────────────────────────────────────────────────────
test('byteLength measures the serialized size', () => {
  assert.equal(byteLength({}), 2) // "{}"
  assert.ok(byteLength({ key: 'value' }) > 2)
})

// ── Zod patch ─────────────────────────────────────────────────────────────────
test('preferencesPatch accepts an object and rejects array/scalar', () => {
  assert.equal(preferencesPatch.safeParse({ theme: 'dark' }).success, true)
  assert.equal(preferencesPatch.safeParse({}).success, true)
  assert.equal(preferencesPatch.safeParse([1, 2]).success, false)
  assert.equal(preferencesPatch.safeParse('x').success, false)
})

test('preferencesPatch rejects an over-sized blob', () => {
  const big = { blob: 'x'.repeat(40_000) }
  assert.equal(preferencesPatch.safeParse(big).success, false)
})

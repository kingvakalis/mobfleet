import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rateLimit, _resetRateLimits } from './rate-limit'

test('rateLimit allows up to max within the window, then blocks', () => {
  _resetRateLimits()
  const now = 1_000_000
  for (let i = 0; i < 3; i++) {
    assert.equal(rateLimit('k', 3, 1000, now), true, `call ${i + 1} should pass`)
  }
  assert.equal(rateLimit('k', 3, 1000, now), false, '4th call is blocked')
})

test('rateLimit resets after the window elapses', () => {
  _resetRateLimits()
  assert.equal(rateLimit('k', 1, 1000, 0), true)
  assert.equal(rateLimit('k', 1, 1000, 500), false) // same window
  assert.equal(rateLimit('k', 1, 1000, 1000), true) // window rolled over
})

test('rateLimit buckets are independent per key', () => {
  _resetRateLimits()
  assert.equal(rateLimit('a', 1, 1000, 0), true)
  assert.equal(rateLimit('a', 1, 1000, 0), false)
  assert.equal(rateLimit('b', 1, 1000, 0), true) // different key, own bucket
})

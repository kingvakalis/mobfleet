import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  qualityLevelToEncoder, clampQualityLevel, clampFps, fpsToIntervalMs,
  QUALITY_MIN, QUALITY_MAX, FPS_MIN, FPS_MAX, SCREENSHOT_DOWNLOAD_QUALITY,
} from '../../src/shared/stream-quality'

test('clampQualityLevel clamps to 0–30 and rounds', () => {
  assert.equal(clampQualityLevel(-5), 0)
  assert.equal(clampQualityLevel(0), 0)
  assert.equal(clampQualityLevel(15), 15)
  assert.equal(clampQualityLevel(30), 30)
  assert.equal(clampQualityLevel(99), 30)
  assert.equal(clampQualityLevel(14.6), 15)
  assert.equal(clampQualityLevel(Number.NaN), QUALITY_MIN)
})

test('clampFps clamps to 5–30 (real range) and rounds', () => {
  assert.equal(clampFps(0), 5)
  assert.equal(clampFps(4), 5)
  assert.equal(clampFps(5), 5)
  assert.equal(clampFps(18), 18)
  assert.equal(clampFps(30), 30)
  assert.equal(clampFps(60), 30)
  assert.equal(clampFps(Number.NaN), FPS_MIN)
})

test('qualityLevelToEncoder maps 0–30 onto sharp-safe width + quality, monotonic', () => {
  const lo = qualityLevelToEncoder(5)
  const mid = qualityLevelToEncoder(15)
  const hi = qualityLevelToEncoder(30)
  // exact anchors of the linear map (width 360→720, quality 30→88)
  assert.deepEqual(qualityLevelToEncoder(0), { width: 360, quality: 30 })
  assert.deepEqual(mid, { width: 540, quality: 59 })
  assert.deepEqual(hi, { width: 720, quality: 88 })
  // higher level ⇒ larger width AND higher quality (visibly better + bigger upload)
  assert.ok(lo.width < mid.width && mid.width < hi.width)
  assert.ok(lo.quality < mid.quality && mid.quality < hi.quality)
})

test('qualityLevelToEncoder stays within sharp bounds for out-of-range input', () => {
  const below = qualityLevelToEncoder(-100)
  const above = qualityLevelToEncoder(9999)
  assert.deepEqual(below, { width: 360, quality: 30 })   // clamped to level 0
  assert.deepEqual(above, { width: 720, quality: 88 })   // clamped to level 30
  for (const e of [below, above]) {
    assert.ok(e.width >= 120 && e.width <= 2000)
    assert.ok(e.quality >= 10 && e.quality <= 95)
  }
})

test('fpsToIntervalMs: requested fps → interval, clamped to 5–30', () => {
  assert.equal(fpsToIntervalMs(5), 200)
  assert.equal(fpsToIntervalMs(15), 67)
  assert.equal(fpsToIntervalMs(30), 33)
  assert.equal(fpsToIntervalMs(1000), 33)  // clamped to 30
  assert.equal(fpsToIntervalMs(1), 200)    // clamped to 5
})

test('constants reflect the agreed ranges', () => {
  assert.equal(QUALITY_MIN, 0)
  assert.equal(QUALITY_MAX, 30)
  assert.equal(FPS_MIN, 5)
  assert.equal(FPS_MAX, 30)
  assert.equal(SCREENSHOT_DOWNLOAD_QUALITY, 30)
})

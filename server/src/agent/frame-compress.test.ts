import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compressionConfigFromEnv, compressFrame, compressionForQualityLevel } from './frame-compress'
import type { ScreenshotFrame } from './agent-runtime'

test('compressionConfigFromEnv: sane defaults when unset', () => {
  assert.deepEqual(compressionConfigFromEnv({}), { width: 540, quality: 55, format: 'jpeg' })
})

test('compressionConfigFromEnv: reads + clamps width/quality and selects webp', () => {
  assert.deepEqual(
    compressionConfigFromEnv({ FRAME_WIDTH: '720', FRAME_QUALITY: '60', FRAME_FORMAT: 'webp' }),
    { width: 720, quality: 60, format: 'webp' },
  )
  // out-of-range clamps to [120,2000] width and [10,95] quality; unknown format → jpeg
  assert.deepEqual(
    compressionConfigFromEnv({ FRAME_WIDTH: '99999', FRAME_QUALITY: '500', FRAME_FORMAT: 'gif' }),
    { width: 2000, quality: 95, format: 'jpeg' },
  )
  assert.deepEqual(
    compressionConfigFromEnv({ FRAME_WIDTH: '10', FRAME_QUALITY: '1', FRAME_FORMAT: '' }),
    { width: 120, quality: 10, format: 'jpeg' },
  )
})

test('compressionConfigFromEnv: non-numeric values fall back to defaults', () => {
  assert.deepEqual(
    compressionConfigFromEnv({ FRAME_WIDTH: 'abc', FRAME_QUALITY: '' }),
    { width: 540, quality: 55, format: 'jpeg' },
  )
})

test('compressFrame: returns the input frame unchanged when it cannot encode (no sharp / bad bytes)', async () => {
  // 'AAAA' decodes to 3 bytes — not a valid image. Whether sharp is absent (fallback) or present
  // (throws on a bad buffer → caught), compressFrame must return the ORIGINAL frame, never drop it.
  const frame: ScreenshotFrame = { base64: 'AAAA', format: 'png', width: 390, height: 844 }
  const out = await compressFrame(frame, { width: 540, quality: 55, format: 'jpeg' })
  assert.equal(out.base64, 'AAAA')
  assert.equal(out.format, 'png')
  assert.equal(out.width, 390)
  assert.equal(out.height, 844)
})

test('compressFrame: empty bytes are passed through untouched', async () => {
  const frame: ScreenshotFrame = { base64: '', format: 'png', width: null, height: null }
  const out = await compressFrame(frame, { width: 540, quality: 55, format: 'jpeg' })
  assert.equal(out.base64, '')
})

test('compressionForQualityLevel: a 0–30 command level overrides width+quality, keeps format', () => {
  const base = { width: 540, quality: 55, format: 'webp' as const }
  // mapped from the shared level→encoder table; format inherited from the agent's startup config
  assert.deepEqual(compressionForQualityLevel(5, base), { width: 420, quality: 40, format: 'webp' })
  assert.deepEqual(compressionForQualityLevel(15, base), { width: 540, quality: 59, format: 'webp' })
  assert.deepEqual(compressionForQualityLevel(30, base), { width: 720, quality: 88, format: 'webp' })
  // out-of-range level is clamped (defense in depth against a malformed payload)
  assert.deepEqual(compressionForQualityLevel(999, base), { width: 720, quality: 88, format: 'webp' })
})

test('compressionForQualityLevel: no/NaN level keeps the startup config unchanged', () => {
  const base = { width: 540, quality: 55, format: 'jpeg' as const }
  assert.equal(compressionForQualityLevel(undefined, base), base)
  assert.equal(compressionForQualityLevel(Number.NaN, base), base)
})

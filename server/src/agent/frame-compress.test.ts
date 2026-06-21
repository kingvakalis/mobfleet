import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compressionConfigFromEnv, compressFrame } from './frame-compress'
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

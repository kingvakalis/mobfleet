import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildFfmpegArgs } from './ffmpeg'

test('buildFfmpegArgs wires the MJPEG input → H.264 RTP output', () => {
  const a = buildFfmpegArgs({ mjpegPort: 9100, rtpPort: 5004, fps: 15 })
  assert.ok(a.includes('http://127.0.0.1:9100'), 'reads the WDA MJPEG')
  assert.ok(a.includes('libx264') && a.includes('zerolatency'), 'low-latency H.264')
  assert.ok(a.includes('rtp://127.0.0.1:5004?pkt_size=1200'), 'RTP to the werift port, MTU-safe')
  assert.deepEqual(a.slice(a.indexOf('-payload_type'), a.indexOf('-payload_type') + 2), ['-payload_type', '96'])
})

test('gop defaults to fps; scale is optional', () => {
  const a = buildFfmpegArgs({ mjpegPort: 9100, rtpPort: 5004, fps: 12 })
  assert.ok(a.some((x) => x.includes('keyint=12')), 'gop = fps by default')
  assert.ok(!a.includes('-vf'), 'no scale filter unless requested')
  const b = buildFfmpegArgs({ mjpegPort: 9100, rtpPort: 5004, fps: 12, scale: 540 })
  assert.ok(b.includes('-vf') && b.some((x) => x === 'scale=540:-2'))
})

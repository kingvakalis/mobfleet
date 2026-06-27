import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MjpegDemux } from './mjpeg-demux'

const frame = (payload: string) => Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from(payload), Buffer.from([0xff, 0xd9])])

test('extracts a single complete JPEG', () => {
  const out: Buffer[] = []
  const d = new MjpegDemux((f) => out.push(f))
  d.push(frame('hello'))
  assert.equal(out.length, 1)
  assert.deepEqual(out[0], frame('hello'))
  assert.equal(d.pending, 0)
})

test('extracts multiple frames from one chunk', () => {
  const out: Buffer[] = []
  const d = new MjpegDemux((f) => out.push(f))
  d.push(Buffer.concat([frame('a'), frame('bb'), frame('ccc')]))
  assert.deepEqual(out.map((f) => f.subarray(2, f.length - 2).toString()), ['a', 'bb', 'ccc'])
})

test('reassembles a frame split across chunks', () => {
  const out: Buffer[] = []
  const d = new MjpegDemux((f) => out.push(f))
  const f = frame('split-me')
  d.push(f.subarray(0, 4))
  assert.equal(out.length, 0, 'incomplete frame not emitted yet')
  d.push(f.subarray(4))
  assert.equal(out.length, 1)
  assert.deepEqual(out[0], f)
})

test('handles boundary/preamble bytes between frames (multipart noise)', () => {
  const out: Buffer[] = []
  const d = new MjpegDemux((f) => out.push(f))
  const noise = Buffer.from('--mobboundary\r\nContent-Type: image/jpeg\r\n\r\n')
  d.push(Buffer.concat([noise, frame('one'), Buffer.from('\r\n'), noise, frame('two'), Buffer.from('\r\n')]))
  assert.deepEqual(out.map((f) => f.subarray(2, f.length - 2).toString()), ['one', 'two'])
})

test('an EOI split exactly between chunks still resolves', () => {
  const out: Buffer[] = []
  const d = new MjpegDemux((f) => out.push(f))
  const f = frame('edge')
  d.push(f.subarray(0, f.length - 1)) // everything but the final 0xD9
  assert.equal(out.length, 0)
  d.push(f.subarray(f.length - 1)) // the 0xD9
  assert.equal(out.length, 1)
  assert.deepEqual(out[0], f)
})

test('does not grow unbounded when there is no frame start', () => {
  const d = new MjpegDemux(() => {})
  d.push(Buffer.from('garbage with no jpeg start at all'))
  assert.ok(d.pending <= 1)
})

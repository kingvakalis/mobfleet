import { test } from 'node:test'
import assert from 'node:assert/strict'
import { StreamHub, type Sink } from './hub'
import { frameChunk } from './multipart'

const sink = () => {
  const writes: Buffer[] = []
  return { write: (c: Buffer) => { writes.push(c); return true }, writes } as Sink & { writes: Buffer[] }
}
const jpeg = (s: string) => Buffer.from(s)

test('publish fans a NEW frame to all viewers and returns true', () => {
  const hub = new StreamHub()
  const a = sink(), b = sink()
  hub.addViewer('dev', a, frameChunk)
  hub.addViewer('dev', b, frameChunk)
  const forwarded = hub.publish('dev', jpeg('frame-1'), frameChunk)
  assert.equal(forwarded, true)
  assert.equal(a.writes.length, 1)
  assert.equal(b.writes.length, 1)
  assert.ok(a.writes[0].includes('image/jpeg'))
  assert.ok(a.writes[0].includes('frame-1'))
})

test('a DUPLICATE frame is skipped (not re-sent) and returns false', () => {
  const hub = new StreamHub()
  const a = sink()
  hub.addViewer('dev', a, frameChunk)
  assert.equal(hub.publish('dev', jpeg('same'), frameChunk), true)
  assert.equal(hub.publish('dev', jpeg('same'), frameChunk), false) // identical → skip
  assert.equal(a.writes.length, 1, 'only the first frame was sent')
  assert.equal(hub.publish('dev', jpeg('different'), frameChunk), true)
  assert.equal(a.writes.length, 2)
})

test('a new viewer immediately receives the latest frame', () => {
  const hub = new StreamHub()
  hub.publish('dev', jpeg('latest'), frameChunk) // no viewers yet
  const late = sink()
  hub.addViewer('dev', late, frameChunk)
  assert.equal(late.writes.length, 1)
  assert.ok(late.writes[0].includes('latest'))
})

test('removeViewer stops fan-out to it', () => {
  const hub = new StreamHub()
  const a = sink()
  hub.addViewer('dev', a, frameChunk)
  hub.removeViewer('dev', a)
  hub.publish('dev', jpeg('x'), frameChunk)
  assert.equal(a.writes.length, 0)
})

test('a throwing sink is dropped, others keep receiving', () => {
  const hub = new StreamHub()
  const bad: Sink = { write: () => { throw new Error('client gone') } }
  const good = sink()
  hub.addViewer('dev', bad, frameChunk)
  hub.addViewer('dev', good, frameChunk)
  hub.publish('dev', jpeg('f1'), frameChunk)
  assert.equal(hub.viewerCount('dev'), 1) // bad removed
  hub.publish('dev', jpeg('f2'), frameChunk)
  assert.equal(good.writes.length, 2)
})

test('streams are isolated per device (no cross-device leakage)', () => {
  const hub = new StreamHub()
  const a = sink()
  hub.addViewer('devA', a, frameChunk)
  hub.publish('devB', jpeg('B-only'), frameChunk)
  assert.equal(a.writes.length, 0, 'devA viewer never sees devB frames')
})

test('frameChunk has the multipart boundary, jpeg content-type, and length', () => {
  const c = frameChunk(Buffer.from('abc'))
  const s = c.toString('latin1')
  assert.ok(s.startsWith('--mobfleetframe\r\n'))
  assert.ok(s.includes('Content-Type: image/jpeg'))
  assert.ok(s.includes('Content-Length: 3'))
  assert.ok(s.endsWith('abc\r\n'))
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { StreamHub, type Sink } from './hub'
import { frameChunk } from './multipart'

const jpeg = (s: string) => Buffer.from(s)

/** A fake viewer sink with controllable backpressure. write() returns !backed; onDrain() stores a
 *  one-shot cb that drain() fires. */
const makeSink = () => {
  const writes: Buffer[] = []
  let drainCb: (() => void) | null = null
  let backed = false
  let throwOnWrite = false
  const sink: Sink = {
    write: (c: Buffer) => { if (throwOnWrite) throw new Error('client gone'); writes.push(c); return !backed },
    onDrain: (cb: () => void) => { drainCb = cb },
  }
  return {
    sink, writes,
    setBacked: (b: boolean) => { backed = b },
    setThrow: (b: boolean) => { throwOnWrite = b },
    drain: () => { const cb = drainCb; drainCb = null; if (cb) cb() },
  }
}

test('publish fans a NEW frame to all viewers and returns true', () => {
  const hub = new StreamHub()
  const a = makeSink(), b = makeSink()
  hub.addViewer('dev', a.sink, frameChunk)
  hub.addViewer('dev', b.sink, frameChunk)
  assert.equal(hub.publish('dev', jpeg('frame-1'), frameChunk), true)
  assert.equal(a.writes.length, 1); assert.equal(b.writes.length, 1)
  assert.ok(a.writes[0].includes('image/jpeg') && a.writes[0].includes('frame-1'))
})

test('a DUPLICATE frame is skipped (not re-sent) and returns false', () => {
  const hub = new StreamHub()
  const a = makeSink()
  hub.addViewer('dev', a.sink, frameChunk)
  assert.equal(hub.publish('dev', jpeg('same'), frameChunk), true)
  assert.equal(hub.publish('dev', jpeg('same'), frameChunk), false)
  assert.equal(a.writes.length, 1)
  assert.equal(hub.publish('dev', jpeg('different'), frameChunk), true)
  assert.equal(a.writes.length, 2)
})

test('a new viewer immediately receives the latest frame', () => {
  const hub = new StreamHub()
  hub.publish('dev', jpeg('latest'), frameChunk)
  const late = makeSink()
  hub.addViewer('dev', late.sink, frameChunk)
  assert.equal(late.writes.length, 1); assert.ok(late.writes[0].includes('latest'))
})

test('removeViewer stops fan-out to it', () => {
  const hub = new StreamHub()
  const a = makeSink()
  hub.addViewer('dev', a.sink, frameChunk)
  hub.removeViewer('dev', a.sink)
  hub.publish('dev', jpeg('x'), frameChunk)
  assert.equal(a.writes.length, 0)
  assert.equal(hub.viewerCount('dev'), 0)
})

test('a throwing sink is dropped, others keep receiving', () => {
  const hub = new StreamHub()
  const bad = makeSink(); bad.setThrow(true)
  const good = makeSink()
  hub.addViewer('dev', bad.sink, frameChunk)
  hub.addViewer('dev', good.sink, frameChunk)
  hub.publish('dev', jpeg('f1'), frameChunk)
  hub.publish('dev', jpeg('f2'), frameChunk)
  assert.equal(good.writes.length, 2)
})

test('streams are isolated per device (no cross-device leakage)', () => {
  const hub = new StreamHub()
  const a = makeSink()
  hub.addViewer('devA', a.sink, frameChunk)
  hub.publish('devB', jpeg('B-only'), frameChunk)
  assert.equal(a.writes.length, 0)
})

// ── backpressure (the smoothness fix) ──
test('a slow viewer gets only the LATEST frame on drain — intermediate frames dropped', () => {
  const hub = new StreamHub()
  const v = makeSink()
  hub.addViewer('dev', v.sink, frameChunk)
  v.setBacked(true)                              // socket full → write() returns false
  hub.publish('dev', jpeg('f1'), frameChunk)     // written, returns false → writable=false
  hub.publish('dev', jpeg('f2'), frameChunk)     // backed → pending=f2
  hub.publish('dev', jpeg('f3'), frameChunk)     // backed → pending=f3 (f2 DROPPED)
  assert.equal(v.writes.length, 1, 'only f1 written while backed up')
  assert.ok(v.writes[0].includes('f1'))
  v.setBacked(false); v.drain()                  // drain → flush the LATEST pending (f3)
  assert.equal(v.writes.length, 2)
  assert.ok(v.writes[1].includes('f3'), 'newest frame, not the intermediate f2')
  const s = hub.stats()
  assert.equal(s.framesIn, 3); assert.equal(s.framesCoalesced, 1) // f2 coalesced away
})

test('backpressure never buffers more than one pending frame (bounded memory)', () => {
  const hub = new StreamHub()
  const v = makeSink()
  hub.addViewer('dev', v.sink, frameChunk)
  v.setBacked(true)
  for (let i = 0; i < 1000; i++) hub.publish('dev', jpeg('f' + i), frameChunk)
  // 1 written (the first) + 999 coalesced into a single pending — no growth.
  assert.equal(v.writes.length, 1)
  assert.equal(hub.stats().framesCoalesced, 998) // f1 written; f2..f999 each overwrite a pending
  v.setBacked(false); v.drain()
  assert.equal(v.writes.length, 2)
  assert.ok(v.writes[1].includes('f999'), 'the very latest frame is delivered')
})

test('a viewer removed while backed-up does not receive a write on drain', () => {
  const hub = new StreamHub()
  const v = makeSink()
  hub.addViewer('dev', v.sink, frameChunk)
  v.setBacked(true)
  hub.publish('dev', jpeg('a'), frameChunk) // written → writable=false
  hub.publish('dev', jpeg('b'), frameChunk) // pending=b
  hub.removeViewer('dev', v.sink)           // closed
  v.setBacked(false); v.drain()             // drain cb must no-op (closed)
  assert.equal(v.writes.length, 1)          // only the original 'a'
})

test('stats() reports aggregate throughput without device IDs', () => {
  const hub = new StreamHub()
  const a = makeSink()
  hub.addViewer('dev', a.sink, frameChunk)
  hub.publish('dev', jpeg('1'), frameChunk)
  const s = hub.stats()
  assert.deepEqual(Object.keys(s).sort(), ['devices', 'framesCoalesced', 'framesIn', 'framesOut', 'viewers'])
  assert.equal(s.devices, 1); assert.equal(s.viewers, 1); assert.equal(s.framesIn, 1); assert.equal(s.framesOut, 1)
})

test('an idle device entry is dropped when its last viewer leaves (no Map growth)', () => {
  const hub = new StreamHub()
  const a = makeSink()
  hub.addViewer('dev', a.sink, frameChunk)
  assert.equal(hub.stats().devices, 1)
  hub.removeViewer('dev', a.sink)
  assert.equal(hub.stats().devices, 0, 'no stale device entry left behind')
})

test('clearPublisher drops the entry when no viewers remain', () => {
  const hub = new StreamHub()
  hub.publish('dev', jpeg('x'), frameChunk) // creates entry + latest
  assert.equal(hub.stats().devices, 1)
  hub.clearPublisher('dev')
  assert.equal(hub.stats().devices, 0)
})

test('an ACTIVE device (publisher frame present) keeps its entry after a viewer leaves', () => {
  const hub = new StreamHub()
  const a = makeSink()
  hub.addViewer('dev', a.sink, frameChunk)
  hub.publish('dev', jpeg('frame'), frameChunk) // latest set → active stream
  hub.removeViewer('dev', a.sink)
  assert.equal(hub.stats().devices, 1, 'kept so a re-joining viewer gets the latest frame')
})

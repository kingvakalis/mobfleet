import { test } from 'node:test'
import assert from 'node:assert/strict'
import { StreamHub, type Sink } from './hub'
import { frameChunk } from './multipart'

const jpeg = (s: string) => Buffer.from(s)

/** A fake viewer sink with controllable backpressure. */
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

// Synchronous scheduler → ingest drains immediately (fan-out happens within publish()) for the
// fan-out/backpressure tests. Ingestion-coalescing tests inject a DEFERRED scheduler instead.
const syncHub = () => new StreamHub((cb) => cb())

// ── viewer fan-out ──
test('publish fans a NEW frame to all viewers', () => {
  const hub = syncHub()
  const a = makeSink(), b = makeSink()
  hub.addViewer('dev', a.sink, frameChunk)
  hub.addViewer('dev', b.sink, frameChunk)
  hub.publish('dev', jpeg('frame-1'), frameChunk)
  assert.equal(a.writes.length, 1); assert.equal(b.writes.length, 1)
  assert.ok(a.writes[0].includes('image/jpeg') && a.writes[0].includes('frame-1'))
})

test('a DUPLICATE frame is skipped (not re-sent)', () => {
  const hub = syncHub()
  const a = makeSink()
  hub.addViewer('dev', a.sink, frameChunk)
  hub.publish('dev', jpeg('same'), frameChunk)
  hub.publish('dev', jpeg('same'), frameChunk)
  assert.equal(a.writes.length, 1)
  hub.publish('dev', jpeg('different'), frameChunk)
  assert.equal(a.writes.length, 2)
})

test('a new viewer immediately receives the latest frame', () => {
  const hub = syncHub()
  hub.publish('dev', jpeg('latest'), frameChunk)
  const late = makeSink()
  hub.addViewer('dev', late.sink, frameChunk)
  assert.equal(late.writes.length, 1); assert.ok(late.writes[0].includes('latest'))
})

test('removeViewer stops fan-out to it', () => {
  const hub = syncHub()
  const a = makeSink()
  hub.addViewer('dev', a.sink, frameChunk)
  hub.removeViewer('dev', a.sink)
  hub.publish('dev', jpeg('x'), frameChunk)
  assert.equal(a.writes.length, 0)
})

test('a throwing sink is pruned, others keep receiving', () => {
  const hub = syncHub()
  const bad = makeSink(); bad.setThrow(true)
  const good = makeSink()
  hub.addViewer('dev', bad.sink, frameChunk)
  hub.addViewer('dev', good.sink, frameChunk)
  hub.publish('dev', jpeg('f1'), frameChunk)
  assert.equal(hub.viewerCount('dev'), 1) // bad pruned
  hub.publish('dev', jpeg('f2'), frameChunk)
  assert.equal(good.writes.length, 2)
})

test('streams are isolated per device', () => {
  const hub = syncHub()
  const a = makeSink()
  hub.addViewer('devA', a.sink, frameChunk)
  hub.publish('devB', jpeg('B-only'), frameChunk)
  assert.equal(a.writes.length, 0)
})

// ── viewer backpressure (drop-to-latest) ──
test('a slow viewer gets only the LATEST frame on drain', () => {
  const hub = syncHub()
  const v = makeSink()
  hub.addViewer('dev', v.sink, frameChunk)
  v.setBacked(true)
  hub.publish('dev', jpeg('f1'), frameChunk)
  hub.publish('dev', jpeg('f2'), frameChunk)
  hub.publish('dev', jpeg('f3'), frameChunk)
  assert.equal(v.writes.length, 1, 'only f1 written while backed up')
  v.setBacked(false); v.drain()
  assert.equal(v.writes.length, 2)
  assert.ok(v.writes[1].includes('f3'))
  assert.equal(hub.stats().framesCoalesced, 1) // f2 coalesced on the viewer side
})

test('viewer backpressure never buffers more than one pending frame (bounded)', () => {
  const hub = syncHub()
  const v = makeSink()
  hub.addViewer('dev', v.sink, frameChunk)
  v.setBacked(true)
  for (let i = 0; i < 1000; i++) hub.publish('dev', jpeg('f' + i), frameChunk)
  assert.equal(v.writes.length, 1)
  assert.equal(hub.stats().framesCoalesced, 998)
  v.setBacked(false); v.drain()
  assert.ok(v.writes[1].includes('f999'))
})

test('a viewer removed while backed-up does not receive a write on drain', () => {
  const hub = syncHub()
  const v = makeSink()
  hub.addViewer('dev', v.sink, frameChunk)
  v.setBacked(true)
  hub.publish('dev', jpeg('a'), frameChunk)
  hub.publish('dev', jpeg('b'), frameChunk)
  hub.removeViewer('dev', v.sink)
  v.setBacked(false); v.drain()
  assert.equal(v.writes.length, 1)
})

// ── INGESTION coalescing (publisher → relay) ──
test('1000 incoming frames while fan-out is busy → bounded memory, latest wins, framesCoalesced', () => {
  const drains: Array<() => void> = []
  const hub = new StreamHub((cb) => drains.push(cb)) // DEFER fan-out (simulate a busy relay)
  const v = makeSink()
  hub.addViewer('dev', v.sink, frameChunk)
  for (let i = 0; i < 1000; i++) hub.publish('dev', jpeg('f' + i), frameChunk)
  assert.equal(drains.length, 1, 'one drain scheduled regardless of input rate')
  assert.equal(hub.stats().framesCoalesced, 999, '999 stale inputs dropped on ingestion')
  assert.equal(v.writes.length, 0, 'nothing fanned out until the drain runs')
  drains[0]() // run the deferred drain
  assert.equal(v.writes.length, 1, 'only the newest frame fanned out')
  assert.ok(v.writes[0].includes('f999'))
  assert.equal(hub.stats().framesIn, 1)
})

test('framesCoalesced increments on publisher-side stale drops (even with no viewers)', () => {
  const drains: Array<() => void> = []
  const hub = new StreamHub((cb) => drains.push(cb))
  hub.publish('dev', jpeg('a'), frameChunk) // pending=a, drain scheduled
  hub.publish('dev', jpeg('b'), frameChunk) // a superseded → coalesced
  assert.equal(hub.stats().framesCoalesced, 1)
  assert.equal(hub.stats().framesOut, 0) // no viewers
})

test('a disconnected viewer does not block publisher ingestion', () => {
  const drains: Array<() => void> = []
  const hub = new StreamHub((cb) => drains.push(cb))
  const v = makeSink(); v.setThrow(true)
  hub.addViewer('dev', v.sink, frameChunk)
  hub.publish('dev', jpeg('a'), frameChunk)
  hub.publish('dev', jpeg('b'), frameChunk)
  drains[0]() // fan-out → write throws → viewer pruned; ingestion unaffected
  assert.equal(hub.viewerCount('dev'), 0)
  assert.equal(hub.stats().framesOut, 0)
  hub.publish('dev', jpeg('c'), frameChunk) // ingestion still accepts + schedules
  assert.equal(drains.length, 2)
})

test('no framesOut without viewers', () => {
  const hub = syncHub()
  hub.publish('dev', jpeg('x'), frameChunk)
  assert.equal(hub.stats().framesOut, 0)
  assert.equal(hub.stats().framesIn, 1)
})

// ── memory bounds (Map cleanup) ──
test('an idle device entry is dropped when its last viewer leaves', () => {
  const hub = syncHub()
  const a = makeSink()
  hub.addViewer('dev', a.sink, frameChunk)
  assert.equal(hub.stats().devices, 1)
  hub.removeViewer('dev', a.sink)
  assert.equal(hub.stats().devices, 0)
})

test('clearPublisher drops the entry when no viewers remain', () => {
  const hub = syncHub()
  hub.publish('dev', jpeg('x'), frameChunk)
  assert.equal(hub.stats().devices, 1)
  hub.clearPublisher('dev')
  assert.equal(hub.stats().devices, 0)
})

test('an ACTIVE device keeps its entry after a viewer leaves', () => {
  const hub = syncHub()
  const a = makeSink()
  hub.addViewer('dev', a.sink, frameChunk)
  hub.publish('dev', jpeg('frame'), frameChunk)
  hub.removeViewer('dev', a.sink)
  assert.equal(hub.stats().devices, 1)
})

test('stats() exposes aggregate throughput without device IDs', () => {
  const hub = syncHub()
  const a = makeSink()
  hub.addViewer('dev', a.sink, frameChunk)
  hub.publish('dev', jpeg('1'), frameChunk)
  const s = hub.stats()
  assert.deepEqual(Object.keys(s).sort(), ['devices', 'framesCoalesced', 'framesIn', 'framesOut', 'viewers'])
  assert.equal(s.framesIn, 1); assert.equal(s.framesOut, 1)
})

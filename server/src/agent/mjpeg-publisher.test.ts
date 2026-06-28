import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MjpegPublisher } from './mjpeg-publisher'

const frame = (s: string) => Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from(s), Buffer.from([0xff, 0xd9])])

class FakeWS {
  static OPEN = 1
  static instances: FakeWS[] = []
  readyState = 1
  binaryType = 'arraybuffer'
  sent: Buffer[] = []
  private listeners: Record<string, Array<() => void>> = {}
  constructor(public url: string) { FakeWS.instances.push(this); queueMicrotask(() => this.emit('open')) }
  addEventListener(ev: string, cb: () => void) { (this.listeners[ev] ??= []).push(cb) }
  private emit(ev: string) { for (const cb of [...(this.listeners[ev] ?? [])]) cb() }
  send(data: ArrayBufferView) { this.sent.push(Buffer.from(data as Uint8Array)) }
  close() { this.readyState = 3; this.emit('close') }
}

const streamOf = (...chunks: Buffer[]): ReadableStream<Uint8Array> =>
  new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(new Uint8Array(ch)); c.close() } })

test('publisher forwards NEW frames over WSS and de-dupes identical ones', async () => {
  FakeWS.instances = []
  const body = streamOf(frame('A'), frame('A'), frame('B')) // A, duplicate A, B
  const fetchImpl = (async () => ({ ok: true, body })) as unknown as typeof fetch
  const pub = new MjpegPublisher(
    { udid: 'u', deviceKey: 'k', relayUrl: 'wss://relay/publish', mjpegUrl: 'http://127.0.0.1:9100' },
    { fetchImpl, WebSocketImpl: FakeWS as unknown as typeof WebSocket },
  )
  await pub.runOnce()
  const ws = FakeWS.instances[0]
  assert.equal(ws.sent.length, 2, 'the duplicate A is skipped — only A and B forwarded')
  assert.deepEqual(ws.sent.map((b) => b.subarray(2, b.length - 2).toString()), ['A', 'B'])
})

test('a reconnect re-sends the current frame (dedup baseline reset per connection)', async () => {
  FakeWS.instances = []
  // fresh stream each connect; the SAME static frame both times.
  const fetchImpl = (async () => ({ ok: true, body: streamOf(frame('STATIC')) })) as unknown as typeof fetch
  const pub = new MjpegPublisher(
    { udid: 'u', deviceKey: 'k', relayUrl: 'wss://relay/publish', mjpegUrl: 'http://127.0.0.1:9100' },
    { fetchImpl, WebSocketImpl: FakeWS as unknown as typeof WebSocket },
  )
  await pub.runOnce() // connection 1 → sends STATIC
  await pub.runOnce() // connection 2 (reconnect) → must RE-SEND STATIC, not dedupe across the boundary
  assert.equal(FakeWS.instances.length, 2)
  assert.equal(FakeWS.instances[0].sent.length, 1)
  assert.equal(FakeWS.instances[1].sent.length, 1, 'first frame of the reconnect is forwarded, not deduped')
  assert.equal(FakeWS.instances[1].sent[0].subarray(2, FakeWS.instances[1].sent[0].length - 2).toString(), 'STATIC')
})

test('publisher passes the device-key to the relay publish URL', async () => {
  FakeWS.instances = []
  const fetchImpl = (async () => ({ ok: true, body: streamOf(frame('x')) })) as unknown as typeof fetch
  const pub = new MjpegPublisher(
    { udid: 'u', deviceKey: 'secret-key', relayUrl: 'wss://relay/publish', mjpegUrl: 'http://127.0.0.1:9100' },
    { fetchImpl, WebSocketImpl: FakeWS as unknown as typeof WebSocket },
  )
  await pub.runOnce()
  assert.match(FakeWS.instances[0].url, /\/publish\?key=secret-key$/)
})

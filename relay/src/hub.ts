/**
 * Per-device frame hub. Two independent coalescing stages keep MJPEG fresh + bounded under load:
 *
 *  1. INGESTION (publisher → relay): each incoming frame is stored as the device's single latest
 *     `pendingInput` and fan-out is scheduled ASYNCHRONOUSLY. If frames arrive faster than fan-out
 *     drains them (a busy relay / slow viewers / event-loop pressure), the newest frame replaces the
 *     pending one and the stale frame is DROPPED before it ever enters fan-out — so stale frames can
 *     never queue between the publisher and the viewers. Bounded: ≤1 pending input per device.
 *
 *  2. VIEWER FAN-OUT (relay → browser): per-viewer drop-to-latest backpressure — if a browser socket
 *     is full (write()===false) hold ONLY the newest frame and flush it on 'drain'.
 *
 * De-dupe (identical static frames) happens at fan-out. framesCoalesced counts BOTH stale-drop stages.
 * Nothing is persisted; memory is bounded per device + per viewer. Pure (no http/ws) → unit-testable;
 * the async scheduler is injectable so tests are deterministic.
 */
import { createHash } from 'node:crypto'

/** A viewer sink — the browser's HTTP response. `write` returns false when backpressured; `onDrain`
 *  registers a ONE-SHOT callback fired when it can accept more. */
export interface Sink {
  write(chunk: Buffer): boolean
  onDrain(cb: () => void): void
}

interface Viewer {
  sink: Sink
  writable: boolean
  pending: Buffer | null
  closed: boolean
}

interface DeviceState {
  latest: Buffer | null            // last FANNED-OUT frame (sent to a newly-joined viewer)
  lastHash: string | null          // de-dupe baseline (last fanned-out)
  viewers: Map<Sink, Viewer>
  pendingInput: Buffer | null      // latest INGESTED frame awaiting fan-out (ingestion coalescing buffer)
  pendingChunkFor: ((b: Buffer) => Buffer) | null
  draining: boolean
}

export interface HubStats { devices: number; viewers: number; framesIn: number; framesOut: number; framesCoalesced: number }

export class StreamHub {
  private readonly devices = new Map<string, DeviceState>()
  private framesIn = 0
  private framesOut = 0
  private framesCoalesced = 0

  /** schedule = how the async fan-out drain is deferred (default setImmediate; injectable for tests). */
  constructor(private readonly schedule: (cb: () => void) => void = (cb) => { setImmediate(cb) }) {}

  private get(deviceId: string): DeviceState {
    let s = this.devices.get(deviceId)
    if (!s) { s = { latest: null, lastHash: null, viewers: new Map(), pendingInput: null, pendingChunkFor: null, draining: false }; this.devices.set(deviceId, s) }
    return s
  }

  /**
   * INGEST a publisher frame. Coalesces to the single latest frame per device + schedules async
   * fan-out — never queues unbounded. A replaced (stale) pending input is dropped (framesCoalesced++).
   * The relay calls this on every WS message; it returns immediately so a disconnected/slow viewer can
   * never block ingestion.
   */
  publish(deviceId: string, jpeg: Buffer, chunkFor: (b: Buffer) => Buffer): void {
    const s = this.get(deviceId)
    if (s.pendingInput) this.framesCoalesced++ // a still-unsent frame is superseded → drop the stale one
    s.pendingInput = jpeg
    s.pendingChunkFor = chunkFor
    if (!s.draining) { s.draining = true; this.schedule(() => this.drain(deviceId)) }
  }

  /** Drain the latest pending input(s) into fan-out. Always processes the NEWEST available frame. */
  private drain(deviceId: string): void {
    const s = this.devices.get(deviceId)
    if (!s) return
    while (s.pendingInput) {
      const jpeg = s.pendingInput
      const chunkFor = s.pendingChunkFor!
      s.pendingInput = null
      this.fanOut(s, jpeg, chunkFor)
    }
    s.draining = false
  }

  /** De-dupe + fan out one frame to all viewers (with per-viewer backpressure). */
  private fanOut(s: DeviceState, jpeg: Buffer, chunkFor: (b: Buffer) => Buffer): void {
    const hash = createHash('sha1').update(jpeg).digest('hex')
    if (hash === s.lastHash) return // identical to the last fanned-out frame (static screen) → skip
    s.lastHash = hash
    s.latest = jpeg
    this.framesIn++
    const chunk = chunkFor(jpeg)
    for (const v of s.viewers.values()) this.send(v, chunk)
    // Prune viewers that died during the send (write threw) so a dead viewer never blocks/bloats fan-out.
    for (const [sink, v] of s.viewers) if (v.closed) s.viewers.delete(sink)
  }

  /** Write a framed chunk to one viewer, honoring backpressure (drop-to-latest). */
  private send(v: Viewer, chunk: Buffer): void {
    if (v.closed) return
    if (!v.writable) {
      if (v.pending) this.framesCoalesced++ // viewer still draining → drop its prior pending (newest wins)
      v.pending = chunk
      return
    }
    let ok: boolean
    try { ok = v.sink.write(chunk) } catch { this.dropViewer(v); return }
    this.framesOut++
    if (ok === false) {
      v.writable = false
      v.sink.onDrain(() => {
        if (v.closed) return
        v.writable = true
        const p = v.pending
        v.pending = null
        if (p) this.send(v, p) // flush the LATEST pending frame
      })
    }
  }

  private dropViewer(v: Viewer): void { v.closed = true; v.pending = null }

  /** Register a viewer + immediately send the latest fanned-out frame (if any) so it paints right away. */
  addViewer(deviceId: string, sink: Sink, chunkFor: (b: Buffer) => Buffer): void {
    const s = this.get(deviceId)
    const v: Viewer = { sink, writable: true, pending: null, closed: false }
    s.viewers.set(sink, v)
    if (s.latest) this.send(v, chunkFor(s.latest))
  }

  removeViewer(deviceId: string, sink: Sink): void {
    const s = this.devices.get(deviceId)
    if (!s) return
    const v = s.viewers.get(sink)
    if (v) { v.closed = true; v.pending = null }
    s.viewers.delete(sink)
    if (s.viewers.size === 0 && !s.latest && !s.pendingInput && !s.draining) this.devices.delete(deviceId)
  }

  /** Publisher disconnected — drop its buffered frames (viewers stay; they get the next publisher's). */
  clearPublisher(deviceId: string): void {
    const s = this.devices.get(deviceId)
    if (!s) return
    s.latest = null
    s.lastHash = null
    s.pendingInput = null
    if (s.viewers.size === 0 && !s.draining) this.devices.delete(deviceId)
  }

  viewerCount(deviceId: string): number { return this.devices.get(deviceId)?.viewers.size ?? 0 }

  /** Aggregate throughput for the relay /health metrics (no device IDs exposed). */
  stats(): HubStats {
    let viewers = 0
    for (const s of this.devices.values()) viewers += s.viewers.size
    return { devices: this.devices.size, viewers, framesIn: this.framesIn, framesOut: this.framesOut, framesCoalesced: this.framesCoalesced }
  }
}

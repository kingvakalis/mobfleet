/**
 * Per-device frame hub: one publisher (the Mac agent) fans out to N authorized viewers (browsers),
 * de-duplicating identical frames AND applying per-viewer BACKPRESSURE — if a browser is slow to drain,
 * we keep only the NEWEST frame for it and drop the intermediate ones, rather than buffering a backlog
 * of stale frames (which is what makes MJPEG feel laggy/bursty). Freshness over completeness.
 *
 * Memory is bounded: per device, the latest frame; per viewer, at most ONE in-flight write + ONE
 * pending (latest) frame. Nothing unbounded, nothing persisted. Pure (no http/ws) → unit-testable.
 */
import { createHash } from 'node:crypto'

/** A viewer sink — the browser's HTTP response. `write` returns false when backpressured (the socket
 *  buffer is full); `onDrain` registers a ONE-SHOT callback fired when it can accept more. */
export interface Sink {
  write(chunk: Buffer): boolean
  onDrain(cb: () => void): void
}

interface Viewer {
  sink: Sink
  writable: boolean      // false while a previous write is still draining
  pending: Buffer | null // the newest frame waiting for drain (older ones are dropped)
  closed: boolean
}

interface DeviceState {
  latest: Buffer | null
  lastHash: string | null
  viewers: Map<Sink, Viewer>
}

export interface HubStats { devices: number; viewers: number; framesIn: number; framesOut: number; framesCoalesced: number }

export class StreamHub {
  private readonly devices = new Map<string, DeviceState>()
  private framesIn = 0
  private framesOut = 0
  private framesCoalesced = 0

  private get(deviceId: string): DeviceState {
    let s = this.devices.get(deviceId)
    if (!s) { s = { latest: null, lastHash: null, viewers: new Map() }; this.devices.set(deviceId, s) }
    return s
  }

  /**
   * Ingest a publisher frame. De-dupes identical frames (static screen → no re-send) and fans NEW
   * frames out to viewers with per-viewer backpressure. Returns true if forwarded, false if a duplicate.
   */
  publish(deviceId: string, jpeg: Buffer, chunkFor: (b: Buffer) => Buffer): boolean {
    const s = this.get(deviceId)
    const hash = createHash('sha1').update(jpeg).digest('hex')
    if (hash === s.lastHash) return false // duplicate frame → skip
    s.lastHash = hash
    s.latest = jpeg
    this.framesIn++
    const chunk = chunkFor(jpeg)
    for (const v of s.viewers.values()) this.send(v, chunk)
    return true
  }

  /** Write a framed chunk to one viewer, honoring backpressure (drop-to-latest). */
  private send(v: Viewer, chunk: Buffer): void {
    if (v.closed) return
    if (!v.writable) {
      // Still draining the previous write → keep ONLY the newest frame; the prior pending is dropped.
      if (v.pending) this.framesCoalesced++
      v.pending = chunk
      return
    }
    let ok: boolean
    try { ok = v.sink.write(chunk) } catch { this.drop(v); return }
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

  private drop(v: Viewer): void { v.closed = true; v.pending = null }

  /** Register a viewer + immediately send the latest frame (if any) so it paints right away. */
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
    // Idle device (no viewers + no active publisher frame) → drop the Map entry so it can't accumulate
    // one stale entry per distinct device id over the relay's lifetime. An active publisher recreates it.
    if (s.viewers.size === 0 && !s.latest) this.devices.delete(deviceId)
  }

  /** Publisher disconnected — drop its buffered frame (viewers stay; they get the next publisher's). */
  clearPublisher(deviceId: string): void {
    const s = this.devices.get(deviceId)
    if (!s) return
    s.latest = null
    s.lastHash = null
    if (s.viewers.size === 0) this.devices.delete(deviceId)
  }

  viewerCount(deviceId: string): number { return this.devices.get(deviceId)?.viewers.size ?? 0 }

  /** Aggregate throughput for the relay /health metrics (no device IDs exposed). */
  stats(): HubStats {
    let viewers = 0
    for (const s of this.devices.values()) viewers += s.viewers.size
    return { devices: this.devices.size, viewers, framesIn: this.framesIn, framesOut: this.framesOut, framesCoalesced: this.framesCoalesced }
  }
}

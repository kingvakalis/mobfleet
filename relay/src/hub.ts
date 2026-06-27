/**
 * Per-device frame hub: one publisher (the Mac agent) fans out to N authorized viewers (browsers),
 * de-duplicating identical frames so static screens don't re-send. Pure (no http/ws) → unit-testable
 * with fake sinks. Video lives only in memory here; nothing is persisted.
 */
import { createHash } from 'node:crypto'

/** A viewer sink — the browser's HTTP response (anything with write()). */
export interface Sink {
  write(chunk: Buffer): boolean
}

interface DeviceState {
  latest: Buffer | null
  lastHash: string | null
  viewers: Set<Sink>
}

export class StreamHub {
  private readonly devices = new Map<string, DeviceState>()

  private get(deviceId: string): DeviceState {
    let s = this.devices.get(deviceId)
    if (!s) { s = { latest: null, lastHash: null, viewers: new Set() }; this.devices.set(deviceId, s) }
    return s
  }

  /**
   * Ingest a publisher frame. De-dupes identical frames (a static screen → no re-send) and fans NEW
   * frames out to all current viewers. Returns true if forwarded (a new frame), false if a duplicate.
   * `chunkFor` wraps the JPEG for the wire (injected so the hub stays transport-agnostic + testable).
   */
  publish(deviceId: string, jpeg: Buffer, chunkFor: (b: Buffer) => Buffer): boolean {
    const s = this.get(deviceId)
    const hash = createHash('sha1').update(jpeg).digest('hex')
    if (hash === s.lastHash) return false // duplicate frame → skip
    s.lastHash = hash
    s.latest = jpeg
    const chunk = chunkFor(jpeg)
    for (const v of [...s.viewers]) { try { if (v.write(chunk) === false) { /* backpressure: keep */ } } catch { s.viewers.delete(v) } }
    return true
  }

  /** Register a viewer + immediately send the latest frame (if any) so it paints right away. */
  addViewer(deviceId: string, sink: Sink, chunkFor: (b: Buffer) => Buffer): void {
    const s = this.get(deviceId)
    s.viewers.add(sink)
    if (s.latest) { try { sink.write(chunkFor(s.latest)) } catch { s.viewers.delete(sink) } }
  }

  removeViewer(deviceId: string, sink: Sink): void {
    this.devices.get(deviceId)?.viewers.delete(sink)
  }

  /** Publisher disconnected — drop its buffered frame (viewers stay; they get the next publisher's). */
  clearPublisher(deviceId: string): void {
    const s = this.devices.get(deviceId)
    if (s) { s.latest = null; s.lastHash = null }
  }

  viewerCount(deviceId: string): number { return this.devices.get(deviceId)?.viewers.size ?? 0 }
}

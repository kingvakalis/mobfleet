/**
 * Per-device MJPEG publisher (Stage 2A). Reads WDA's LOCAL MJPEG (http://127.0.0.1:<port>), de-dupes
 * identical frames, and pushes each NEW JPEG OUTBOUND over WSS to the hosted relay (one binary message
 * per frame). The relay authenticates this publisher by the device-key. Lifecycle is owned by the live
 * AgentRuntime (started in bringUp, stopped in tearDown) — NO second agent, NO change to AGENT_DEVICES.
 * The raw 127.0.0.1:<port> is read locally only and never exposed. Reconnects with backoff on drop.
 *
 * fetch + WebSocket are injectable so the demux + de-dupe path is unit-tested without a network.
 */
import { createHash } from 'node:crypto'
import { MjpegDemux } from './mjpeg-demux'

export interface MjpegPublisherConfig {
  udid: string
  deviceKey: string
  relayUrl: string // wss://<relay>/publish
  mjpegUrl: string // http://127.0.0.1:9100
  reconnectMs?: number
}
export interface MjpegPublisherDeps {
  fetchImpl?: typeof fetch
  WebSocketImpl?: typeof WebSocket
  log?: (event: string, fields?: Record<string, unknown>) => void
}

// Opt-in publisher metrics (frames read/forwarded/deduped, reconnects) — OFF unless PFA_MJPEG_DEBUG=1,
// so logs are never spammed by default. Emits an `mjpeg.metrics` line every 5s while streaming.
const MJPEG_DEBUG = process.env.PFA_MJPEG_DEBUG === '1' || process.env.PFA_MJPEG_DEBUG === 'true'

export class MjpegPublisher {
  private stopped = false
  private ws: WebSocket | null = null
  private abort: AbortController | null = null
  private lastHash = ''
  private timer: ReturnType<typeof setTimeout> | undefined
  private metricsTimer: ReturnType<typeof setInterval> | undefined
  private backoffResolve: (() => void) | null = null
  private readonly m = { read: 0, forwarded: 0, deduped: 0, reconnects: 0, errors: 0, forwardedBytes: 0 }
  private lastForwarded = 0
  private lastBytes = 0
  private readonly fetchImpl: typeof fetch
  private readonly WS: typeof WebSocket
  private readonly log: (e: string, f?: Record<string, unknown>) => void

  constructor(private readonly cfg: MjpegPublisherConfig, deps: MjpegPublisherDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? (globalThis.fetch as typeof fetch)
    this.WS = deps.WebSocketImpl ?? (globalThis.WebSocket as typeof WebSocket)
    this.log = deps.log ?? (() => {})
  }

  start(): void {
    if (this.stopped) return
    if (MJPEG_DEBUG && !this.metricsTimer) {
      this.metricsTimer = setInterval(() => {
        const fwd = this.m.forwarded - this.lastForwarded
        this.lastForwarded = this.m.forwarded
        const bytes = this.m.forwardedBytes - this.lastBytes
        this.lastBytes = this.m.forwardedBytes
        // bufferedAmount = bytes queued but not yet flushed to the relay socket = publisher→relay backup
        // (the key ingestion-latency signal; a rising value means the relay/link can't keep up).
        const buffered = (this.ws as { bufferedAmount?: number } | null)?.bufferedAmount ?? 0
        this.log('mjpeg.metrics', { udid: this.cfg.udid, ...this.m, fwdFps: Math.round((fwd / 5) * 10) / 10, kbps: Math.round((bytes * 8) / 5 / 1024), bufferedAmount: buffered })
      }, 5000)
      if (typeof this.metricsTimer.unref === 'function') this.metricsTimer.unref()
    }
    void this.loop()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    if (this.metricsTimer) clearInterval(this.metricsTimer)
    if (this.backoffResolve) { this.backoffResolve(); this.backoffResolve = null } // unblock a pending backoff
    try { this.abort?.abort() } catch { /* noop */ }
    try { this.ws?.close() } catch { /* noop */ }
  }

  private async loop(): Promise<void> {
    let first = true
    while (!this.stopped) {
      if (!first) this.m.reconnects++
      first = false
      try { await this.runOnce() }
      catch (err) { this.m.errors++; this.log('mjpeg.publish.error', { udid: this.cfg.udid, error: (err as { message?: string })?.message }) }
      if (this.stopped) break
      // Fixed reconnect backoff — never a tight loop, even if the relay/source fails fast. Resolvable by
      // stop() so teardown never leaves this loop suspended.
      await new Promise<void>((r) => { this.backoffResolve = r; this.timer = setTimeout(() => { this.backoffResolve = null; r() }, this.cfg.reconnectMs ?? 2000) })
    }
  }

  /** One connection cycle: open the relay WSS, stream the local MJPEG, forward new frames, until the
   *  stream ends / the WS drops / stop(). PUBLIC for unit testing the demux + de-dupe with fakes. */
  async runOnce(): Promise<void> {
    const sep = this.cfg.relayUrl.includes('?') ? '&' : '?'
    const ws = new this.WS(`${this.cfg.relayUrl}${sep}key=${encodeURIComponent(this.cfg.deviceKey)}`)
    this.ws = ws
    try { ws.binaryType = 'arraybuffer' } catch { /* fake ws */ }
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true })
      ws.addEventListener('error', () => reject(new Error('relay ws error')), { once: true })
      ws.addEventListener('close', () => reject(new Error('relay ws closed before open')), { once: true })
    })

    this.abort = new AbortController()
    const res = await this.fetchImpl(this.cfg.mjpegUrl, { signal: this.abort.signal })
    if (!res.ok || !res.body) throw new Error(`mjpeg HTTP ${res.status}`)

    // Reset the de-dupe baseline per CONNECTION: a reconnect must re-send the current frame even if it
    // is byte-identical to the previous connection's last frame, or a new relay/viewer sees a frozen
    // screen until the content changes.
    this.lastHash = ''
    const demux = new MjpegDemux((jpeg) => {
      this.m.read++
      const hash = createHash('sha1').update(jpeg).digest('hex')
      if (hash === this.lastHash) { this.m.deduped++; return } // de-dupe identical frames (static screen)
      // Advance the baseline ONLY on a successful send — a frame dropped because the ws isn't OPEN must
      // not poison the de-dupe (else the same content is never re-sent once the ws reopens).
      if (ws.readyState === this.WS.OPEN) { ws.send(jpeg); this.lastHash = hash; this.m.forwarded++; this.m.forwardedBytes += jpeg.length }
    })

    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done || this.stopped || ws.readyState !== this.WS.OPEN) break
        if (value) demux.push(Buffer.from(value))
      }
    } finally {
      try { await reader.cancel() } catch { /* noop */ }
      try { ws.close() } catch { /* noop */ }
    }
  }
}

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

export class MjpegPublisher {
  private stopped = false
  private ws: WebSocket | null = null
  private abort: AbortController | null = null
  private lastHash = ''
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly fetchImpl: typeof fetch
  private readonly WS: typeof WebSocket
  private readonly log: (e: string, f?: Record<string, unknown>) => void

  constructor(private readonly cfg: MjpegPublisherConfig, deps: MjpegPublisherDeps = {}) {
    this.fetchImpl = deps.fetchImpl ?? (globalThis.fetch as typeof fetch)
    this.WS = deps.WebSocketImpl ?? (globalThis.WebSocket as typeof WebSocket)
    this.log = deps.log ?? (() => {})
  }

  start(): void { if (!this.stopped) void this.loop() }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    try { this.abort?.abort() } catch { /* noop */ }
    try { this.ws?.close() } catch { /* noop */ }
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      try { await this.runOnce() }
      catch (err) { this.log('mjpeg.publish.error', { udid: this.cfg.udid, error: (err as { message?: string })?.message }) }
      if (this.stopped) break
      await new Promise<void>((r) => { this.timer = setTimeout(r, this.cfg.reconnectMs ?? 2000) })
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

    const demux = new MjpegDemux((jpeg) => {
      const hash = createHash('sha1').update(jpeg).digest('hex')
      if (hash === this.lastHash) return // de-dupe identical frames (static screen → no re-send)
      this.lastHash = hash
      if (ws.readyState === this.WS.OPEN) ws.send(jpeg)
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

/**
 * MobFleet MJPEG stream relay (Stage 2A).
 *
 *   Mac agent ──outbound WSS /publish?key=<device-key>──> [relay] ──HTTP multipart /stream/:id?t=──> browser <img>
 *
 * The agent reads WDA's local 127.0.0.1:9100 MJPEG and pushes JPEG frames OUT over WSS (one binary
 * message per frame). The relay authenticates the publisher by its device-key (resolve_stream_publisher)
 * and fans frames out as multipart/x-mixed-replace to authorized browser viewers, each holding a
 * short-lived device-scoped token (redeem_stream_token). Video lives only in memory here — nothing is
 * persisted, and the raw 127.0.0.1:9100 is NEVER exposed. No service-role secret; only the anon key.
 *
 * Env: PORT (default 8090), SUPABASE_URL, SUPABASE_ANON_KEY, ALLOW_ORIGIN (default '*').
 * This is the deployable HTTPS/WSS service (terminate TLS at the host/ingress, e.g. fly.io / a small VM
 * + caddy). It is NOT the Railway /v1/devices backend and shares nothing with it.
 */
import http from 'node:http'
import { WebSocketServer } from 'ws'
import { StreamHub, type Sink } from './hub.js'
import { frameChunk, multipartContentType } from './multipart.js'
import { supabaseAuth, type RelayAuth } from './auth.js'

const PORT = Number(process.env.PORT || 8090)
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*'
const auth: RelayAuth = supabaseAuth(process.env.SUPABASE_URL || '', process.env.SUPABASE_ANON_KEY || '')
const hub = new StreamHub()

const UUID = /^[0-9a-fA-F-]{36}$/

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`)
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN)

  if (url.pathname === '/health') { res.writeHead(200); res.end('ok'); return }

  // GET /stream/<deviceId>?t=<token> → multipart MJPEG for ONE authorized viewer.
  const m = url.pathname.match(/^\/stream\/([^/]+)$/)
  if (req.method === 'GET' && m && UUID.test(m[1])) {
    const deviceId = m[1]
    const token = url.searchParams.get('t') || ''
    if (!token || !(await auth.redeemViewer(token, deviceId))) { res.writeHead(403); res.end('forbidden'); return }
    res.writeHead(200, {
      'Content-Type': multipartContentType(),
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Connection: 'close',
    })
    const sink: Sink = { write: (c: Buffer) => res.write(c) }
    hub.addViewer(deviceId, sink, frameChunk)
    req.on('close', () => hub.removeViewer(deviceId, sink))
    return
  }

  res.writeHead(404); res.end('not found')
})

// Publisher WSS: wss://<relay>/publish?key=<device-key>. Each BINARY message is one JPEG frame.
const wss = new WebSocketServer({ server, path: '/publish', maxPayload: 8 * 1024 * 1024 })
wss.on('connection', async (ws, req) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`)
  const key = url.searchParams.get('key') || ''
  const deviceId = key ? await auth.resolvePublisher(key) : null
  if (!deviceId) { ws.close(4401, 'unauthorized'); return }
  ws.on('message', (data: Buffer, isBinary: boolean) => { if (isBinary) hub.publish(deviceId, data as Buffer, frameChunk) })
  ws.on('close', () => hub.clearPublisher(deviceId))
})

server.listen(PORT, () => console.log(`[relay] listening on :${PORT}`))

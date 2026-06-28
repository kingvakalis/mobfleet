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
const SUPABASE_URL = process.env.SUPABASE_URL || ''
const ANON = process.env.SUPABASE_ANON_KEY || ''
const auth: RelayAuth = supabaseAuth(SUPABASE_URL, ANON)
const hub = new StreamHub()

const UUID = /^[0-9a-fA-F-]{36}$/

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`)
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN)

  // Health + config self-check: confirms the Supabase secrets are actually USABLE, so a misconfigured
  // SUPABASE_URL/ANON_KEY (which silently 403s every viewer + blocks every publisher) is observable.
  if (url.pathname === '/health') {
    let supabase = 'unchecked'
    let supabaseHost: string | null = null
    try { if (SUPABASE_URL) supabaseHost = new URL(SUPABASE_URL).host } catch { supabaseHost = 'INVALID_URL' }
    if (!SUPABASE_URL || !ANON) supabase = 'MISCONFIGURED: SUPABASE_URL/ANON_KEY not set'
    else {
      try {
        // bogus redeem: a reachable + correctly-keyed PostgREST returns 4xx (the RPC raises on the fake
        // token); 401 = bad anon key; a network/DNS error = bad URL.
        const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/redeem_stream_token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
          body: JSON.stringify({ p_token: '00000000-0000-0000-0000-000000000000', p_device_id: '00000000-0000-0000-0000-000000000000' }),
          signal: AbortSignal.timeout(4000),
        })
        supabase = r.status === 401 ? 'BAD_ANON_KEY (401)' : (r.status >= 200 && r.status < 500) ? 'ok' : `http_${r.status}`
      } catch (e) { supabase = `UNREACHABLE (${(e as { name?: string })?.name ?? 'error'})` }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, supabase, supabaseHost, anonKeySet: !!ANON, anonKeyLen: ANON.length }))
    return
  }

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

server.listen(PORT, '0.0.0.0', () => console.log(`[relay] listening on 0.0.0.0:${PORT}`))

import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import type { EngineRegistry } from './tenancy/engine-registry'
import { authFromToken } from './auth/context'

/**
 * Live feed: one authenticated WebSocket per browser tab at GET /ws?token=…
 *
 * SECURITY: CORS does not apply to WS upgrades, so we validate Origin AND
 * authenticate the token on the upgrade. The socket then subscribes ONLY to its
 * own team's store and receives ONLY that team's snapshots — a team can never
 * see another tenant's fleet. The team's simulation loop runs only while it has
 * at least one live subscriber (ref-counted in the registry).
 */
export function registerWs(app: FastifyInstance, registry: EngineRegistry, allowedOrigin: string) {
  let seq = 0
  // With a concrete allowlist, require a matching Origin; only "*" allows a
  // missing Origin. (The bearer token is the real gate, but keep Origin as a
  // genuine secondary barrier for a configured allowlist.)
  const originOk = (origin?: string) =>
    allowedOrigin === '*' || (!!origin && allowedOrigin.split(',').includes(origin))

  app.get('/ws', { websocket: true }, async (socket: WebSocket, req) => {
    if (!originOk(req.headers.origin)) {
      socket.close(1008, 'origin not allowed')
      return
    }
    const q = req.query as { token?: string; teamId?: string }
    let auth
    try {
      // Browsers can't set headers on a WS upgrade → token + team via query.
      auth = await authFromToken(q.token ?? null, q.teamId)
    } catch {
      socket.close(1008, 'unauthorized')
      return
    }

    let engine
    try {
      engine = await registry.get(auth.teamId)
    } catch {
      socket.close(1011, 'engine unavailable')
      return
    }
    registry.addSubscriber(engine)

    // Wire teardown IMMEDIATELY (before any further work) and make it the single
    // idempotent owner of cleanup. The handler awaited above (auth + engine
    // load); if the socket closed during that window the 'close' event fired
    // with no listener, so we also re-check liveness here — otherwise the
    // subscriber ref-count + store listener would leak (sim loop pinned on,
    // unbounded listener growth → DoS).
    let off: (() => void) | null = null
    let ping: ReturnType<typeof setInterval> | null = null
    let closed = false
    const cleanup = () => {
      if (closed) return
      closed = true
      if (ping) clearInterval(ping)
      off?.()
      registry.removeSubscriber(engine)
    }
    socket.on('close', cleanup)
    socket.on('error', cleanup)
    if (socket.readyState !== socket.OPEN) {
      cleanup()
      return
    }

    const send = () => {
      if (socket.readyState !== socket.OPEN) return
      socket.send(JSON.stringify({ type: 'snapshot', seq: ++seq, payload: engine.store.snapshot() }))
    }
    send() // initial snapshot for THIS team only
    off = engine.store.onChange(send) // only this team's changes
    ping = setInterval(() => {
      if (socket.readyState === socket.OPEN) socket.ping()
    }, 30_000)
  })
}

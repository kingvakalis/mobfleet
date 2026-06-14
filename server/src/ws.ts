import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import type { EngineRegistry } from './tenancy/engine-registry'
import { authFromToken } from './auth/context'
import { toMember } from './auth/db'
import { can } from '../../src/lib/authorization/effective-access'
import { heartbeatFrameSchema } from '../../src/shared/schemas'

/** Drop heartbeats arriving faster than this from one socket — a legit agent
 *  sends one every 10s, so anything ≥10/s is a flood (each accepted heartbeat
 *  fans a full snapshot out to every team subscriber). */
const HEARTBEAT_MIN_INTERVAL_MS = 100
/** Reject oversized inbound frames outright. */
const MAX_FRAME_BYTES = 4096

/**
 * Live feed: one authenticated WebSocket per browser tab (or device agent) at
 * GET /ws?token=…
 *
 * SECURITY: CORS does not apply to WS upgrades, so we validate Origin AND
 * authenticate the token on the upgrade. The socket then subscribes ONLY to its
 * own team's store and receives ONLY that team's snapshots — a team can never
 * see another tenant's fleet. The team's simulation loop runs only while it has
 * at least one live subscriber (ref-counted in the registry).
 *
 * The same socket also INGESTS device heartbeats: a device agent sends
 * {type:'heartbeat', deviceId, status, battery, cpuUsage, memoryUsage}; the
 * server merges it into that team's device (tenant-scoped), which persists and
 * broadcasts the change to every connected client in the team.
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

    // Heartbeat ingestion. Writing fleet state is gated on the connection's
    // role (a viewer can't spoof device telemetry); applyHeartbeat is itself
    // team-scoped, so a device id outside this team's store is rejected.
    const canWrite = can(toMember({ userId: auth.userId, role: auth.role }), 'phones.control')
    let lastHeartbeatAt = 0
    socket.on('message', (raw: Buffer) => {
      if (socket.readyState !== socket.OPEN) return
      if (raw.length > MAX_FRAME_BYTES) return
      let frame
      try {
        frame = heartbeatFrameSchema.parse(JSON.parse(raw.toString('utf8')))
      } catch {
        return // not a heartbeat (or malformed) — ignore quietly
      }
      const now = Date.now()
      if (now - lastHeartbeatAt < HEARTBEAT_MIN_INTERVAL_MS) return // flood guard
      lastHeartbeatAt = now
      if (!canWrite) {
        socket.send(JSON.stringify({ type: 'error', deviceId: frame.deviceId, error: 'forbidden' }))
        return
      }
      const ok = engine.store.applyHeartbeat(
        {
          deviceId: frame.deviceId,
          status: frame.status,
          battery: frame.battery,
          cpuUsage: frame.cpuUsage,
          memoryUsage: frame.memoryUsage,
        },
        now,
      )
      socket.send(
        JSON.stringify(
          ok
            ? { type: 'ack', deviceId: frame.deviceId, at: now }
            : { type: 'error', deviceId: frame.deviceId, error: 'unknown device' },
        ),
      )
    })
  })
}

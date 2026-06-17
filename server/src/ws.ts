import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import type { EngineRegistry } from './tenancy/engine-registry'
import { authFromToken } from './auth/context'
import { toMember } from './auth/db'
import { can } from '../../src/lib/authorization/effective-access'
import { heartbeatFrameSchema, commandResultFrameSchema } from '../../src/shared/schemas'
import { resolveDeviceKey } from './provisioning'
import { registerDeviceSender } from './device-hub'
import { registerBrowserLogSocket } from './command-log-hub'
import { acknowledgeCommandResult } from './command-completion'
import { openDeviceSession, closeDeviceSession } from './device-sessions'
import { rateLimit } from './rate-limit'

/** Drop heartbeats arriving faster than this from one socket — a legit agent
 *  sends one every 10s, so anything ≥10/s is a flood (each accepted heartbeat
 *  fans a full snapshot out to every team subscriber). */
const HEARTBEAT_MIN_INTERVAL_MS = 100
/** Reject oversized inbound frames outright. */
const MAX_FRAME_BYTES = 4096
/** Cap the pre-auth early-frame buffer so a client can't grow heap unboundedly
 *  by flooding frames during the async key lookup window. */
const MAX_EARLY_FRAMES = 8

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

  app.get('/ws', { websocket: true, config: { auth: 'public' } }, async (socket: WebSocket, req) => {
    if (!originOk(req.headers.origin)) {
      socket.close(1008, 'origin not allowed')
      return
    }
    const q = req.query as { token?: string; teamId?: string; deviceKey?: string }

    // Device-agent connection: authenticated by its device API key (from claim).
    // Heartbeat-ONLY — never a snapshot subscriber (one device's key must not be
    // able to enumerate the team's fleet) and may report only its OWN device.
    if (q.deviceKey) {
      void registerDeviceSocket(socket, registry, q.deviceKey)
      return
    }

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
    let offLog: (() => void) | null = null
    let ping: ReturnType<typeof setInterval> | null = null
    let closed = false
    const cleanup = () => {
      if (closed) return
      closed = true
      if (ping) clearInterval(ping)
      off?.()
      offLog?.()
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
      // Backpressure: if a slow subscriber is already ~1MB behind, skip this
      // snapshot rather than growing the outbound buffer unboundedly. The next
      // change delivers fresh state anyway (snapshots are full, not deltas).
      if (socket.bufferedAmount > 1_000_000) return
      socket.send(JSON.stringify({ type: 'snapshot', seq: ++seq, payload: engine.store.snapshot() }))
    }
    send() // initial snapshot for THIS team only
    off = engine.store.onChange(send) // only this team's changes
    // Stream THIS team's command-log entries to this browser over the SAME
    // socket (no second connection). Team-scoped: only this team's logs arrive.
    offLog = registerBrowserLogSocket(auth.teamId, (frame) => {
      if (socket.readyState !== socket.OPEN) return
      if (socket.bufferedAmount > 1_000_000) return
      socket.send(JSON.stringify(frame))
    })
    ping = setInterval(() => {
      if (socket.readyState === socket.OPEN) socket.ping()
    }, 30_000)

    // Heartbeat ingestion on the USER socket. Gated on the connection's role (a
    // viewer can't write); applyHeartbeat is team-scoped, so a device id outside
    // this team's store is rejected. NOTE: this path is for testing/simulation —
    // a teammate with phones.control can report telemetry for any device in the
    // team. Real devices authenticate per-device via /ws?deviceKey=… (see
    // registerDeviceSocket), which can only report their OWN device.
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

/**
 * A device-agent socket, authenticated by its device API key. Unlike a dashboard
 * connection it does NOT subscribe to snapshots (no fleet enumeration) and may
 * heartbeat ONLY the device the key belongs to. Its heartbeats still flow into
 * the team store, which broadcasts the change to every connected dashboard.
 */
async function registerDeviceSocket(socket: WebSocket, registry: EngineRegistry, deviceKey: string) {
  // A device may heartbeat the INSTANT the socket opens — before the async key
  // lookup + engine load below finish and the real handler is attached. Capture
  // those early frames synchronously and replay them once ready, so the first
  // heartbeat is never silently dropped. The buffer is BOUNDED (and frames are
  // dropped once aborted) so an unauthenticated client can't grow heap by
  // flooding frames during the auth window.
  const queued: Buffer[] = []
  let process: ((raw: Buffer) => void) | null = null
  let aborted = false
  socket.on('message', (raw: Buffer) => {
    if (aborted) return
    if (process) process(raw)
    else if (queued.length < MAX_EARLY_FRAMES && raw.length <= MAX_FRAME_BYTES) queued.push(raw)
  })
  // If the socket already closed during the upgrade, don't spend a DB lookup.
  if (socket.readyState !== socket.OPEN) {
    aborted = true
    return
  }

  const dev = await resolveDeviceKey(deviceKey).catch(() => null)
  if (!dev) {
    aborted = true
    queued.length = 0
    socket.close(1008, 'unauthorized')
    return
  }
  let engine
  try {
    engine = await registry.get(dev.teamId)
  } catch {
    aborted = true
    queued.length = 0
    socket.close(1011, 'engine unavailable')
    return
  }

  let ping: ReturnType<typeof setInterval> | null = null
  let unregister: (() => void) | null = null
  // The session row THIS socket opened. Closed by id on disconnect, so an old
  // socket's delayed cleanup can never close a newer reconnect's session.
  let deviceSessionId: string | null = null
  let closed = false
  const cleanup = () => {
    if (closed) return
    closed = true
    aborted = true
    if (ping) clearInterval(ping)
    unregister?.() // drop this socket from the command-push registry
    // Close exactly this connection's session (idempotent: endedAt-null filter +
    // the `closed` guard ⇒ runs once, never overwrites an earlier end, never
    // throws). Covers both the 'close' and 'error'→close paths above.
    if (deviceSessionId) void closeDeviceSession(deviceSessionId, Date.now())
  }
  socket.on('close', cleanup)
  socket.on('error', cleanup)
  if (socket.readyState !== socket.OPEN) {
    cleanup()
    return
  }

  // Authenticated device-agent connection → open ONE session row for this exact
  // socket (guarded so it's created once, never per-message/heartbeat). No agent
  // version is supplied over the deviceKey WS today, so it's persisted as null.
  // A persistence failure is logged + tolerated (session history is non-critical).
  if (!deviceSessionId) {
    deviceSessionId = await openDeviceSession({ teamId: dev.teamId, deviceId: dev.deviceId, agentVersion: null, now: Date.now() })
  }
  // If the socket closed DURING session creation, cleanup already ran with a null
  // id — close the just-created session now and stop setting up this dead socket.
  if (closed) {
    if (deviceSessionId) void closeDeviceSession(deviceSessionId, Date.now())
    return
  }

  // Liveness: a half-open socket (common on flaky mobile networks) fires no
  // 'close' until the OS TCP timeout (minutes), during which it would falsely look
  // live and swallow pushed commands. Ping every 30s and terminate if the prior
  // ping got no pong, so the socket is reaped within one interval (→ cleanup →
  // unregister), and the agent's reconnect evicts any leftover via registerDeviceSender.
  let alive = true
  socket.on('pong', () => {
    alive = true
  })
  ping = setInterval(() => {
    if (socket.readyState !== socket.OPEN) return
    if (!alive) {
      socket.terminate()
      return
    }
    alive = false
    socket.ping()
  }, 30_000)

  // Register this live socket so POST /v1/agent/command can push commands to it
  // instantly (hybrid delivery). Registering EVICTS any prior socket for this
  // device (terminate), so a stale half-open connection can't be pushed to.
  unregister = registerDeviceSender(
    dev.teamId,
    dev.deviceId,
    (frame: unknown) => {
      if (socket.readyState !== socket.OPEN || socket.bufferedAmount >= 1_000_000) return false
      socket.send(JSON.stringify(frame))
      return true
    },
    () => {
      try {
        socket.terminate()
      } catch {
        /* already gone */
      }
    },
  )

  let lastHeartbeatAt = 0
  process = (raw: Buffer) => {
    if (socket.readyState !== socket.OPEN) return
    if (raw.length > MAX_FRAME_BYTES) return
    let msg: unknown
    try {
      msg = JSON.parse(raw.toString('utf8'))
    } catch {
      return
    }
    // A command RESULT: the agent reporting execution of a queued command. Mark
    // the row acked/failed (scoped to this device — own-rows). Idempotent with the
    // HTTP ack path, so receiving both is harmless.
    if ((msg as { type?: string } | null)?.type === 'command_result') {
      // Throttle result frames so a buggy/compromised key can't flood the DB with
      // ack writes. Shares the per-device budget with the HTTP ack endpoint.
      if (!rateLimit(`cmdack:${dev.deviceId}`, 240, 60_000)) return
      // Validate the result frame; malformed → ignore (existing quiet behavior).
      const parsed = commandResultFrameSchema.safeParse(msg)
      if (!parsed.success) return
      // Use the AUTHENTICATED dev.{teamId,deviceId} (own-rows) — never the frame's
      // deviceId. Persist the result + broadcast a completion command_log to the
      // team, but only on a NEW terminal transition (acknowledgeCommandResult
      // dedups retried acks). A failure here never crashes the socket.
      const { type: _frameType, commandId, deviceId: _frameDevice, ...result } = parsed.data
      void acknowledgeCommandResult({ teamId: dev.teamId, deviceId: dev.deviceId, commandId, result, now: Date.now() })
        .catch((err) =>
          console.error(JSON.stringify({ event: 'command.ack.error', teamId: dev.teamId, deviceId: dev.deviceId, commandId, error: err instanceof Error ? err.message : 'error' })),
        )
      return
    }
    const parsed = heartbeatFrameSchema.safeParse(msg)
    if (!parsed.success) return
    const frame = parsed.data
    const now = Date.now()
    if (now - lastHeartbeatAt < HEARTBEAT_MIN_INTERVAL_MS) return
    lastHeartbeatAt = now
    // A device key may report ONLY its own device — never another team's or
    // another device in the same team.
    if (frame.deviceId !== dev.deviceId) {
      socket.send(JSON.stringify({ type: 'error', deviceId: frame.deviceId, error: 'forbidden device' }))
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
  }
  // Replay anything that arrived during the async setup, then go live. (process
  // itself re-checks liveness, size, and the flood guard for each frame.)
  if (socket.readyState === socket.OPEN) for (const raw of queued) process(raw)
  queued.length = 0
}

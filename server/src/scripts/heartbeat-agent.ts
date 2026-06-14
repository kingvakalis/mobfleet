/**
 * Standalone device-agent simulator — exercises the real inbound heartbeat path
 * end-to-end. Connects to the live WS feed as an authenticated client and emits
 * {type:'heartbeat', deviceId, status, battery, cpuUsage, memoryUsage} every
 * HEARTBEAT_INTERVAL_MS, exactly as a real on-device agent would.
 *
 * Usage (local dev, with AUTH_PROVIDER=dev + ALLOW_INSECURE_DEV_AUTH=1):
 *   npm run agent                       # auto-targets the first device it sees
 *   DEVICE_ID=ios-xxxx npm run agent    # target a specific device
 *   STOP_AFTER=3 npm run agent          # send 3 beats then go quiet (watch the
 *                                       # server's >30s staleness sweep flip it
 *                                       # offline and broadcast)
 *
 * In a Supabase-auth deployment, pass a real access token:
 *   TOKEN=<supabase-jwt> WS_URL=wss://api.example.com/ws npm run agent
 */
import WebSocket from 'ws'
import { HEARTBEAT_INTERVAL_MS } from '../../../src/shared/heartbeat'
import type { Device, DeviceStatus } from '../../../src/shared/types'

const WS_URL = process.env.WS_URL ?? 'ws://localhost:8787/ws'
const TEAM_ID = process.env.TEAM_ID ?? ''
const DEVICE_ID = process.env.DEVICE_ID ?? ''
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? HEARTBEAT_INTERVAL_MS)
const STOP_AFTER = Number(process.env.STOP_AFTER ?? 0) // 0 = never stop

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')

/** Mint a signature-less dev JWT — accepted ONLY when the server runs
 *  AUTH_PROVIDER=dev (decode-only). For prod, pass a real TOKEN instead. */
function devToken(): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const payload = {
    sub: 'heartbeat-agent',
    email: 'agent@local.test',
    email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 3600,
  }
  return `${b64url(header)}.${b64url(payload)}.` // empty signature segment
}

const token = process.env.TOKEN ?? devToken()

function url(): string {
  const params = new URLSearchParams({ token })
  if (TEAM_ID) params.set('teamId', TEAM_ID)
  return `${WS_URL}?${params.toString()}`
}

const STATUS_CYCLE: DeviceStatus[] = ['online', 'online', 'busy', 'online', 'warming']
let beat = 0
let targetId = DEVICE_ID
let battery = 92
let timer: ReturnType<typeof setInterval> | null = null
let lastSeenStatus: string | null = null

function nextHeartbeat() {
  const status = STATUS_CYCLE[beat % STATUS_CYCLE.length]
  battery = Math.max(5, battery - (Math.random() < 0.3 ? 1 : 0))
  const cpu = status === 'busy' ? 55 + Math.random() * 40 : 8 + Math.random() * 32
  return {
    type: 'heartbeat' as const,
    deviceId: targetId,
    status,
    battery,
    cpuUsage: +cpu.toFixed(1),
    memoryUsage: +(30 + Math.random() * 45).toFixed(1),
  }
}

function connect() {
  console.log(`[agent] connecting → ${WS_URL}${TEAM_ID ? ` (team ${TEAM_ID})` : ''}`)
  const ws = new WebSocket(url())

  ws.on('open', () => console.log('[agent] connected; waiting for the fleet snapshot…'))

  ws.on('message', (raw) => {
    let msg: { type?: string; payload?: { devices?: Device[] }; deviceId?: string; error?: string }
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (msg.type === 'snapshot') {
      // Auto-pick a device to impersonate on the first snapshot.
      if (!targetId) {
        const first = msg.payload?.devices?.[0]
        if (!first) {
          console.log('[agent] team has no devices to heartbeat — exiting.')
          ws.close()
          return
        }
        targetId = first.id
        console.log(`[agent] targeting device ${targetId}`)
      }
      // Observe the target's broadcast status — proves the server applied our
      // heartbeat and, after we go silent, that the >30s sweep flips it offline.
      const target = msg.payload?.devices?.find((d) => d.id === targetId)
      if (target && target.status !== lastSeenStatus) {
        console.log(`[agent] ← broadcast: ${targetId} status=${target.status} (was ${lastSeenStatus ?? 'unknown'})`)
        lastSeenStatus = target.status
      }
      if (!timer) startBeating(ws)
    } else if (msg.type === 'ack') {
      console.log(`[agent] ✓ ack ${msg.deviceId}`)
    } else if (msg.type === 'error') {
      console.log(`[agent] ✗ error ${msg.deviceId ?? ''}: ${msg.error}`)
    }
  })

  ws.on('close', () => {
    console.log('[agent] disconnected; reconnecting in 1s…')
    if (timer) { clearInterval(timer); timer = null }
    setTimeout(connect, 1000)
  })
  ws.on('error', (e) => console.log(`[agent] socket error: ${e.message}`))
}

function startBeating(ws: WebSocket) {
  const sendOne = () => {
    if (ws.readyState !== ws.OPEN) return
    if (STOP_AFTER && beat >= STOP_AFTER) {
      if (timer) { clearInterval(timer); timer = null }
      console.log(`[agent] sent ${beat} heartbeats; going silent (watch it go offline in ~30s).`)
      return
    }
    const hb = nextHeartbeat()
    ws.send(JSON.stringify(hb))
    beat++
    console.log(`[agent] → heartbeat #${beat} ${hb.deviceId} status=${hb.status} batt=${hb.battery}% cpu=${hb.cpuUsage}% mem=${hb.memoryUsage}%`)
  }
  sendOne() // fire immediately, then on the interval
  timer = setInterval(sendOne, INTERVAL_MS)
}

connect()

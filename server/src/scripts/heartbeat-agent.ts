/**
 * Standalone device-agent simulator — exercises the real provisioning +
 * heartbeat paths end-to-end, exactly as an on-device agent would.
 *
 * Three modes, in priority order:
 *   1. PAIRING_TOKEN — claim it (POST /v1/devices/claim) to obtain a deviceId +
 *      device API key, then heartbeat over /ws?deviceKey=… (the full flow).
 *   2. DEVICE_KEY (+ DEVICE_ID) — connect directly with an existing device key.
 *   3. TOKEN / dev fallback — connect with a user JWT, auto-target the first
 *      device in the snapshot (handy for quick local testing).
 *
 * Examples (local dev, AUTH_PROVIDER=dev + ALLOW_INSECURE_DEV_AUTH=1):
 *   PAIRING_TOKEN=<uuid> npm run agent        # pair, then heartbeat as the device
 *   PAIRING_TOKEN=<uuid> STOP_AFTER=1 npm run agent   # 1 beat → watch it go offline
 *   npm run agent                              # dev-JWT fallback, auto-target
 *
 * Production: PAIRING_TOKEN=<uuid> SERVER_URL=https://api… WS_URL=wss://api…/ws
 */
import WebSocket from 'ws'
import { randomBytes } from 'node:crypto'
import { HEARTBEAT_INTERVAL_MS } from '../../../src/shared/heartbeat'
import type { Device, DeviceStatus } from '../../../src/shared/types'

const WS_URL = process.env.WS_URL ?? 'ws://localhost:8787/ws'
const SERVER_URL = process.env.SERVER_URL ?? WS_URL.replace(/^ws/, 'http').replace(/\/ws$/, '')
const TEAM_ID = process.env.TEAM_ID ?? ''
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? HEARTBEAT_INTERVAL_MS)
const STOP_AFTER = Number(process.env.STOP_AFTER ?? 0) // 0 = never stop
const PAIRING_TOKEN = process.env.PAIRING_TOKEN ?? ''
const UDID = process.env.UDID ?? `udid-${randomBytes(8).toString('hex')}`
const NAME = process.env.NAME ?? 'Agent Device'

let deviceKey = process.env.DEVICE_KEY ?? ''
let targetId = process.env.DEVICE_ID ?? ''
let token = process.env.TOKEN ?? ''

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')

/** Signature-less dev JWT — accepted ONLY when the server runs AUTH_PROVIDER=dev. */
function devToken(): string {
  const payload = { sub: 'heartbeat-agent', email: 'agent@local.test', email_verified: true, exp: Math.floor(Date.now() / 1000) + 3600 }
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.`
}

/** Exchange a pairing token for a real device + API key. */
async function claimDevice(pairingToken: string): Promise<{ deviceId: string; apiKey: string }> {
  const res = await fetch(`${SERVER_URL}/v1/devices/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairingToken, udid: UDID, name: NAME, platform: 'ios', osVersion: 'iOS 18.2' }),
  })
  const body = (await res.json().catch(() => ({}))) as { deviceId?: string; apiKey?: string; error?: string }
  if (!res.ok || !body.deviceId || !body.apiKey) throw new Error(body.error ?? `claim failed (HTTP ${res.status})`)
  return { deviceId: body.deviceId, apiKey: body.apiKey }
}

function url(): string {
  const p = new URLSearchParams()
  if (deviceKey) p.set('deviceKey', deviceKey)
  else {
    p.set('token', token)
    if (TEAM_ID) p.set('teamId', TEAM_ID)
  }
  return `${WS_URL}?${p.toString()}`
}

const STATUS_CYCLE: DeviceStatus[] = ['online', 'online', 'busy', 'online', 'warming']
let beat = 0
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

function startBeating(ws: WebSocket) {
  if (timer) return
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
  sendOne()
  timer = setInterval(sendOne, INTERVAL_MS)
}

function connect() {
  const mode = deviceKey ? 'device-key' : 'user-token'
  console.log(`[agent] connecting (${mode}) → ${WS_URL}${TEAM_ID ? ` (team ${TEAM_ID})` : ''}`)
  const ws = new WebSocket(url())

  ws.on('open', () => {
    console.log('[agent] connected')
    if (deviceKey) {
      // Device-key connections receive no snapshot → start heartbeating now.
      if (!targetId) {
        console.log('[agent] no DEVICE_ID / claimed device to target — exiting.')
        ws.close()
        return
      }
      startBeating(ws)
    } else {
      console.log('[agent] waiting for the fleet snapshot…')
    }
  })

  ws.on('message', (raw) => {
    let msg: { type?: string; payload?: { devices?: Device[] }; deviceId?: string; error?: string }
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (msg.type === 'snapshot') {
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
      const target = msg.payload?.devices?.find((d) => d.id === targetId)
      if (target && target.status !== lastSeenStatus) {
        console.log(`[agent] ← broadcast: ${targetId} status=${target.status} (was ${lastSeenStatus ?? 'unknown'})`)
        lastSeenStatus = target.status
      }
      startBeating(ws)
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

async function main() {
  if (PAIRING_TOKEN) {
    console.log(`[agent] claiming pairing token → ${SERVER_URL}/v1/devices/claim`)
    const claimed = await claimDevice(PAIRING_TOKEN)
    deviceKey = claimed.apiKey
    targetId = claimed.deviceId
    console.log(`[agent] ✓ claimed device ${targetId}; received API key (${deviceKey.slice(0, 8)}…)`)
  }
  if (!deviceKey && !token) token = devToken()
  connect()
}

void main().catch((e) => {
  console.error(`[agent] fatal: ${e instanceof Error ? e.message : e}`)
  process.exit(1)
})

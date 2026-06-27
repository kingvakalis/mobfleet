/**
 * Mac-Mini hardware-agent entrypoint — the production device daemon.
 *
 * It discovers USB iPhones, brings up WDA per device, heartbeats, and executes
 * queued commands against the real hardware. Three adapter modes:
 *
 *   REAL (default on macOS):   MacosDeviceControlAdapter — libimobiledevice + WDA (direct).
 *   APPIUM (--appium /         AppiumDeviceControlAdapter — libimobiledevice for USB
 *   AGENT_ADAPTER=appium):     discovery + an Appium (XCUITest) server for gestures.
 *                              Env: APPIUM_URL, APPIUM_BUNDLE_MAP (JSON name→bundleId),
 *                              APPIUM_EXTRA_CAPS (JSON).
 *   SIMULATED (--simulate or   SimulatedDeviceControlAdapter — no hardware; used
 *   non-darwin):               for local/dev/CI smoke runs. A SIM_DEVICES env list
 *                              of UDIDs is attached at boot.
 *
 * Device → credential mapping (which API key drives which physical UDID):
 *   AGENT_DEVICES='<udid>=<deviceId>:<deviceKey>,<udid2>=…'  (explicit, multi-device)
 * For a single device you may instead set UDID + DEVICE_ID + DEVICE_KEY.
 *
 * Env:
 *   SERVER_URL (https://api…)  WS_URL (wss://api…/ws)
 *   AGENT_DEVICES | (UDID, DEVICE_ID, DEVICE_KEY)
 *   SIM_DEVICES (sim mode, comma-separated UDIDs)   --simulate flag
 *
 * NOTE: no real hardware is asserted here — on a non-Mac host without --simulate
 * the agent refuses to start the real adapter with a clear message.
 */
import { AgentRuntime, type AgentTransport } from '../agent/agent-runtime'
import { MjpegPublisher } from '../agent/mjpeg-publisher'
import { SimulatedDeviceControlAdapter } from '../agent/simulated-device-adapter'
import { HttpWsAgentTransport } from '../agent/agent-transport'
import { SupabaseAgentTransport } from '../agent/supabase-agent-transport'
import type { DeviceControlAdapter } from '../agent/device-adapter'
import { AGENT_VERSION, type DeviceIdentity } from '../agent/types'

const SIMULATE = process.argv.includes('--simulate') || process.env.AGENT_SIMULATE === '1'
const APPIUM = process.argv.includes('--appium') || process.env.AGENT_ADAPTER === 'appium'
const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:8787'
const WS_URL = process.env.WS_URL ?? SERVER_URL.replace(/^http/, 'ws') + '/ws'

// Control-plane transport: 'railway' (default, Fastify backend / me-mode) or 'supabase'
// (supabase-mode — talks ONLY to Supabase RPCs with the anon key + per-device key).
const argValue = (flag: string): string | undefined => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : undefined }
const TRANSPORT = argValue('--transport') ?? process.env.AGENT_TRANSPORT ?? 'railway'
const SUPABASE_TRANSPORT = TRANSPORT === 'supabase'
const SUPABASE_URL = process.env.SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? ''

const log = (event: string, fields?: Record<string, unknown>) =>
  console.log(JSON.stringify({ ts: Date.now(), event, ...fields }))

/** Parse AGENT_DEVICES='<udid>=<deviceId>:<deviceKey>,…' into a lookup. */
function parseDeviceMap(): Map<string, { deviceId: string; deviceKey: string }> {
  const map = new Map<string, { deviceId: string; deviceKey: string }>()
  const raw = process.env.AGENT_DEVICES ?? ''
  for (const entry of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [udid, rest] = entry.split('=')
    const [deviceId, deviceKey] = (rest ?? '').split(':')
    if (udid && deviceId && deviceKey) map.set(udid, { deviceId, deviceKey })
  }
  // Single-device convenience.
  if (process.env.UDID && process.env.DEVICE_ID && process.env.DEVICE_KEY) {
    map.set(process.env.UDID, { deviceId: process.env.DEVICE_ID, deviceKey: process.env.DEVICE_KEY })
  }
  return map
}

/** Parse a JSON object from an env var; undefined on missing/invalid (logs a warning). */
function parseJsonEnv(name: string): Record<string, unknown> | undefined {
  const raw = process.env[name]
  if (!raw) return undefined
  try {
    const v: unknown = JSON.parse(raw)
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  } catch { /* fall through */ }
  console.error(`[device-agent] ${name} is not a valid JSON object — ignoring`)
  return undefined
}

async function main(): Promise<void> {
  const deviceMap = parseDeviceMap()

  if (SUPABASE_TRANSPORT) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.error('[device-agent] --transport supabase requires SUPABASE_URL + SUPABASE_ANON_KEY')
      process.exit(2)
    }
    // Optional single-device self-pairing: redeem a pairing token (minted in the dashboard)
    // → per-device creds for this UDID. Multi-device: pre-claim and pass AGENT_DEVICES.
    if (process.env.PAIRING_TOKEN && process.env.UDID && !deviceMap.has(process.env.UDID)) {
      try {
        const claimed = await SupabaseAgentTransport.claimDevice({
          supabaseUrl: SUPABASE_URL, supabaseAnonKey: SUPABASE_ANON_KEY,
          pairingToken: process.env.PAIRING_TOKEN, udid: process.env.UDID, name: process.env.DEVICE_NAME,
        })
        deviceMap.set(process.env.UDID, { deviceId: claimed.deviceId, deviceKey: claimed.deviceKey })
        log('agent.paired', { udid: process.env.UDID, deviceId: claimed.deviceId })
      } catch (e) {
        console.error(`[device-agent] pairing failed: ${e instanceof Error ? e.message : e}`)
        process.exit(2)
      }
    }
  }

  let adapter: DeviceControlAdapter
  if (SIMULATE) {
    const sim = new SimulatedDeviceControlAdapter()
    for (const udid of (process.env.SIM_DEVICES ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
      const id: DeviceIdentity = { udid, name: `Sim ${udid.slice(-4)}`, model: 'iPhone 15', osVersion: 'iOS 18.2', platform: 'ios' }
      sim.attach(id)
    }
    adapter = sim
    log('agent.mode', { mode: 'simulated', simDevices: process.env.SIM_DEVICES ?? '' })
  } else {
    if (process.platform !== 'darwin') {
      console.error('[device-agent] real mode requires macOS. Run with --simulate on this host, or use a Mac Mini.')
      process.exit(2)
    }
    // Lazy import so a non-mac host never even loads the OS-bound modules.
    if (APPIUM) {
      const { AppiumDeviceControlAdapter } = await import('../agent/appium-device-adapter')
      adapter = new AppiumDeviceControlAdapter({
        appiumUrl: process.env.APPIUM_URL,
        bundleMap: parseJsonEnv('APPIUM_BUNDLE_MAP') as Record<string, string> | undefined,
        extraCaps: parseJsonEnv('APPIUM_EXTRA_CAPS'),
      })
      log('agent.mode', { mode: 'appium', appiumUrl: process.env.APPIUM_URL ?? 'http://127.0.0.1:4723' })
    } else {
      const { MacosDeviceControlAdapter } = await import('../agent/macos-device-adapter')
      adapter = new MacosDeviceControlAdapter()
      log('agent.mode', { mode: 'macos' })
    }
  }

  // One transport per provisioned device (created lazily as devices are discovered).
  const transports = new Map<string, AgentTransport>()
  const transportFor = (identity: DeviceIdentity): AgentTransport | null => {
    const creds = deviceMap.get(identity.udid)
    if (!creds) return null
    let t = transports.get(identity.udid)
    if (!t) {
      t = SUPABASE_TRANSPORT
        ? new SupabaseAgentTransport({ supabaseUrl: SUPABASE_URL, supabaseAnonKey: SUPABASE_ANON_KEY, deviceId: creds.deviceId, deviceKey: creds.deviceKey, agentVersion: AGENT_VERSION, log })
        : new HttpWsAgentTransport({ serverUrl: SERVER_URL, wsUrl: WS_URL, deviceId: creds.deviceId, deviceKey: creds.deviceKey, log })
      transports.set(identity.udid, t)
    }
    return t
  }

  // Optional interval overrides (ops tuning / fast deterministic tests). Unset → runtime defaults.
  const intervalMs = (name: string): number | undefined => {
    const v = Number(process.env[name])
    return Number.isFinite(v) && v > 0 ? v : undefined
  }
  // STAGE 2A — per-device MJPEG publisher (env-gated, supabase-mode + real device only). Reads WDA's
  // LOCAL http://127.0.0.1:<port> MJPEG and pushes frames OUTBOUND to the relay using this device's key.
  // PFA_MJPEG=1 to enable; PFA_MJPEG_RELAY_URL=wss://<relay>/publish; PFA_MJPEG_PORT (default 9100) or a
  // per-device PFA_MJPEG_PORTS={"<udid>":9100} map (multi-device). Off → null → screenshot path unchanged.
  const MJPEG_ENABLED = (process.env.PFA_MJPEG === '1' || process.env.PFA_MJPEG === 'true') && SUPABASE_TRANSPORT && !SIMULATE
  const MJPEG_RELAY_URL = process.env.PFA_MJPEG_RELAY_URL ?? ''
  const MJPEG_PORT = Number(process.env.PFA_MJPEG_PORT) || 9100
  const MJPEG_PORTS = parseJsonEnv('PFA_MJPEG_PORTS') as Record<string, number> | undefined
  const portFor = (udid: string): number => (MJPEG_PORTS && typeof MJPEG_PORTS[udid] === 'number' ? MJPEG_PORTS[udid] : MJPEG_PORT)
  const createMjpegPublisher = MJPEG_ENABLED && MJPEG_RELAY_URL
    ? (udid: string) => {
        const creds = deviceMap.get(udid)
        if (!creds) return null
        return new MjpegPublisher(
          { udid, deviceKey: creds.deviceKey, relayUrl: MJPEG_RELAY_URL, mjpegUrl: `http://127.0.0.1:${portFor(udid)}` },
          { log },
        )
      }
    : undefined
  if (MJPEG_ENABLED && !MJPEG_RELAY_URL) log('agent.mjpeg.misconfigured', { reason: 'PFA_MJPEG=1 but PFA_MJPEG_RELAY_URL unset' })

  const runtime = new AgentRuntime({
    adapter, transportFor, log, createMjpegPublisher,
    discoveryIntervalMs: intervalMs('DISCOVERY_INTERVAL_MS'),
    heartbeatIntervalMs: intervalMs('HEARTBEAT_INTERVAL_MS'),
    wdaCheckIntervalMs: intervalMs('WDA_CHECK_INTERVAL_MS'),
    // Command pickup cadence (supabase-mode). Unset → 1000ms default (sane; does not hammer
    // Supabase). NO autonomous agent capture loop — live frames are client-driven (GO LIVE enqueues
    // screenshot commands). Frame compression: FRAME_WIDTH / FRAME_QUALITY / FRAME_FORMAT.
    commandPollIntervalMs: intervalMs('COMMAND_POLL_INTERVAL_MS'),
  })
  const stop = runtime.start()
  log('agent.boot', { version: runtime.version, transport: TRANSPORT, devices: deviceMap.size })

  // Keep the daemon's event loop alive until a signal stops us. The runtime's own
  // timers are .unref()'d (so they never hang a test process), and the supabase
  // transport is HTTP-poll-only with no persistent socket — unlike me-mode's
  // WebSocket, which is what otherwise holds the loop open. Without this ref'd
  // handle a `--transport supabase` agent would exit 0 right after boot, before
  // it ever heartbeats or polls. Unconditional: redundant-but-harmless in me-mode.
  const keepAlive = setInterval(() => {}, 1 << 30)

  const shutdown = async () => {
    log('agent.shutdown')
    clearInterval(keepAlive)
    await stop()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

void main().catch((e) => {
  console.error(`[device-agent] fatal: ${e instanceof Error ? e.message : e}`)
  process.exit(1)
})

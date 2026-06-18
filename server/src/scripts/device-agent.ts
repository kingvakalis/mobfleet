/**
 * Mac-Mini hardware-agent entrypoint — the production device daemon.
 *
 * It discovers USB iPhones, brings up WDA per device, heartbeats, and executes
 * queued commands against the real hardware. Two adapter modes:
 *
 *   REAL (default on macOS):   MacosDeviceControlAdapter — libimobiledevice + WDA.
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
import { SimulatedDeviceControlAdapter } from '../agent/simulated-device-adapter'
import { HttpWsAgentTransport } from '../agent/agent-transport'
import type { DeviceControlAdapter } from '../agent/device-adapter'
import type { DeviceIdentity } from '../agent/types'

const SIMULATE = process.argv.includes('--simulate') || process.env.AGENT_SIMULATE === '1'
const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:8787'
const WS_URL = process.env.WS_URL ?? SERVER_URL.replace(/^http/, 'ws') + '/ws'

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

async function main(): Promise<void> {
  const deviceMap = parseDeviceMap()

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
    // Lazy import so a non-mac host never even loads the OS-bound module.
    const { MacosDeviceControlAdapter } = await import('../agent/macos-device-adapter')
    adapter = new MacosDeviceControlAdapter()
    log('agent.mode', { mode: 'macos' })
  }

  // One transport per provisioned device (created lazily as devices are discovered).
  const transports = new Map<string, AgentTransport>()
  const transportFor = (identity: DeviceIdentity): AgentTransport | null => {
    const creds = deviceMap.get(identity.udid)
    if (!creds) return null
    let t = transports.get(identity.udid)
    if (!t) {
      t = new HttpWsAgentTransport({ serverUrl: SERVER_URL, wsUrl: WS_URL, deviceId: creds.deviceId, deviceKey: creds.deviceKey, log })
      transports.set(identity.udid, t)
    }
    return t
  }

  const runtime = new AgentRuntime({ adapter, transportFor, log })
  const stop = runtime.start()
  log('agent.boot', { version: runtime.version, serverUrl: SERVER_URL, devices: deviceMap.size })

  const shutdown = async () => {
    log('agent.shutdown')
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

/**
 * REAL macOS implementation of DeviceControlAdapter. Shells out to the standard
 * open-source iOS toolchain over USB and drives the device through WebDriverAgent
 * (WDA) HTTP. This is the ONLY file that touches OS processes / the network /
 * real hardware — it is deliberately segregated from every testable path.
 *
 * GUARD: the constructor throws on any non-darwin platform, and every method is
 * a thin wrapper over `execFile` + WDA HTTP. No test imports/executes this; the
 * unit tests use SimulatedDeviceControlAdapter. On a real Mac Mini you select it
 * with `device-agent` (no --simulate) once the toolchain is installed.
 *
 * Required host tooling (installed separately on the Mac Mini — see the physical
 * checklist in the report):
 *   - libimobiledevice:  idevice_id, ideviceinfo, idevicediagnostics
 *   - WebDriverAgent built + runnable via xcodebuild (per-device, on its port)
 *   - (optional) ios-deploy / cfgutil for installs
 *
 * WDA endpoints used: POST /session, /wda/tap, /wda/dragfromtoforduration,
 * /wda/keys, /wda/homescreen, GET /status. Coordinates are forwarded as-is from
 * the validated command payload.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { DeviceControlAdapter, AdapterCommand, AdapterExecOutcome } from './device-adapter'
import type { DeviceIdentity, DeviceTelemetry } from './types'

const run = promisify(execFile)

/** Map an ideviceinfo ProductVersion to the "iOS x.y" display format. */
function formatOsVersion(productVersion: string): string {
  const v = productVersion.trim()
  return v ? `iOS ${v}` : ''
}

export class MacosDeviceControlAdapter implements DeviceControlAdapter {
  readonly isReal = true
  /** WDA base URL builder for a UDID — populated as devices come up. */
  private readonly wdaPort = new Map<string, number>()

  constructor() {
    if (process.platform !== 'darwin') {
      throw new Error('MacosDeviceControlAdapter requires macOS (darwin); use SimulatedDeviceControlAdapter elsewhere')
    }
  }

  async listAttachedUdids(): Promise<string[]> {
    // `idevice_id -l` prints one UDID per line for each USB-attached device.
    const { stdout } = await run('idevice_id', ['-l'])
    return stdout.split('\n').map((s) => s.trim()).filter(Boolean)
  }

  async getIdentity(udid: string): Promise<DeviceIdentity> {
    const info = async (key: string) => {
      try {
        const { stdout } = await run('ideviceinfo', ['-u', udid, '-k', key])
        return stdout.trim()
      } catch {
        return ''
      }
    }
    const [name, productType, productVersion] = await Promise.all([
      info('DeviceName'),
      info('ProductType'),
      info('ProductVersion'),
    ])
    return {
      udid,
      name: name || `iPhone ${udid.slice(-4)}`,
      model: productType || 'iPhone',
      osVersion: formatOsVersion(productVersion),
      platform: 'ios',
    }
  }

  async getTelemetry(udid: string): Promise<DeviceTelemetry> {
    const batteryRaw = await this.info(udid, 'com.apple.mobile.battery', 'BatteryCurrentCapacity').catch(() => '')
    const battery = batteryRaw ? Number(batteryRaw) : null
    // CPU/mem aren't exposed over USB without an on-device helper; report null
    // rather than fabricating values (the dashboard shows them as unknown).
    return {
      battery: battery !== null && Number.isFinite(battery) ? battery : null,
      cpuUsage: null,
      memoryUsage: null,
    }
  }

  private async info(udid: string, domain: string, key: string): Promise<string> {
    const { stdout } = await run('ideviceinfo', ['-u', udid, '-q', domain, '-k', key])
    return stdout.trim()
  }

  async startWda(udid: string, port: number): Promise<void> {
    this.wdaPort.set(udid, port)
    // Bringing up WDA via xcodebuild is environment-specific (signing, scheme,
    // derived data) and is owned by the host's launchd/scripts on the Mac Mini.
    // Here we VERIFY it answers on the assigned port and fail clearly if not, so
    // the operator wires WDA startup once at the host level and the agent manages
    // health from then on. (A future revision may spawn xcodebuild directly.)
    const healthy = await this.isWdaHealthy(udid)
    if (!healthy) {
      throw new Error(`WDA not reachable on port ${port} for ${udid}; ensure WebDriverAgent is running for this device`)
    }
  }

  async isWdaHealthy(udid: string): Promise<boolean> {
    const port = this.wdaPort.get(udid)
    if (!port) return false
    try {
      const res = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(3000) })
      if (!res.ok) return false
      const body = (await res.json()) as { value?: { ready?: boolean } }
      return body?.value?.ready !== false
    } catch {
      return false
    }
  }

  async stopWda(udid: string): Promise<void> {
    this.wdaPort.delete(udid)
    // Host launchd/scripts own the WDA process lifecycle; nothing to kill here.
  }

  async execute(udid: string, command: AdapterCommand): Promise<AdapterExecOutcome> {
    const port = this.wdaPort.get(udid)
    if (!port) throw new Error(`no WDA port for ${udid}`)
    const base = `http://127.0.0.1:${port}`

    switch (command.kind) {
      case 'reboot':
        await run('idevicediagnostics', ['-u', udid, 'restart'])
        return {}
      case 'screenshot': {
        const res = await this.wda(base, 'GET', '/screenshot')
        const value = (res as { value?: unknown })?.value
        // value is base64 PNG; return only a length marker, never raw bytes in logs.
        return { result: { screenshot: typeof value === 'string' ? `b64:${value.length}` : 'captured' } }
      }
      case 'tap':
        await this.wda(base, 'POST', '/wda/tap/0', { x: command.x, y: command.y })
        return {}
      case 'swipe': {
        const { fromX, fromY, toX, toY } = swipeVector(command.dir)
        await this.wda(base, 'POST', '/wda/dragfromtoforduration', { fromX, fromY, toX, toY, duration: 0.3 })
        return {}
      }
      case 'type':
        await this.wda(base, 'POST', '/wda/keys', { value: [...command.text] })
        return {}
      case 'home':
      case 'switcher':
        await this.wda(base, 'POST', '/wda/homescreen')
        return {}
      case 'back':
        // No universal hardware "back" on iOS; emulate an edge swipe-right.
        await this.wda(base, 'POST', '/wda/dragfromtoforduration', { fromX: 2, fromY: 400, toX: 250, toY: 400, duration: 0.2 })
        return {}
      case 'lock':
        await this.wda(base, 'POST', '/wda/lock')
        return {}
      case 'unlock':
        await this.wda(base, 'POST', '/wda/unlock')
        return {}
      case 'launch':
        // Launching by app name requires a name→bundleId map maintained on the
        // host; without it, surface a clear, non-retryable error.
        throw Object.assign(new Error(`launch requires a bundleId mapping for "${command.appName}"`), { code: 'LAUNCH_UNMAPPED' })
      case 'install':
        throw Object.assign(new Error('install not supported by this adapter build'), { code: 'INSTALL_UNSUPPORTED' })
    }
  }

  private async wda(base: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      throw Object.assign(new Error(`WDA ${method} ${path} → HTTP ${res.status}`), { code: 'WDA_HTTP_ERROR' })
    }
    return res.json().catch(() => ({}))
  }
}

/** A coarse swipe vector in device points for each direction (mid-screen). */
function swipeVector(dir: 'up' | 'down' | 'left' | 'right') {
  switch (dir) {
    case 'up': return { fromX: 200, fromY: 600, toX: 200, toY: 200 }
    case 'down': return { fromX: 200, fromY: 200, toX: 200, toY: 600 }
    case 'left': return { fromX: 600, fromY: 400, toX: 100, toY: 400 }
    case 'right': return { fromX: 100, fromY: 400, toX: 600, toY: 400 }
  }
}

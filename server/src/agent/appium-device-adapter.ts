/**
 * Appium implementation of DeviceControlAdapter. Keeps the operator's existing
 * **Appium + WebDriverAgent (XCUITest)** stack: USB discovery / identity / telemetry /
 * reboot go through libimobiledevice (exactly like MacosDeviceControlAdapter), and all
 * gestures are driven through an Appium server over the W3C WebDriver protocol +
 * XCUITest `mobile:` scripts. Appium owns the WDA session (it boots/wraps WDA), so
 * `startWda` here = create/confirm an Appium session pinned to the agent-allocated
 * WDA port (`appium:wdaLocalPort`), and `stopWda` = delete that session.
 *
 * GUARD: like the macOS adapter, the constructor requires darwin (it shells to
 * libimobiledevice over USB). The pure `toAppiumAction()` mapping is exported and
 * unit-tested on any platform without an Appium server or a device.
 *
 * Required host tooling (Mac that has the USB iPhones):
 *   - libimobiledevice: idevice_id, ideviceinfo, idevicediagnostics
 *   - Appium server (XCUITest driver) reachable at APPIUM_URL (default 127.0.0.1:4723)
 *   - WebDriverAgent built/signed (ABM-supervised install recommended at fleet scale)
 *
 * Config (env, read by the device-agent entrypoint; nothing is written here):
 *   APPIUM_URL          base URL of the Appium server (default http://127.0.0.1:4723)
 *   APPIUM_BUNDLE_MAP   JSON { "<appName>": "<bundleId>" } for `launch`
 *   APPIUM_EXTRA_CAPS   JSON of extra Appium capabilities merged into the session
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { DeviceControlAdapter, AdapterCommand, AdapterExecOutcome, AppInstallState } from './device-adapter'
import type { DeviceIdentity, DeviceTelemetry } from './types'

const run = promisify(execFile)

/**
 * Build the screenshot AdapterExecOutcome from a raw WDA `/screenshot` value (a
 * base64 PNG string) and an optional `/window/rect` (device LOGICAL size, points).
 * PURE + exported for unit testing — no network, no session.
 *
 * The base64 is carried in `result.screenshot.base64` so the agent runtime can hand
 * it to the (supabase) transport's frame-upload path. `width`/`height` are the device
 * logical size, which the dashboard uses to map a tap on the displayed frame back to
 * device coordinates. A non-string value (WDA returned something unexpected) degrades
 * to a benign non-bytes marker so nothing fabricates a frame.
 */
export function screenshotOutcome(value: unknown, rect?: { width?: unknown; height?: unknown } | null): AdapterExecOutcome {
  if (typeof value !== 'string' || value.length === 0) return { result: { screenshot: 'captured' } }
  const pos = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : null)
  return { result: { screenshot: { base64: value, format: 'png', width: pos(rect?.width), height: pos(rect?.height) } } }
}

export interface AppiumAdapterOptions {
  /** Appium server base URL (default http://127.0.0.1:4723). */
  appiumUrl?: string
  /** appName → bundleId map for the `launch` command. */
  bundleMap?: Record<string, string>
  /** Extra Appium capabilities merged into `alwaysMatch` (e.g. team-specific timeouts). */
  extraCaps?: Record<string, unknown>
}

/** The Appium-side action a command maps to. PURE + exported for unit testing —
 *  no network, no session id, no device. The adapter performs the HTTP/shell. */
export type AppiumAction =
  | { via: 'execute'; script: string; args: unknown[] } // an XCUITest `mobile:` script
  | { via: 'screenshot' }
  | { via: 'type'; text: string }
  | { via: 'reboot' }

/** Resolve an app name to a bundle id: explicit map first, else accept a value that
 *  is already a reverse-DNS bundle id (e.g. com.burbn.instagram); else null. */
export function resolveBundleId(appName: string, bundleMap: Record<string, string> = {}): string | null {
  if (bundleMap[appName]) return bundleMap[appName]
  const v = appName.trim()
  if (!v || v.includes(' ')) return null
  return /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(v) ? v : null
}

/** Map an adapter command to its Appium action. Throws (with a `.code`) for the
 *  cases Appium/WDA can't serve directly (unmapped launch, install). */
export function toAppiumAction(command: AdapterCommand, bundleMap: Record<string, string> = {}): AppiumAction {
  switch (command.kind) {
    case 'screenshot': return { via: 'screenshot' }
    case 'type':       return { via: 'type', text: command.text }
    case 'reboot':     return { via: 'reboot' }
    case 'tap':        return { via: 'execute', script: 'mobile: tap', args: [{ x: command.x, y: command.y }] }
    case 'swipe': {
      // Prefer an EXACT finger drag from the user's start→end LOGICAL points: a canned `mobile: swipe up`
      // near the bottom is hijacked by iOS into the home-indicator gesture, so directional-only swipes
      // (esp. UP) misfire. dragFromToForDuration replays the precise drag. Fall back to the coarse
      // directional swipe only when coords are missing.
      if (command.x1 != null && command.y1 != null && command.x2 != null && command.y2 != null) {
        const duration = Math.min(2, Math.max(0.1, (command.durationMs ?? 250) / 1000)) // seconds, clamped sane
        return { via: 'execute', script: 'mobile: dragFromToForDuration', args: [{ fromX: command.x1, fromY: command.y1, toX: command.x2, toY: command.y2, duration }] }
      }
      return { via: 'execute', script: 'mobile: swipe', args: [{ direction: command.dir }] }
    }
    // iOS has no system app-switcher gesture exposed by XCUITest; the reference WDA
    // adapter treats home + switcher the same (go to the home screen).
    case 'home':
    case 'switcher':   return { via: 'execute', script: 'mobile: pressButton', args: [{ name: 'home' }] }
    case 'lock':       return { via: 'execute', script: 'mobile: lock', args: [{}] }
    case 'unlock':     return { via: 'execute', script: 'mobile: unlock', args: [{}] }
    // No universal hardware "back" on iOS — emulate the left-edge swipe-right gesture.
    case 'back':       return { via: 'execute', script: 'mobile: dragFromToForDuration', args: [{ fromX: 2, fromY: 400, toX: 250, toY: 400, duration: 0.2 }] }
    case 'launch': {
      // Prefer the explicit bundle id (real installed-app inventory carries it); fall back
      // to resolving an app name via the map / reverse-DNS heuristic.
      const bundleId = command.bundleId ?? (command.appName ? resolveBundleId(command.appName, bundleMap) : null)
      if (!bundleId) throw Object.assign(new Error(`launch needs a bundleId for "${command.appName ?? ''}" — set APPIUM_BUNDLE_MAP`), { code: 'LAUNCH_UNMAPPED', retryable: false })
      return { via: 'execute', script: 'mobile: activateApp', args: [{ bundleId }] }
    }
    case 'terminate':  return { via: 'execute', script: 'mobile: terminateApp', args: [{ bundleId: command.bundleId }] }
    // App install at scale is an ABM/MDM concern (supervised push), not Appium.
    case 'install':    throw Object.assign(new Error('install is handled by ABM/MDM, not the Appium adapter'), { code: 'INSTALL_UNSUPPORTED', retryable: false })
    default: {
      const _exhaustive: never = command
      throw Object.assign(new Error(`unsupported command: ${(_exhaustive as { kind?: string }).kind}`), { code: 'UNSUPPORTED', retryable: false })
    }
  }
}

/** A coarse mid-screen swipe vector (device points) when a gesture carries no explicit coords. */
function directSwipeVector(dir: 'up' | 'down' | 'left' | 'right'): { fromX: number; fromY: number; toX: number; toY: number } {
  switch (dir) {
    case 'up': return { fromX: 200, fromY: 600, toX: 200, toY: 200 }
    case 'down': return { fromX: 200, fromY: 200, toX: 200, toY: 600 }
    case 'left': return { fromX: 600, fromY: 400, toX: 100, toY: 400 }
    case 'right': return { fromX: 100, fromY: 400, toX: 600, toY: 400 }
  }
}

/**
 * Stage 2B-B: map a hot-path gesture to WebDriverAgent's UNSESSIONED /wda/* endpoint, hit directly on
 * the device's local WDA port — skipping the Appium HTTP + XCUITest routing hop. Returns null for any
 * command that must stay on Appium (launch/terminate/type/screenshot/install + a malformed gesture), so
 * the caller falls back. PURE + exported for unit testing — no network, no port, no session.
 */
export function toDirectWdaRequest(command: AdapterCommand): { path: string; body?: unknown } | null {
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  switch (command.kind) {
    case 'tap': {
      const x = num(command.x), y = num(command.y)
      return x !== null && y !== null ? { path: '/wda/tap/0', body: { x, y } } : null
    }
    case 'swipe': {
      const duration = Math.min(2, Math.max(0.1, (command.durationMs ?? 250) / 1000))
      const x1 = num(command.x1), y1 = num(command.y1), x2 = num(command.x2), y2 = num(command.y2)
      // Prefer the EXACT start/end coords (already clamped off the iOS edges by swipe-safety on the
      // client); fall back to a coarse directional vector only when coords are missing.
      const seg = x1 !== null && y1 !== null && x2 !== null && y2 !== null
        ? { fromX: x1, fromY: y1, toX: x2, toY: y2 }
        : directSwipeVector(command.dir)
      return { path: '/wda/dragfromtoforduration', body: { ...seg, duration } }
    }
    case 'home':
    case 'switcher': return { path: '/wda/homescreen' }
    case 'back': return { path: '/wda/dragfromtoforduration', body: { fromX: 2, fromY: 400, toX: 250, toY: 400, duration: 0.2 } }
    case 'lock': return { path: '/wda/lock' }
    case 'unlock': return { path: '/wda/unlock' }
    default: return null // tap/swipe/home/switcher/back/lock/unlock only — everything else stays on Appium
  }
}

// Stage 2B-B: env-gated direct-WDA fast path for hot-path gestures (Appium remains the fallback).
const DIRECT_WDA = process.env.PFA_DIRECT_WDA === '1' || process.env.PFA_DIRECT_WDA === 'true'
const DIRECT_WDA_DEBUG = process.env.PFA_DEBUG_LATENCY === '1' || process.env.PFA_DEBUG_LATENCY === 'true'

export class AppiumDeviceControlAdapter implements DeviceControlAdapter {
  readonly isReal = true
  private readonly appiumUrl: string
  private readonly bundleMap: Record<string, string>
  private readonly extraCaps: Record<string, unknown>
  /** udid → active Appium W3C sessionId. */
  private readonly sessions = new Map<string, string>()
  /** udid → the device's local WDA port (for the 2B-B direct-WDA fast path). */
  private readonly wdaPort = new Map<string, number>()
  /** udid → cached device LOGICAL window rect (points). Stable per session → fetched once, not per frame. */
  private readonly windowRect = new Map<string, { width: number | null; height: number | null }>()

  constructor(opts: AppiumAdapterOptions = {}) {
    if (process.platform !== 'darwin') {
      throw new Error('AppiumDeviceControlAdapter requires macOS (darwin) for USB discovery; use SimulatedDeviceControlAdapter elsewhere')
    }
    this.appiumUrl = (opts.appiumUrl ?? 'http://127.0.0.1:4723').replace(/\/+$/, '')
    this.bundleMap = opts.bundleMap ?? {}
    this.extraCaps = opts.extraCaps ?? {}
  }

  // ── USB discovery / identity / telemetry (libimobiledevice, like the macOS adapter) ──
  async listAttachedUdids(): Promise<string[]> {
    const { stdout } = await run('idevice_id', ['-l'])
    return stdout.split('\n').map((s) => s.trim()).filter(Boolean)
  }

  async getIdentity(udid: string): Promise<DeviceIdentity> {
    const info = async (key: string) => {
      try { return (await run('ideviceinfo', ['-u', udid, '-k', key])).stdout.trim() } catch { return '' }
    }
    const [name, productType, productVersion] = await Promise.all([info('DeviceName'), info('ProductType'), info('ProductVersion')])
    return {
      udid,
      name: name || `iPhone ${udid.slice(-4)}`,
      model: productType || 'iPhone',
      osVersion: productVersion ? `iOS ${productVersion}` : '',
      platform: 'ios',
    }
  }

  async getTelemetry(udid: string): Promise<DeviceTelemetry> {
    let battery: number | null = null
    try {
      const raw = (await run('ideviceinfo', ['-u', udid, '-q', 'com.apple.mobile.battery', '-k', 'BatteryCurrentCapacity'])).stdout.trim()
      const n = raw ? Number(raw) : NaN
      battery = Number.isFinite(n) ? n : null
    } catch { battery = null }
    // CPU/mem need an on-device helper; report null rather than fabricate.
    return { battery, cpuUsage: null, memoryUsage: null }
  }

  // ── Appium session lifecycle (Appium owns WDA) ──
  async startWda(udid: string, port: number): Promise<void> {
    this.wdaPort.set(udid, port) // always current → the 2B-B direct path hits the right WDA port
    const existing = this.sessions.get(udid)
    if (existing && (await this.sessionAlive(existing))) return // idempotent — healthy session already up
    if (existing) { await this.deleteSession(existing).catch(() => {}); this.sessions.delete(udid) }
    this.windowRect.delete(udid) // a fresh session may have a new rect → re-fetch + re-cache lazily

    const capabilities = {
      alwaysMatch: {
        platformName: 'iOS',
        'appium:automationName': 'XCUITest',
        'appium:udid': udid,
        'appium:wdaLocalPort': port,   // pin WDA to the agent-allocated port (per-device)
        'appium:usePrebuiltWDA': true, // reuse a built WDA — essential at fleet scale
        'appium:noReset': true,
        'appium:newCommandTimeout': 0, // the agent keeps the session alive across commands
        ...this.extraCaps,
      },
      firstMatch: [{}],
    }
    const data = await this.appium('POST', '/session', { capabilities }) as { value?: { sessionId?: string }; sessionId?: string }
    const sessionId = data?.value?.sessionId ?? data?.sessionId
    if (!sessionId) throw Object.assign(new Error('Appium did not return a sessionId'), { code: 'APPIUM_NO_SESSION', retryable: true })
    this.sessions.set(udid, sessionId)
  }

  async isWdaHealthy(udid: string): Promise<boolean> {
    const sid = this.sessions.get(udid)
    return sid ? this.sessionAlive(sid) : false
  }

  async stopWda(udid: string): Promise<void> {
    const sid = this.sessions.get(udid)
    this.sessions.delete(udid)
    this.wdaPort.delete(udid)
    this.windowRect.delete(udid)
    if (sid) await this.deleteSession(sid).catch(() => {})
  }

  /** 2B-B: hit a WDA UNSESSIONED /wda/* endpoint directly on the device port — no Appium hop. */
  private async directWda(base: string, path: string, body?: unknown): Promise<void> {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw Object.assign(new Error(`direct WDA ${path} → HTTP ${res.status}`), { code: 'WDA_DIRECT_ERROR' })
  }

  async execute(udid: string, command: AdapterCommand): Promise<AdapterExecOutcome> {
    if (command.kind === 'reboot') {
      // USB reboot via libimobiledevice (supervised fleets may prefer an MDM reboot).
      await run('idevicediagnostics', ['-u', udid, 'restart'])
      return {}
    }
    // 2B-B: env-gated DIRECT-WDA fast path for hot gestures (tap/swipe/home/back/lock/unlock). Skips the
    // Appium HTTP + XCUITest hop. On ANY failure it falls THROUGH to the authoritative Appium path below,
    // so direct-WDA can only make commands faster, never less reliable. App launch/terminate/type/
    // screenshot/inventory always stay on Appium (toDirectWdaRequest returns null for them).
    if (DIRECT_WDA) {
      const req = toDirectWdaRequest(command)
      const port = this.wdaPort.get(udid)
      if (req && port) {
        const t0 = DIRECT_WDA_DEBUG ? Date.now() : 0
        try {
          await this.directWda(`http://127.0.0.1:${port}`, req.path, req.body)
          if (DIRECT_WDA_DEBUG) console.error(JSON.stringify({ ev: 'wda.direct', udid, kind: command.kind, ms: Date.now() - t0 }))
          return {}
        } catch (err) {
          if (DIRECT_WDA_DEBUG) console.error(JSON.stringify({ ev: 'wda.direct.fallback', udid, kind: command.kind, error: (err as { message?: string })?.message }))
          // fall through to the Appium path
        }
      }
    }
    const sid = this.sessions.get(udid)
    if (!sid) throw Object.assign(new Error(`no Appium session for ${udid}`), { code: 'NO_SESSION', retryable: true })
    const action = toAppiumAction(command, this.bundleMap)

    switch (action.via) {
      case 'screenshot': {
        const res = await this.appium('GET', `/session/${sid}/screenshot`) as { value?: unknown }
        // Device LOGICAL size (points) for tap mapping — CACHED per session (stable except rotation), so
        // the Snapshot fallback no longer pays a /window/rect round-trip every frame.
        let rect = this.windowRect.get(udid) ?? null
        if (!rect) {
          try {
            const wr = await this.appium('GET', `/session/${sid}/window/rect`) as { value?: { width?: number; height?: number } }
            const v = wr?.value
            rect = { width: typeof v?.width === 'number' ? v.width : null, height: typeof v?.height === 'number' ? v.height : null }
            if (rect.width !== null || rect.height !== null) this.windowRect.set(udid, rect)
          } catch { rect = null }
        }
        return screenshotOutcome(res?.value, rect)
      }
      case 'type': {
        // W3C: send keys to the currently-focused element (a text field must be focused).
        const active = await this.appium('POST', `/session/${sid}/element/active`) as { value?: Record<string, string> }
        const eid = active?.value ? Object.values(active.value)[0] : undefined
        if (!eid) throw Object.assign(new Error('no focused field to type into'), { code: 'NO_ACTIVE_ELEMENT', retryable: false })
        await this.appium('POST', `/session/${sid}/element/${eid}/value`, { text: action.text, value: [...action.text] })
        return {}
      }
      case 'execute':
        await this.appium('POST', `/session/${sid}/execute/sync`, { script: action.script, args: action.args })
        return {}
      case 'reboot':
        return {} // handled above
    }
  }

  /**
   * Probe each bundle id with XCUITest `mobile: queryAppState`. Returns:
   *   0 not installed · 1 not running · 2 bg suspended · 3 bg · 4 foreground
   * installed = state >= 1. A probe that errors → installed:false (never fabricated).
   */
  async queryInstalledApps(udid: string, bundleIds: string[]): Promise<AppInstallState[]> {
    const sid = this.sessions.get(udid)
    if (!sid) throw Object.assign(new Error(`no Appium session for ${udid}`), { code: 'NO_SESSION', retryable: true })
    const out: AppInstallState[] = []
    for (const bundleId of bundleIds) {
      try {
        const res = await this.appium('POST', `/session/${sid}/execute/sync`, { script: 'mobile: queryAppState', args: [{ bundleId }] }) as { value?: unknown }
        const state = typeof res?.value === 'number' ? res.value : Number(res?.value)
        out.push({ bundleId, installed: Number.isFinite(state) && state >= 1 })
      } catch {
        out.push({ bundleId, installed: false })
      }
    }
    return out
  }

  // ── HTTP plumbing ──
  private async sessionAlive(sessionId: string): Promise<boolean> {
    try { await this.appium('GET', `/session/${sessionId}/window/rect`); return true } catch { return false }
  }
  private async deleteSession(sessionId: string): Promise<void> {
    await this.appium('DELETE', `/session/${sessionId}`)
  }

  private async appium(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${this.appiumUrl}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    })
    const json = await res.json().catch(() => ({})) as { value?: { message?: string } }
    if (!res.ok) {
      // W3C errors are { value: { error, message, stacktrace } }; surface message only (never the request body / typed text).
      throw Object.assign(new Error(`Appium ${method} ${path.replace(/\/element\/[^/]+/, '/element/…')} → ${json?.value?.message ?? `HTTP ${res.status}`}`), { code: 'APPIUM_HTTP_ERROR', retryable: res.status >= 500 })
    }
    return json
  }
}

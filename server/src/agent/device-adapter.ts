/**
 * The seam between the hardware agent and the real macOS/USB/WDA tooling.
 *
 * Two implementations:
 *   - SimulatedDeviceControlAdapter — pure, deterministic, no OS calls. Used by
 *     EVERY unit test and by `device-agent --simulate` on any platform (incl.
 *     Windows/CI). It models USB discovery, WDA startup, port assignment, and
 *     gesture execution in memory.
 *   - MacosDeviceControlAdapter — shells out to the real iOS toolchain
 *     (idevice_id / ideviceinfo / xcodebuild WDA / WDA HTTP). Guarded to run only
 *     on darwin; throws clearly on any other platform so a test or a non-Mac host
 *     can never accidentally hit it.
 *
 * The agent runtime depends ONLY on this interface, so the real and simulated
 * paths are cleanly separated and the daemon is fully testable without hardware.
 */
import type { DeviceIdentity, DeviceTelemetry } from './types'

/** A single gesture/command the adapter knows how to perform against one device.
 *  The agent runtime translates an AgentCommandFrame into one of these. */
export type AdapterCommand =
  | { kind: 'screenshot' }
  | { kind: 'tap'; x: number; y: number }
  // Optional start/end LOGICAL points + duration → an EXACT finger drag (mobile: dragFromToForDuration),
  // which avoids iOS edge-gesture hijack (a canned "swipe up" near the bottom triggers the home indicator).
  // Falls back to the coarse directional swipe when coords are absent.
  | { kind: 'swipe'; dir: 'up' | 'down' | 'left' | 'right'; x1?: number; y1?: number; x2?: number; y2?: number; durationMs?: number }
  | { kind: 'type'; text: string }
  | { kind: 'home' }
  | { kind: 'back' }
  | { kind: 'switcher' }
  | { kind: 'lock' }
  | { kind: 'unlock' }
  | { kind: 'launch'; appName?: string; bundleId?: string }
  | { kind: 'terminate'; bundleId: string }
  | { kind: 'install'; appName?: string }
  | { kind: 'reboot' }

/** One supported app's install state on a device, as the agent detected it. */
export interface AppInstallState {
  bundleId: string
  /** True ONLY when the agent confirmed the app is installed; unknown → false. */
  installed: boolean
}

/** What an adapter returns from executing a command. `result` carries optional
 *  action output (e.g. a screenshot reference) — NEVER secrets or raw payloads. */
export interface AdapterExecOutcome {
  result?: unknown
}

/**
 * The hardware-control surface. All methods are keyed by UDID so one adapter
 * instance manages a multi-device Mac Mini. Methods throw on failure; the
 * executor maps thrown errors to a structured, secret-free CommandResultBody.
 */
export interface DeviceControlAdapter {
  /** True on a host where the REAL implementation can run (darwin + tooling).
   *  The simulated adapter returns true everywhere. */
  readonly isReal: boolean

  /** Discover the UDIDs of all currently USB-attached iPhones. Stable across
   *  calls for the same physical set of devices (this is the reconnect key). */
  listAttachedUdids(): Promise<string[]>

  /** Read the stable identity (model / iOS version / name) for one UDID. */
  getIdentity(udid: string): Promise<DeviceIdentity>

  /** Sample live telemetry (battery / cpu / mem). Best-effort: a field that
   *  can't be read comes back null rather than throwing. */
  getTelemetry(udid: string): Promise<DeviceTelemetry>

  /**
   * Start (or confirm) WebDriverAgent for a device on the given local port and
   * wait until its /status is healthy. Idempotent: calling it for an
   * already-running healthy WDA is a no-op. Throws if WDA can't be brought up.
   */
  startWda(udid: string, port: number): Promise<void>

  /** True iff WDA for this UDID currently answers /status ok. */
  isWdaHealthy(udid: string): Promise<boolean>

  /** Tear down WDA for a UDID (on disconnect / shutdown). Never throws. */
  stopWda(udid: string): Promise<void>

  /** Execute one command against a device whose WDA is healthy. */
  execute(udid: string, command: AdapterCommand): Promise<AdapterExecOutcome>

  /**
   * Probe which of the given bundle ids are INSTALLED on the device. iOS has no
   * unrestricted app listing, so this tests each supported bundle id individually
   * (queryAppState). A bundle whose state can't be determined comes back
   * installed:false — never fabricated as installed.
   */
  queryInstalledApps(udid: string, bundleIds: string[]): Promise<AppInstallState[]>
}

/**
 * Deterministic, OS-free implementation of DeviceControlAdapter. Models USB
 * discovery, WDA startup/health, and gesture execution entirely in memory so the
 * whole agent runtime is testable on any platform without hardware.
 *
 * Tests drive it through its small control surface:
 *   - attach(identity) / detach(udid): simulate a cable plug / unplug.
 *   - failWdaFor(udid) / failNextExecute(): force error paths for lifecycle tests.
 *
 * It NEVER touches the OS, network, or filesystem.
 */
import type { DeviceControlAdapter, AdapterCommand, AdapterExecOutcome } from './device-adapter'
import type { DeviceIdentity, DeviceTelemetry } from './types'

interface SimDevice {
  identity: DeviceIdentity
  wdaPort: number | null
  wdaHealthy: boolean
  battery: number
}

export class SimulatedDeviceControlAdapter implements DeviceControlAdapter {
  readonly isReal = false
  private readonly devices = new Map<string, SimDevice>()
  /** UDIDs whose startWda should fail (WDA-startup failure path). */
  private readonly wdaFailures = new Set<string>()
  /** When >0, the next N execute() calls throw (transient-failure path). */
  private execFailuresLeft = 0
  private execFailureCode = 'SIM_EXEC_FAILED'

  /** Simulate plugging in a device (or re-plugging an existing UDID — identity
   *  is refreshed, so reconnect-by-UDID returns the same stable key). */
  attach(identity: DeviceIdentity): void {
    const prev = this.devices.get(identity.udid)
    this.devices.set(identity.udid, {
      identity,
      wdaPort: prev?.wdaPort ?? null,
      wdaHealthy: false,
      battery: prev?.battery ?? 87,
    })
  }

  /** Simulate unplugging a device. */
  detach(udid: string): void {
    this.devices.delete(udid)
  }

  /** Force startWda to fail for a UDID until cleared. */
  failWdaFor(udid: string): void {
    this.wdaFailures.add(udid)
  }
  clearWdaFailure(udid: string): void {
    this.wdaFailures.delete(udid)
  }

  /** Force the next `count` execute() calls to throw with `code`. */
  failNextExecute(count = 1, code = 'SIM_EXEC_FAILED'): void {
    this.execFailuresLeft = count
    this.execFailureCode = code
  }

  async listAttachedUdids(): Promise<string[]> {
    return [...this.devices.keys()]
  }

  async getIdentity(udid: string): Promise<DeviceIdentity> {
    const d = this.devices.get(udid)
    if (!d) throw new Error(`device not attached: ${udid}`)
    return d.identity
  }

  async getTelemetry(udid: string): Promise<DeviceTelemetry> {
    const d = this.devices.get(udid)
    if (!d) throw new Error(`device not attached: ${udid}`)
    // Drift battery down slowly + deterministically-ish for realism.
    d.battery = Math.max(2, d.battery - 1)
    return { battery: d.battery, cpuUsage: 12, memoryUsage: 41 }
  }

  async startWda(udid: string, port: number): Promise<void> {
    const d = this.devices.get(udid)
    if (!d) throw new Error(`device not attached: ${udid}`)
    if (this.wdaFailures.has(udid)) throw new Error('WDA failed to start (simulated)')
    d.wdaPort = port
    d.wdaHealthy = true
  }

  async isWdaHealthy(udid: string): Promise<boolean> {
    return this.devices.get(udid)?.wdaHealthy ?? false
  }

  async stopWda(udid: string): Promise<void> {
    const d = this.devices.get(udid)
    if (d) {
      d.wdaHealthy = false
      d.wdaPort = null
    }
  }

  async execute(udid: string, command: AdapterCommand): Promise<AdapterExecOutcome> {
    const d = this.devices.get(udid)
    if (!d) throw new Error(`device not attached: ${udid}`)
    if (!d.wdaHealthy) throw new Error('WDA not healthy')
    if (this.execFailuresLeft > 0) {
      this.execFailuresLeft--
      const err = new Error('execute failed (simulated)') as Error & { code?: string }
      err.code = this.execFailureCode
      throw err
    }
    // Screenshot returns an opaque, non-secret reference; everything else is a
    // bare ok. No real bytes are produced in the simulator.
    if (command.kind === 'screenshot') {
      return { result: { screenshot: `sim://${udid}/${Date.now()}` } }
    }
    return {}
  }
}

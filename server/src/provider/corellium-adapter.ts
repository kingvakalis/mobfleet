import type { CreateDevicesOptions, Device, Job, Proxy, TaskSpec } from '../../../src/shared/types'
import type { FleetStore } from '../fleet-store'
import type { DeviceProvider } from './device-provider'

/**
 * Corellium adapter — RECOMMENDED real provider for virtual iOS (the only
 * surveyed provider that natively fits "rent a persistent, individually-
 * addressable pool of iOS phones and run automations at scale").
 *
 * STATUS: documented stub. Corellium is enterprise/sales-gated; confirm a plan
 * with programmatic instance creation + budget before implementing. The
 * SimulatedDeviceAdapter is the working default until then.
 *
 * Wiring (from research, official SDK @corellium/corellium-api ^1.9 + Bearer):
 *   - auth:        POST /v1/auth/login (apiToken) → Bearer for all calls
 *   - createDevices→ POST /v1/instances {project, flavor:'<iphone>', os}  (async;
 *                    poll GET /v1/instances/{id} until state 'on' + agent ready,
 *                    writing a provisional `warming` Device row immediately)
 *   - start/stop  → POST /v1/instances/{id}/start | /stop
 *   - delete      → DELETE /v1/instances/{id}
 *   - getStatus   → GET /v1/instances/{id}; map state+taskState → 5-state:
 *                    on+agent-ready→online, creating/booting→warming, off→offline,
 *                    error→error, running-task→busy
 *   - runTask     → device Agent API: install .ipa, push camera-roll media
 *                    (consume the presigned R2 GET key), drive synthetic
 *                    touch/type to script warmup/engage; emit progress → store
 *   - rotateProxy → per-instance network/identity settings
 * The real impl updates `store` from a poll loop (startLoop) so the WS feed
 * mirrors device/job changes exactly like the simulator.
 */
export class CorelliumAdapter implements DeviceProvider {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(private store: FleetStore) {}

  private nyi(): never {
    throw new Error('CorelliumAdapter not implemented — set PROVIDER=simulated, or wire CORELLIUM_API_TOKEN/PROJECT_ID and implement the lifecycle (see file header).')
  }

  startLoop() {/* real impl: poll GET /v1/instances and reconcile into store */}
  stopLoop() {}

  createDevices(_count: number, _opts?: CreateDevicesOptions): Promise<Device[]> { return this.nyi() }
  start(_id: string): Promise<Device> { return this.nyi() }
  stop(_id: string): Promise<Device> { return this.nyi() }
  delete(_id: string): Promise<void> { return this.nyi() }
  getStatus(_id: string): Promise<Device['status']> { return this.nyi() }
  runTask(_id: string, _task: TaskSpec): Promise<Job> { return this.nyi() }
  enqueueTask(_task: TaskSpec): Promise<Job> { return this.nyi() }
  retryJob(_jobId: string): Promise<Job> { return this.nyi() }
  assignGroup(_ids: string[], _group: string): Promise<void> { return this.nyi() }
  rotateProxy(_deviceId: string): Promise<void> { return this.nyi() }
  testProxy(_ip: string): Promise<Proxy> { return this.nyi() }
}

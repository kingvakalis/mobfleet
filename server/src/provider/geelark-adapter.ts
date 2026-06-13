import type { CreateDevicesOptions, Device, Job, Proxy, TaskSpec } from '../../../src/shared/types'
import type { FleetStore } from '../fleet-store'
import type { DeviceProvider } from './device-provider'

/**
 * GeeLark adapter — cleanest API match to ProviderClient, but ANDROID-ONLY today
 * (iOS "coming soon", not in the API). Use ONLY if the product relaxes to Android.
 *
 * STATUS: documented stub. The SimulatedDeviceAdapter is the working default.
 *
 * Wiring (from research; base https://openapi.geelark.com, all POST + JSON):
 *   - auth:  header `Authorization: Bearer <appToken>` + `traceId` (Token mode),
 *            OR signature mode: sign = SHA256(appId+traceId+ts+nonce+apiKey).upper
 *   - envelope: { traceId, code, msg, data } — code!==0 is an error (HTTP is 200);
 *               special-case 40006 (partial) / 40007 (rate-limited, 200/min).
 *   - listDevices  → /open/v1/phone/list        createDevices → /open/v1/phone/addNew
 *   - start/stop   → /open/v1/phone/start|stop   delete → /open/v1/phone/delete
 *   - getStatus    → /open/v1/phone/status (0 started,1 starting,2 shutdown,3 expired)
 *   - runTask      → /open/v1/task/add (taskType 1 publish-video,2 warmup,3 image)
 *                    or custom RPA /open/v1/task/rpa/add (flowId); enqueue via scheduleAt
 *   - listJobs/retry → /open/v1/task/query | /restart   proxy → /open/v1/proxy/add|check
 *   - media        → 2-step: /open/v1/upload/getUrl → PUT bytes → resourceUrl into task
 *   - REALTIME     → GeeLark pushes WEBHOOKS (register /open/v1/callback/set); ingest
 *                    at POST /callbacks and fan out into `store` → our WS feed.
 */
export class GeelarkAdapter implements DeviceProvider {
  constructor(private store: FleetStore) {}

  private nyi(): never {
    throw new Error('GeelarkAdapter not implemented (Android-only) — set PROVIDER=simulated, or wire GEELARK_APP_ID/API_KEY and implement against openapi.geelark.com (see file header).')
  }

  startLoop() {/* real impl: webhooks drive updates; optional reconcile poll */}
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

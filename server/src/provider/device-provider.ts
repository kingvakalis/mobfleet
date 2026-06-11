import type {
  CreateDevicesOptions,
  Device,
  DeviceStatus,
  Job,
  Proxy,
  TaskSpec,
} from '../../../src/shared/types'

/**
 * The seam between the control plane and a real (or simulated) phone provider.
 * The default SimulatedDeviceAdapter needs no credentials; CorelliumAdapter /
 * GeelarkAdapter implement the same surface against real provider APIs.
 */
export interface DeviceProvider {
  createDevices(count: number, opts?: CreateDevicesOptions): Promise<Device[]>
  start(id: string): Promise<Device>
  stop(id: string): Promise<Device>
  delete(id: string): Promise<void>
  getStatus(id: string): Promise<DeviceStatus>
  runTask(id: string, task: TaskSpec): Promise<Job>
  enqueueTask(task: TaskSpec): Promise<Job>
  retryJob(jobId: string): Promise<Job>
  assignGroup(ids: string[], group: string): Promise<void>
  rotateProxy(deviceId: string): Promise<void>
  testProxy(ip: string): Promise<Proxy>
  /** Begin any background loop (simulation tick, or real-provider polling). */
  startLoop?(): void
  stopLoop?(): void
}

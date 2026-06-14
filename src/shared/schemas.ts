import { z } from 'zod'

/** Runtime validation mirroring shared/types.ts — used by server routes and
 *  the client's response parsing. Keep in lockstep with types.ts. */

export const deviceStatusSchema = z.enum(['online', 'busy', 'warming', 'offline', 'error'])
export const taskTypeSchema = z.enum(['upload', 'warmup', 'engage', 'post'])
export const jobStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed'])
export const proxyStatusSchema = z.enum(['healthy', 'failing', 'unassigned'])

export const deviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: deviceStatusSchema,
  region: z.string(),
  osVersion: z.string(),
  model: z.string(),
  proxy: z.string(),
  battery: z.number(),
  group: z.string(),
  assignedUser: z.string().nullable(),
  jobId: z.string().nullable(),
  createdAt: z.number(),
  // Live telemetry (optional — present once a device has heartbeat).
  lastHeartbeat: z.number().nullable().optional(),
  cpuUsage: z.number().nullable().optional(),
  memoryUsage: z.number().nullable().optional(),
})

export const jobSchema = z.object({
  id: z.string(),
  deviceId: z.string().nullable(),
  type: taskTypeSchema,
  status: jobStatusSchema,
  progress: z.number(),
  createdAt: z.number(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
  error: z.string().nullable(),
})

export const proxySchema = z.object({
  ip: z.string(),
  region: z.string(),
  provider: z.string(),
  assignedTo: z.string().nullable(),
  status: proxyStatusSchema,
  latency: z.number(),
  lastCheck: z.number(),
})

export const fleetSnapshotSchema = z.object({
  devices: z.array(deviceSchema),
  jobs: z.array(jobSchema),
  proxies: z.array(proxySchema),
  ts: z.number(),
  ready: z.boolean(),
})

export const taskSpecSchema = z.object({
  type: taskTypeSchema,
  label: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
})

// --- request bodies ---
export const createDevicesBody = z.object({
  count: z.number().int().min(1).max(100),
  region: z.string().optional(),
})
// Device provisioning: a device exchanges its pairing token for a real device
// record + an API key. Public endpoint — the pairingToken is the credential.
export const claimDeviceBody = z.object({
  pairingToken: z.string().uuid(),
  udid: z.string().min(1).max(256),
  name: z.string().min(1).max(120).optional(),
  platform: z.enum(['ios', 'android']).optional(),
  osVersion: z.string().min(1).max(40).optional(),
})
export type ClaimDeviceBody = z.infer<typeof claimDeviceBody>
export const assignGroupBody = z.object({
  ids: z.array(z.string()).min(1),
  group: z.string().min(1),
})

// --- WS frames (server → client) ---
export const wsSnapshotFrame = z.object({
  type: z.literal('snapshot'),
  seq: z.number(),
  payload: fleetSnapshotSchema,
})

// --- WS frames (device agent → server) ---
// A device reports its live state. `type` discriminates it from any other
// inbound frame; the server validates this before touching the fleet.
export const heartbeatFrameSchema = z.object({
  type: z.literal('heartbeat'),
  deviceId: z.string().min(1),
  status: deviceStatusSchema.optional(),
  battery: z.number().min(0).max(100).optional(),
  cpuUsage: z.number().min(0).max(100).optional(),
  memoryUsage: z.number().min(0).max(100).optional(),
})
export type HeartbeatFrame = z.infer<typeof heartbeatFrameSchema>

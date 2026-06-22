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

// --- agent command channel ---
// The actions the hardware agent can execute. Mirrors agent/src/types.ts
// agentCommandSchema, plus `reboot` (idevicediagnostics restart) and the
// `back`/`switcher` navigation keys driven by the live Phone Control surface.
export const agentCommandActionSchema = z.enum([
  'screenshot', 'tap', 'swipe', 'type', 'home', 'back', 'lock', 'unlock', 'switcher', 'launch', 'install', 'reboot',
  'terminate', 'refresh_apps',
])
export type AgentCommandAction = z.infer<typeof agentCommandActionSchema>

const swipeDirSchema = z.enum(['up', 'down', 'left', 'right'])
const keyNameSchema = z.enum(['home', 'back', 'lock', 'switcher'])
/** Bound on typed text — prevents an oversized payload from being queued. */
const MAX_TYPED_TEXT = 5000
/** Bound on tap coordinates — finite + within a sane device-pixel range. */
const COORD_MAX = 100_000

/**
 * Body for POST /v1/agent/command — a dashboard user queues a command for a
 * device's agent. The payload is validated PER ACTION at runtime (TypeScript
 * types are not runtime validation): tap needs finite x/y, swipe a direction,
 * type non-empty bounded text, launch a bounded appName. Extra payload keys are
 * tolerated (existing lenient convention); the required fields are enforced.
 */
export const agentCommandBody = z
  .object({
    deviceId: z.string().min(1).max(128),
    action: agentCommandActionSchema,
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((cmd, ctx) => {
    const p = cmd.payload ?? {}
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message, path: ['payload'] })
    const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
    switch (cmd.action) {
      case 'tap':
        if (!finite(p.x) || !finite(p.y)) fail('tap requires finite x and y coordinates')
        else if (p.x < 0 || p.y < 0 || p.x > COORD_MAX || p.y > COORD_MAX) fail('tap coordinates out of range')
        break
      case 'swipe':
        if (!swipeDirSchema.safeParse(p.dir).success) fail('swipe requires dir of up|down|left|right')
        break
      case 'type':
        if (typeof p.text !== 'string' || p.text.length < 1) fail('type requires non-empty text')
        else if (p.text.length > MAX_TYPED_TEXT) fail(`text exceeds ${MAX_TYPED_TEXT} characters`)
        break
      case 'launch': {
        const hasBundle = typeof p.bundleId === 'string' && p.bundleId.trim().length > 0
        const hasName = typeof p.appName === 'string' && p.appName.trim().length > 0
        if (!hasBundle && !hasName) fail('launch requires a bundleId or appName')
        else if (hasBundle && (p.bundleId as string).length > 200) fail('bundleId exceeds 200 characters')
        else if (hasName && (p.appName as string).length > 120) fail('appName exceeds 120 characters')
        break
      }
      case 'terminate':
        if (typeof p.bundleId !== 'string' || p.bundleId.trim().length < 1) fail('terminate requires a non-empty bundleId')
        else if (p.bundleId.length > 200) fail('bundleId exceeds 200 characters')
        break
      // screenshot/home/back/lock/unlock/switcher/reboot/install/refresh_apps: no payload required
    }
  })
export type AgentCommandBody = z.infer<typeof agentCommandBody>

/**
 * Strict, typed control-command validator (the discriminated-union UI shape).
 * Used to validate a ControlCommand before mapping it to the wire format, and
 * exercised directly in tests. Mirrors shared/types.ts ControlCommand.
 */
export const controlCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tap'), deviceId: z.string().min(1).max(128), x: z.number().finite(), y: z.number().finite() }),
  z.object({ type: z.literal('swipe'), deviceId: z.string().min(1).max(128), dir: swipeDirSchema, x1: z.number().finite().optional(), y1: z.number().finite().optional(), x2: z.number().finite().optional(), y2: z.number().finite().optional(), durationMs: z.number().finite().optional(), scroll: z.boolean().optional() }),
  z.object({ type: z.literal('key'), deviceId: z.string().min(1).max(128), key: keyNameSchema }),
  z.object({ type: z.literal('launch_app'), deviceId: z.string().min(1).max(128), appName: z.string().trim().min(1).max(120) }),
  z.object({ type: z.literal('screenshot'), deviceId: z.string().min(1).max(128) }),
  z.object({ type: z.literal('type_text'), deviceId: z.string().min(1).max(128), text: z.string().min(1).max(MAX_TYPED_TEXT) }),
])

/** A single command-log entry + the server→browser frame that carries it. */
export const commandLogEntrySchema = z.object({
  ts: z.number(),
  text: z.string(),
  commandType: z.enum(['tap', 'swipe', 'key', 'launch_app', 'screenshot', 'type_text']).optional(),
  success: z.boolean().optional(),
})
export const commandLogFrameSchema = z.object({
  type: z.literal('command_log'),
  deviceId: z.string().min(1),
  entry: commandLogEntrySchema,
})

/** Body for POST /v1/agent/command/:commandId/ack — the agent reports a result. */
export const agentCommandAckBody = z.object({
  status: z.enum(['acked', 'failed']),
  error: z.string().max(2000).optional(),
})

/**
 * The agent's command RESULT (mirrors agent/src/types.ts CommandResultBody).
 * Timing fields are optional so the HTTP ack path — which carries only
 * status + error — can normalize into the SAME shape. The validated body is
 * stored in AgentCommand.result on ack (never raw frames, keys, or secrets).
 */
export const commandResultBody = z.object({
  success: z.boolean(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  durationMs: z.number().optional(),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.string().max(64).optional(),
      message: z.string().max(2000).optional(),
      retryable: z.boolean().optional(),
    })
    .optional(),
})
export type CommandResultBody = z.infer<typeof commandResultBody>

/** Device-agent → server WS frame carrying a command result. A `deviceId` in the
 *  frame is NOT trusted — the server uses the authenticated socket's device. */
export const commandResultFrameSchema = commandResultBody.extend({
  type: z.literal('command_result'),
  commandId: z.string().min(1).max(128),
  deviceId: z.string().min(1).max(128).optional(),
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

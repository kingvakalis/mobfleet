import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  agentCommandAckBody, agentCommandBody, assignGroupBody, claimDeviceBody, createDevicesBody, taskSpecSchema,
  type AgentCommandAction, type CommandResultBody,
} from '../../src/shared/schemas'
import type { EngineRegistry, TeamEngine } from './tenancy/engine-registry'
import { actor, authenticate, authenticateIdentity, ctx, identityOf, requirePermission, tokenFromRequest, type AuthMode } from './auth/context'
import { claimDevice, createPairingToken, publicServerUrl, resolveDeviceKey } from './provisioning'
import { markDelivered, queueCommand, takePendingForDevice, toFrame } from './agent-commands'
import { pushToDevice } from './device-hub'
import { broadcastCommandLog } from './command-log-hub'
import { acknowledgeCommandResult } from './command-completion'
import { formatCommandLog, commandTypeForAction } from '../../src/shared/control-command'
import { listDeviceSessions, toDeviceSessionRecord } from './device-sessions'
import { prisma } from './db'
import { logAudit, resolveMeState } from './auth/db'
import { buildMeResponse } from './auth/me'
import { rateLimit } from './rate-limit'
import { HttpError, forbidden, notFound, unauthorized } from './http-error'
import { registerTeamRoutes } from './routes/team'
import { registerEmailSettingsRoutes } from './routes/email-settings'
import { registerActivityRoutes } from './routes/activity'
import { registerOnboardingRoutes } from './routes/onboarding'
import { can, canActOnPhone, scopePhones } from '../../src/lib/authorization/effective-access'
import type { PermissionKey } from '../../src/lib/authorization/permissions'
import type { FleetStore } from './fleet-store'

/** Permission required to queue each agent action. Most device-driving actions
 *  are phones.control; screenshot + reboot have their own (higher-)risk keys. */
const PERMISSION_FOR_ACTION: Record<AgentCommandAction, PermissionKey> = {
  screenshot: 'phones.screenshot',
  reboot: 'phones.reboot',
  tap: 'phones.control',
  swipe: 'phones.control',
  type: 'phones.control',
  home: 'phones.control',
  back: 'phones.control',
  lock: 'phones.control',
  unlock: 'phones.control',
  switcher: 'phones.control',
  launch: 'phones.control',
  install: 'phones.control',
}

/** Authenticate an AGENT request by its per-device API key (Bearer). Unlike user
 *  requests (Supabase JWT) the agent has no user session — its device key both
 *  identifies and authorizes it. Returns the resolved team + device. */
async function authDeviceKey(req: FastifyRequest): Promise<{ teamId: string; deviceId: string }> {
  const key = tokenFromRequest(req)
  if (!key) throw unauthorized('missing device API key')
  const dev = await resolveDeviceKey(key)
  if (!dev) throw unauthorized('invalid device API key')
  return dev
}

/**
 * Resolve a device for an action, enforcing BOTH tenant isolation AND the
 * actor's per-member scope. 404 when the id isn't in the actor's team (conceals
 * cross-tenant existence); 403 when it's in the team but outside the actor's
 * assigned scope. requirePermission(key) must already have run, so canActOnPhone
 * here reduces to the scope check for scoped members (workspace-scoped members
 * are unaffected).
 */
function deviceForAction(req: FastifyRequest, store: FleetStore, id: string, key: PermissionKey) {
  const d = store.getDevice(id)
  if (!d) throw notFound('device not found')
  if (!canActOnPhone(actor(req), key, d)) throw forbidden('device is outside your assigned scope')
  return d
}

/**
 * REST surface under /v1, mirroring the ProviderClient interface — now
 * MULTI-TENANT and authenticated. A global preHandler authenticates every
 * request and resolves req.auth.{userId,teamId,role}; each handler operates on
 * that team's engine (its own store + provider), so reads and writes are
 * tenant-scoped by construction. Mutations additionally check the actor's RBAC
 * permission. Only /v1/health is public.
 */
export function registerRoutes(app: FastifyInstance, registry: EngineRegistry) {
  // Authenticate by the MATCHED ROUTE's static `config.auth` (Fastify resolves the
  // route before onRequest, so req.routeOptions.config is the registered route's
  // config — query strings, trailing-slash/case variants, and registration order
  // cannot change it; an unmatched URL 404s before any handler). Unset → 'team', so
  // a new/unflagged route is fully authenticated by default (fail-closed). This
  // replaces the prior raw-URL string matching.
  //   public   → no user gate (health, device claim; /ws self-auths in its handler)
  //   device   → agent poll/ack — self-authenticate via the per-device API key
  //   identity → verified JWT + ensured profile only (no team / no auto-provision)
  //   team     → full tenant context resolved onto req.auth (every business route)
  app.addHook('onRequest', async (req, reply) => {
    const mode = (req.routeOptions?.config as { auth?: AuthMode } | undefined)?.auth ?? 'team'
    if (mode === 'public' || mode === 'device') return
    if (mode === 'identity') return authenticateIdentity(req)
    await authenticate(req, reply)
  })

  const engineOf = (req: FastifyRequest): Promise<TeamEngine> => registry.get(ctx(req).teamId)

  // Platform health check (Railway). Intentionally tiny: no auth, no DB, no
  // tenant context — just proves the process is up and serving HTTP.
  app.get('/healthz', { config: { auth: 'public' } }, async (_req, reply) => reply.code(200).send({ status: 'ok' }))

  app.get('/v1/health', { config: { auth: 'public' } }, async () => ({ ok: true, provider: process.env.PROVIDER ?? 'simulated' }))

  app.get('/v1/snapshot', async (req) => {
    requirePermission(req, 'fleet.view')
    const { store } = await engineOf(req)
    return store.snapshot()
  })

  // devices — list is filtered to the actor's scope (not just the team)
  app.get('/v1/devices', async (req) => {
    requirePermission(req, 'phones.view')
    const { store } = await engineOf(req)
    return scopePhones(actor(req), store.listDevices())
  })
  app.get('/v1/devices/:id', async (req) => {
    requirePermission(req, 'phones.view')
    const { store } = await engineOf(req)
    return deviceForAction(req, store, (req.params as { id: string }).id, 'phones.view')
  })
  app.get('/v1/devices/:id/status', async (req) => {
    requirePermission(req, 'phones.view')
    const { store } = await engineOf(req)
    const d = deviceForAction(req, store, (req.params as { id: string }).id, 'phones.view')
    return { status: d.status }
  })
  // Recent device-agent connection sessions for a device (newest first, max 20).
  // Requires phones.view + tenant/scope ownership (deviceForAction throws 404
  // cross-tenant, 403 out-of-scope). The query is ALSO scoped by teamId as
  // defense in depth, so one team can never read another's session history.
  app.get('/v1/devices/:id/sessions', async (req) => {
    requirePermission(req, 'phones.view')
    const { store } = await engineOf(req)
    const deviceId = (req.params as { id: string }).id
    deviceForAction(req, store, deviceId, 'phones.view')
    const rows = await listDeviceSessions(ctx(req).teamId, deviceId)
    return { sessions: rows.map(toDeviceSessionRecord) }
  })
  app.post('/v1/devices', async (req) => {
    requirePermission(req, 'phones.provision') // provisioning is manager+ (billable), not operator
    const { count, region } = createDevicesBody.parse(req.body)
    const { provider } = await engineOf(req)
    return provider.createDevices(count, { region })
  })
  app.post('/v1/devices/:id/start', async (req) => {
    requirePermission(req, 'phones.control')
    const { store, provider } = await engineOf(req)
    deviceForAction(req, store, (req.params as { id: string }).id, 'phones.control')
    return provider.start((req.params as { id: string }).id)
  })
  app.post('/v1/devices/:id/stop', async (req) => {
    requirePermission(req, 'phones.control')
    const { store, provider } = await engineOf(req)
    deviceForAction(req, store, (req.params as { id: string }).id, 'phones.control')
    return provider.stop((req.params as { id: string }).id)
  })
  app.delete('/v1/devices/:id', async (req) => {
    requirePermission(req, 'phones.retire')
    const { store, provider } = await engineOf(req)
    const deviceId = (req.params as { id: string }).id
    deviceForAction(req, store, deviceId, 'phones.retire')
    await provider.delete(deviceId)
    // Revoke the device's long-lived API key(s) so a retired/compromised device's
    // credential can't keep authenticating the heartbeat WS or command endpoints.
    await prisma.deviceApiKey.deleteMany({ where: { teamId: ctx(req).teamId, deviceId } })
    return { ok: true }
  })
  app.post('/v1/devices/:id/task', async (req) => {
    requirePermission(req, 'automations.run')
    const task = taskSpecSchema.parse(req.body)
    const { store, provider } = await engineOf(req)
    deviceForAction(req, store, (req.params as { id: string }).id, 'automations.run')
    return provider.runTask((req.params as { id: string }).id, task)
  })
  app.post('/v1/devices/:id/proxy/rotate', async (req) => {
    requirePermission(req, 'phones.control')
    const { store, provider } = await engineOf(req)
    deviceForAction(req, store, (req.params as { id: string }).id, 'phones.control')
    await provider.rotateProxy((req.params as { id: string }).id)
    return { ok: true }
  })

  // device provisioning — mint a pairing token (QR) for the active team
  app.post('/v1/devices/pair', async (req) => {
    requirePermission(req, 'phones.provision')
    const teamId = ctx(req).teamId
    if (!rateLimit(`pair:${teamId}`, 30, 60_000)) throw new HttpError(429, 'too many pairing requests, slow down')
    const row = await createPairingToken(teamId, Date.now())
    return { pairingToken: row.token, serverUrl: publicServerUrl(req), expiresAt: row.expiresAt }
  })
  // device provisioning — a device claims its pairing token (PUBLIC; the token
  // is the credential). Creates the device in its team + returns an API key.
  // Rate-limited per source IP as a coarse DoS backstop (front with an edge
  // limiter in production; req.ip is the proxy peer behind a reverse proxy).
  app.post('/v1/devices/claim', { config: { auth: 'public' } }, async (req) => {
    if (!rateLimit(`claim:${req.ip}`, 60, 60_000)) throw new HttpError(429, 'too many claim attempts, slow down')
    const body = claimDeviceBody.parse(req.body)
    return claimDevice(registry, body, Date.now())
  })

  // jobs — list is filtered to jobs whose device is in the actor's scope
  app.get('/v1/jobs', async (req) => {
    requirePermission(req, 'jobs.view')
    const { store } = await engineOf(req)
    const a = actor(req)
    if (a.scope.type === 'workspace' || can(a, 'jobs.view_all')) return store.listJobs()
    const inScope = new Set(scopePhones(a, store.listDevices()).map((d) => d.id))
    return store.listJobs().filter((j) => !j.deviceId || inScope.has(j.deviceId))
  })
  app.post('/v1/tasks', async (req) => {
    requirePermission(req, 'automations.run')
    const { provider } = await engineOf(req)
    return provider.enqueueTask(taskSpecSchema.parse(req.body))
  })
  app.post('/v1/jobs/:id/retry', async (req) => {
    requirePermission(req, 'jobs.retry')
    const { store, provider } = await engineOf(req)
    const job = store.getJob((req.params as { id: string }).id)
    if (!job) throw notFound('job not found')
    if (job.deviceId) deviceForAction(req, store, job.deviceId, 'jobs.retry')
    return provider.retryJob((req.params as { id: string }).id)
  })

  // automations
  app.get('/v1/automations', async (req) => {
    requirePermission(req, 'automations.view')
    const { store } = await engineOf(req)
    return store.listAutomations()
  })

  // proxies
  app.get('/v1/proxies', async (req) => {
    requirePermission(req, 'phones.view')
    const { store } = await engineOf(req)
    return store.listProxies()
  })
  app.post('/v1/proxies/:ip/test', async (req) => {
    requirePermission(req, 'phones.control')
    const { provider } = await engineOf(req)
    return provider.testProxy((req.params as { ip: string }).ip)
  })

  // groups — every targeted device must be in the actor's scope
  app.post('/v1/groups/assign', async (req) => {
    requirePermission(req, 'phones.assign_group')
    const { ids, group } = assignGroupBody.parse(req.body)
    const { store, provider } = await engineOf(req)
    for (const deviceId of ids) deviceForAction(req, store, deviceId, 'phones.assign_group')
    await provider.assignGroup(ids, group)
    return { ok: true }
  })

  // ── Agent command channel ──────────────────────────────────────────────────
  // A dashboard user queues a command for a device's agent. Permission depends on
  // the action (screenshot/reboot have their own keys; the rest are phones.control),
  // and deviceForAction enforces tenant + per-member scope. The command is durably
  // queued; if the agent's heartbeat socket is live it's pushed instantly, else the
  // agent drains it on its next poll.
  app.post('/v1/agent/command', async (req) => {
    const body = agentCommandBody.parse(req.body)
    const permission = PERMISSION_FOR_ACTION[body.action]
    requirePermission(req, permission)
    const { store } = await engineOf(req)
    deviceForAction(req, store, body.deviceId, permission)
    const teamId = ctx(req).teamId
    const userId = ctx(req).userId
    // Throttle per (user, device) so one seat can't flood the durable queue / WS push.
    if (!rateLimit(`cmdqueue:${userId}:${body.deviceId}`, 60, 60_000)) {
      throw new HttpError(429, 'queuing commands too fast')
    }
    const now = Date.now()
    const cmd = await queueCommand({
      teamId,
      deviceId: body.deviceId,
      action: body.action,
      payload: body.payload,
      issuedBy: userId,
      now,
    })
    const pushed = pushToDevice(teamId, body.deviceId, toFrame(cmd))
    if (pushed) await markDelivered(teamId, body.deviceId, cmd.id, now)
    // Accountability for physical-effect/privacy actions (reboot, screenshot, …).
    await logAudit({ teamId, actorId: userId, action: `agent.command.${body.action}`, target: body.deviceId, result: 'allowed', detail: pushed ? 'delivered' : 'pending' })
    // Echo a team-scoped command-log entry to every operator browsing this team,
    // live over their existing /ws socket. This means "command accepted/queued" —
    // NOT device execution; typed text is never logged (only a character count).
    broadcastCommandLog(teamId, {
      type: 'command_log',
      deviceId: body.deviceId,
      entry: { ts: now, text: formatCommandLog(body.action, body.payload), commandType: commandTypeForAction(body.action) },
    })
    return { commandId: cmd.id, status: pushed ? 'delivered' : 'pending' }
  })

  // The agent polls its own queue (device-key auth). Returns undelivered commands
  // and atomically marks them delivered. own-rows-only: the key must resolve to
  // the :agentId being polled (mirrors the WS heartbeat's own-device check).
  app.get('/v1/agent/command/queue/:agentId', { config: { auth: 'device' } }, async (req) => {
    const { teamId, deviceId } = await authDeviceKey(req)
    const agentId = (req.params as { agentId: string }).agentId
    if (agentId !== deviceId) throw forbidden('device key does not match the requested queue')
    if (!rateLimit(`cmdpoll:${deviceId}`, 120, 60_000)) throw new HttpError(429, 'polling too fast')
    const commands = await takePendingForDevice(teamId, deviceId, Date.now())
    return { commands }
  })

  // The agent reports a command's result (device-key auth; own-rows-only).
  app.post('/v1/agent/command/:commandId/ack', { config: { auth: 'device' } }, async (req) => {
    const { teamId, deviceId } = await authDeviceKey(req)
    const commandId = (req.params as { commandId: string }).commandId
    const body = agentCommandAckBody.parse(req.body)
    if (!rateLimit(`cmdack:${deviceId}`, 240, 60_000)) throw new HttpError(429, 'too many acks')
    // Normalize the {status,error} HTTP ack into the canonical CommandResultBody
    // (the WS path carries the full body; HTTP carries only status + error), then
    // persist + broadcast a team-scoped completion log — only on a NEW terminal
    // transition. Authoritative team/device come from the command row, not the request.
    const result: CommandResultBody = {
      success: body.status === 'acked',
      error: body.error ? { message: body.error } : undefined,
    }
    let outcome: 'updated' | 'noop' | 'missing'
    try {
      ({ outcome } = await acknowledgeCommandResult({ teamId, deviceId, commandId, result, now: Date.now() }))
    } catch {
      // Persistence failed → no completion broadcast happened; return a generic
      // 500 without leaking the raw Prisma error.
      throw new HttpError(500, 'could not record command result')
    }
    // 'noop' = already terminal (the other half of the dual WS+HTTP ack got there
    // first) → idempotent success; only a genuinely unknown command is a 404.
    if (outcome === 'missing') throw notFound('command not found for this device')
    return { ok: true }
  })

  // team / members / invites
  registerTeamRoutes(app)

  // per-team transactional email sender settings (GET/POST /v1/settings/email)
  registerEmailSettingsRoutes(app)

  // team-scoped activity / security-audit read API (GET /v1/activity) — paginated,
  // gated by activity.view_security, scoped to the authenticated team.
  registerActivityRoutes(app)

  // first-team onboarding (POST /v1/onboarding/team) — identity-only, no team required
  registerOnboardingRoutes(app)

  // whoami — the AUTHORITATIVE post-login state. Identity-only auth, so it works
  // before the user has a team: it reports onboardingRequired / suspended /
  // pendingInvite plus the server-computed permission set, and does NOT
  // auto-provision. The UI derives routing + permissions from THIS (a no-team user
  // is onboarding-required, never "access restricted"), not from local state.
  app.get('/v1/me', { config: { auth: 'identity' } }, async (req) => {
    const { identity, user } = identityOf(req)
    const requestedTeamId = (req.headers['x-team-id'] as string | undefined)?.trim() || undefined
    const { classification, pendingInvite } = await resolveMeState(user, requestedTeamId)
    return buildMeResponse({ identity, user, classification, pendingInvite })
  })
}

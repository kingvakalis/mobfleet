import type { FastifyInstance, FastifyRequest } from 'fastify'
import { assignGroupBody, claimDeviceBody, createDevicesBody, taskSpecSchema } from '../../src/shared/schemas'
import type { EngineRegistry, TeamEngine } from './tenancy/engine-registry'
import { actor, authenticate, ctx, requirePermission } from './auth/context'
import { claimDevice, createPairingToken, publicServerUrl } from './provisioning'
import { rateLimit } from './rate-limit'
import { HttpError, forbidden, notFound } from './http-error'
import { registerTeamRoutes } from './routes/team'
import { can, canActOnPhone, scopePhones } from '../../src/lib/authorization/effective-access'
import type { PermissionKey } from '../../src/lib/authorization/permissions'
import type { FleetStore } from './fleet-store'

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
  // Authenticate everything except health + the WS upgrade (which authenticates
  // itself in the upgrade handler).
  app.addHook('onRequest', async (req, reply) => {
    // Match the exact parsed pathname (not a raw-URL prefix) so a future route
    // under a /ws* path can never be silently left unauthenticated.
    const path = req.url.split('?')[0]
    // Public: health checks, the WS upgrade (self-auths), and device claim (the
    // pairing token in the body IS the credential — a device has no user session).
    if (path === '/healthz' || path === '/v1/health' || path === '/ws' || path === '/v1/devices/claim') return
    await authenticate(req, reply)
  })

  const engineOf = (req: FastifyRequest): Promise<TeamEngine> => registry.get(ctx(req).teamId)

  // Platform health check (Railway). Intentionally tiny: no auth, no DB, no
  // tenant context — just proves the process is up and serving HTTP.
  app.get('/healthz', async (_req, reply) => reply.code(200).send({ status: 'ok' }))

  app.get('/v1/health', async () => ({ ok: true, provider: process.env.PROVIDER ?? 'simulated' }))

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
    deviceForAction(req, store, (req.params as { id: string }).id, 'phones.retire')
    await provider.delete((req.params as { id: string }).id)
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
  app.post('/v1/devices/claim', async (req) => {
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

  // team / members / invites
  registerTeamRoutes(app)

  // whoami — the client uses this to learn its team + role + scope (the server
  // is the source of truth; the UI must derive permissions from this, not from
  // local state). A suspended member never reaches here (resolveAuthContext 403s).
  app.get('/v1/me', async (req) => {
    const c = ctx(req)
    return { userId: c.userId, email: c.email, name: c.name, teamId: c.teamId, teamName: c.teamName, role: c.role, scope: c.scope }
  })
}

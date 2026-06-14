import type { FastifyInstance, FastifyRequest } from 'fastify'
import { assignGroupBody, claimDeviceBody, createDevicesBody, taskSpecSchema } from '../../src/shared/schemas'
import type { EngineRegistry, TeamEngine } from './tenancy/engine-registry'
import { authenticate, ctx, requirePermission } from './auth/context'
import { claimDevice, createPairingToken, publicServerUrl } from './provisioning'
import { rateLimit } from './rate-limit'
import { HttpError } from './http-error'
import { registerTeamRoutes } from './routes/team'

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
    // Public: health, the WS upgrade (self-auths), and device claim (the pairing
    // token in the body IS the credential — a device has no user session yet).
    if (path === '/v1/health' || path === '/ws' || path === '/v1/devices/claim') return
    await authenticate(req, reply)
  })

  const engineOf = (req: FastifyRequest): Promise<TeamEngine> => registry.get(ctx(req).teamId)

  app.get('/v1/health', async () => ({ ok: true, provider: process.env.PROVIDER ?? 'simulated' }))

  app.get('/v1/snapshot', async (req) => {
    requirePermission(req, 'fleet.view')
    const { store } = await engineOf(req)
    return store.snapshot()
  })

  // devices
  app.get('/v1/devices', async (req) => {
    requirePermission(req, 'phones.view')
    const { store } = await engineOf(req)
    return store.listDevices()
  })
  app.get('/v1/devices/:id', async (req, reply) => {
    requirePermission(req, 'phones.view')
    const { store } = await engineOf(req)
    const d = store.getDevice((req.params as { id: string }).id)
    if (!d) return reply.code(404).send({ error: 'device not found' })
    return d
  })
  app.get('/v1/devices/:id/status', async (req, reply) => {
    requirePermission(req, 'phones.view')
    const { store } = await engineOf(req)
    const d = store.getDevice((req.params as { id: string }).id)
    if (!d) return reply.code(404).send({ error: 'device not found' })
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
    const { provider } = await engineOf(req)
    return provider.start((req.params as { id: string }).id)
  })
  app.post('/v1/devices/:id/stop', async (req) => {
    requirePermission(req, 'phones.control')
    const { provider } = await engineOf(req)
    return provider.stop((req.params as { id: string }).id)
  })
  app.delete('/v1/devices/:id', async (req) => {
    requirePermission(req, 'phones.retire')
    const { provider } = await engineOf(req)
    await provider.delete((req.params as { id: string }).id)
    return { ok: true }
  })
  app.post('/v1/devices/:id/task', async (req) => {
    requirePermission(req, 'automations.run')
    const task = taskSpecSchema.parse(req.body)
    const { provider } = await engineOf(req)
    return provider.runTask((req.params as { id: string }).id, task)
  })
  app.post('/v1/devices/:id/proxy/rotate', async (req) => {
    requirePermission(req, 'phones.control')
    const { provider } = await engineOf(req)
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

  // jobs
  app.get('/v1/jobs', async (req) => {
    requirePermission(req, 'jobs.view')
    const { store } = await engineOf(req)
    return store.listJobs()
  })
  app.post('/v1/tasks', async (req) => {
    requirePermission(req, 'automations.run')
    const { provider } = await engineOf(req)
    return provider.enqueueTask(taskSpecSchema.parse(req.body))
  })
  app.post('/v1/jobs/:id/retry', async (req) => {
    requirePermission(req, 'jobs.retry')
    const { provider } = await engineOf(req)
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

  // groups
  app.post('/v1/groups/assign', async (req) => {
    requirePermission(req, 'phones.assign_group')
    const { ids, group } = assignGroupBody.parse(req.body)
    const { provider } = await engineOf(req)
    await provider.assignGroup(ids, group)
    return { ok: true }
  })

  // team / members / invites
  registerTeamRoutes(app)

  // whoami — the client uses this to learn its team + role after login.
  app.get('/v1/me', async (req) => {
    const c = ctx(req)
    return { userId: c.userId, email: c.email, name: c.name, teamId: c.teamId, teamName: c.teamName, role: c.role }
  })
}

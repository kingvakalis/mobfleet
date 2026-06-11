import type { FastifyInstance } from 'fastify'
import { assignGroupBody, createDevicesBody, taskSpecSchema } from '../../src/shared/schemas'
import type { FleetStore } from './fleet-store'
import type { DeviceProvider } from './provider'

/** REST surface under /v1 mirroring the ProviderClient interface 1:1.
 *  Reads come from the in-memory FleetStore; mutations go through the adapter
 *  (which writes through the store → DB + WS broadcast). */
export function registerRoutes(app: FastifyInstance, store: FleetStore, provider: DeviceProvider) {
  app.get('/v1/health', async () => ({ ok: true, provider: process.env.PROVIDER ?? 'simulated' }))
  app.get('/v1/snapshot', async () => store.snapshot())

  // devices
  app.get('/v1/devices', async () => store.listDevices())
  app.get('/v1/devices/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const d = store.getDevice(id)
    if (!d) return reply.code(404).send({ error: 'device not found' })
    return d
  })
  app.get('/v1/devices/:id/status', async (req, reply) => {
    const { id } = req.params as { id: string }
    const d = store.getDevice(id)
    if (!d) return reply.code(404).send({ error: 'device not found' })
    return { status: d.status }
  })
  app.post('/v1/devices', async (req) => {
    const { count, region } = createDevicesBody.parse(req.body)
    return provider.createDevices(count, { region })
  })
  app.post('/v1/devices/:id/start', async (req) => {
    const { id } = req.params as { id: string }
    return provider.start(id)
  })
  app.post('/v1/devices/:id/stop', async (req) => {
    const { id } = req.params as { id: string }
    return provider.stop(id)
  })
  app.delete('/v1/devices/:id', async (req) => {
    const { id } = req.params as { id: string }
    await provider.delete(id)
    return { ok: true }
  })
  app.post('/v1/devices/:id/task', async (req) => {
    const { id } = req.params as { id: string }
    const task = taskSpecSchema.parse(req.body)
    return provider.runTask(id, task)
  })
  app.post('/v1/devices/:id/proxy/rotate', async (req) => {
    const { id } = req.params as { id: string }
    await provider.rotateProxy(id)
    return { ok: true }
  })

  // jobs
  app.get('/v1/jobs', async () => store.listJobs())
  app.post('/v1/tasks', async (req) => provider.enqueueTask(taskSpecSchema.parse(req.body)))
  app.post('/v1/jobs/:id/retry', async (req) => {
    const { id } = req.params as { id: string }
    return provider.retryJob(id)
  })

  // proxies
  app.get('/v1/proxies', async () => store.listProxies())
  app.post('/v1/proxies/:ip/test', async (req) => {
    const { ip } = req.params as { ip: string }
    return provider.testProxy(ip)
  })

  // groups
  app.post('/v1/groups/assign', async (req) => {
    const { ids, group } = assignGroupBody.parse(req.body)
    await provider.assignGroup(ids, group)
    return { ok: true }
  })
}

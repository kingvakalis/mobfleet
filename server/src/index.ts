import Fastify from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import { ZodError } from 'zod'
import { env } from './env'
import { FleetStore } from './fleet-store'
import { createProvider } from './provider'
import { registerRoutes } from './routes'
import { registerWs } from './ws'

async function main() {
  const store = new FleetStore()
  await store.init()
  const provider = createProvider(store)

  const app = Fastify({ logger: false })

  await app.register(cors, {
    origin: env.allowedOrigin === '*' ? true : env.allowedOrigin.split(','),
    credentials: true,
  })
  await app.register(websocket)

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'invalid request', issues: err.issues })
    }
    const msg = err instanceof Error ? err.message : 'error'
    const code = /unknown/i.test(msg) ? 404 : 400
    return reply.code(code).send({ error: msg })
  })

  registerWs(app, store, env.allowedOrigin)
  registerRoutes(app, store, provider)

  provider.startLoop?.()
  // Simulated uplink handshake → ready (mirrors the mock's boot state).
  setTimeout(() => store.setReady(true), 700)

  await app.listen({ port: env.port, host: '0.0.0.0' })
  console.log(`[server] listening on http://localhost:${env.port}  ·  provider=${env.provider}`)
}

main().catch((e) => {
  console.error('[server] fatal', e)
  process.exit(1)
})

import Fastify from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import { ZodError } from 'zod'
import { env, assertAuthConfig, assertProvisioningConfig } from './env'
import { EngineRegistry } from './tenancy/engine-registry'
import { registerRoutes } from './routes'
import { registerWs } from './ws'
import { HttpError } from './http-error'
import { startPairingTokenCleanup } from './provisioning'
import { startAgentCommandCleanup } from './agent-commands'

async function main() {
  assertAuthConfig() // fail fast on an insecure prod auth config
  assertProvisioningConfig() // fail fast if the QR server URL isn't pinned in prod

  // One fleet engine (store + provider + sim loop) per tenant, created lazily.
  const registry = new EngineRegistry()

  const app = Fastify({ logger: false })

  await app.register(cors, {
    origin: env.allowedOrigin === '*' ? true : env.allowedOrigin.split(','),
    credentials: true,
  })
  await app.register(websocket)

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'invalid request', issues: err.issues })
    }
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.message })
    }
    const e = err as { statusCode?: number; message?: string }
    const msg = typeof e.message === 'string' ? e.message : 'error'
    if (typeof e.statusCode === 'number' && e.statusCode >= 400) {
      return reply.code(e.statusCode).send({ error: msg })
    }
    const code = /unknown/i.test(msg) ? 404 : 400
    return reply.code(code).send({ error: msg })
  })

  registerWs(app, registry, env.allowedOrigin)
  registerRoutes(app, registry)

  startPairingTokenCleanup() // periodically prune expired/unclaimed pairing tokens
  startAgentCommandCleanup() // fail commands past their expiry (pending or delivered)

  await app.listen({ port: env.port, host: '0.0.0.0' })
  console.log(
    `[server] listening on http://localhost:${env.port}  ·  provider=${env.provider}  ·  auth=${env.authProvider}  ·  multi-tenant`,
  )
}

main().catch((e) => {
  console.error('[server] fatal', e)
  process.exit(1)
})

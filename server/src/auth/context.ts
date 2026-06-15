import type { FastifyReply, FastifyRequest } from 'fastify'
import { can, type Member } from '../../../src/lib/authorization/effective-access'
import type { PermissionKey } from '../../../src/lib/authorization/permissions'
import { forbidden, unauthorized } from '../http-error'
import { verifyToken, type Identity } from './identity'
import { ensureUser, resolveAuthContext, type AuthContext } from './db'

/**
 * How a route is authenticated, declared per-route via `config: { auth: … }` and
 * read in the global onRequest hook (see routes.ts). This is the matched route's
 * STATIC config, resolved by Fastify before onRequest, so it can't be bypassed by
 * query strings / URL variants / registration order. Unset → 'team' (fail-closed).
 *   team     — full tenant auth → req.auth (default)
 *   identity — verified JWT + ensured profile only → req.identity (no team/provision)
 *   device   — self-authenticates in the handler via its device API key
 *   public   — no auth (health, WS upgrade, device claim)
 */
export type AuthMode = 'team' | 'identity' | 'device' | 'public'

/** Identity-only context: a verified JWT identity + the ensured Prisma profile,
 *  WITHOUT a resolved team. Attached by authenticateIdentity for the onboarding /
 *  /v1/me routes, which must work for a user who has no team yet. */
export interface ResolvedIdentity {
  identity: Identity
  user: { id: string; email: string; name: string | null }
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext
    identity?: ResolvedIdentity
  }
  interface FastifyContextConfig {
    auth?: AuthMode
  }
}

/** Extract a bearer token from the Authorization header (preferred) or the
 *  `?token=` query param (used by the WebSocket upgrade, which can't set
 *  headers in the browser). */
export function tokenFromRequest(req: FastifyRequest): string | null {
  const h = req.headers.authorization
  if (h && h.startsWith('Bearer ')) return h.slice(7).trim()
  const q = (req.query as { token?: string } | undefined)?.token
  return q ? q.trim() : null
}

/** Resolve auth from a raw token + optional requested team. Shared by the HTTP
 *  preHandler and the WebSocket upgrade so both enforce identical tenancy.
 *  `preferredTeamName` names the workspace when a first-login user is
 *  auto-provisioned (set at signup). */
export async function authFromToken(token: string | null, requestedTeamId?: string, preferredTeamName?: string): Promise<AuthContext> {
  if (!token) throw unauthorized('missing bearer token')
  let identity
  try {
    identity = await verifyToken(token)
  } catch (e) {
    throw unauthorized(e instanceof Error ? e.message : 'invalid token')
  }
  return resolveAuthContext(identity, requestedTeamId, preferredTeamName)
}

/** Fastify preHandler: authenticate the request and attach req.auth. */
export async function authenticate(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const token = tokenFromRequest(req)
  const requestedTeamId = (req.headers['x-team-id'] as string | undefined)?.trim() || undefined
  const onboardTeamName = (req.headers['x-onboard-team-name'] as string | undefined)?.trim() || undefined
  req.auth = await authFromToken(token, requestedTeamId, onboardTeamName)
}

/** Identity-only auth (config: { auth: 'identity' }): verify the JWT and ensure the
 *  Prisma profile exists, but DON'T resolve a team or auto-provision. Used by the
 *  routes that must work before the user has a team (/v1/me, /v1/onboarding/team),
 *  so a no-team user is reported as onboarding-required rather than provisioned. */
export async function authenticateIdentity(req: FastifyRequest): Promise<void> {
  const token = tokenFromRequest(req)
  if (!token) throw unauthorized('missing bearer token')
  let identity: Identity
  try {
    identity = await verifyToken(token)
  } catch (e) {
    throw unauthorized(e instanceof Error ? e.message : 'invalid token')
  }
  const user = await ensureUser(identity)
  req.identity = { identity, user: { id: user.id, email: user.email, name: user.name } }
}

/** The verified identity-only context (throws if the identity preHandler didn't run). */
export function identityOf(req: FastifyRequest): ResolvedIdentity {
  if (!req.identity) throw unauthorized()
  return req.identity
}

/** The acting user as an authorization-engine Member — carries the resolved
 *  per-member scope so scope-aware checks (canActOnPhone/scopePhones) work
 *  server-side, not just in the UI. (Suspended members never reach here:
 *  resolveAuthContext refuses to build a context for them.) */
export function actor(req: FastifyRequest): Member {
  if (!req.auth) throw unauthorized()
  return { id: req.auth.userId, role: req.auth.role, overrides: req.auth.overrides, scope: req.auth.scope }
}

/** Throw 403 unless the acting user holds the permission. */
export function requirePermission(req: FastifyRequest, key: PermissionKey): void {
  if (!can(actor(req), key)) throw forbidden(`missing permission: ${key}`)
}

/** The authenticated tenant context (throws if the preHandler didn't run). */
export function ctx(req: FastifyRequest): AuthContext {
  if (!req.auth) throw unauthorized()
  return req.auth
}

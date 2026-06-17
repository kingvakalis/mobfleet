import type { FastifyInstance } from 'fastify'
import { prisma } from '../db'
import { ctx, requirePermission } from '../auth/context'
import { listActivity, parseActivityQuery } from '../activity'

/**
 * Team-scoped Activity / security-audit read API.
 *
 * AUTH: requires `activity.view_security` (the security-audit permission — role /
 * permission / ownership / invite / settings events). The team is the AUTHENTICATED
 * team (ctx().teamId); a client can never pass a teamId, so cross-team reads are
 * impossible. Cursor-paginated, newest first.
 *
 *   GET /v1/activity?limit=50&cursor=<opaque>
 *     -> { items: ActivityItem[], nextCursor: string | null }
 */
export function registerActivityRoutes(app: FastifyInstance) {
  app.get('/v1/activity', async (req) => {
    requirePermission(req, 'activity.view_security')
    const c = ctx(req)
    const query = parseActivityQuery((req.query ?? {}) as { limit?: unknown; cursor?: unknown })
    return listActivity(c.teamId, query, prisma)
  })
}

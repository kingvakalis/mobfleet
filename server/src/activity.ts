import type { PrismaClient } from '@prisma/client'
import { prisma } from './db'

/**
 * Activity / security-audit read model over the append-only AuditLog table.
 *
 * Pagination is CURSOR-based on (createdAt DESC, id DESC) — createdAt is a Float
 * epoch-ms (not DateTime), and id is the unique tiebreaker so a page boundary is
 * stable even when two rows share a millisecond. The composite AuditLog[teamId,
 * createdAt] index backs the descending scan. Every query is keyed on a
 * server-resolved teamId (never a client value), so one team can never read
 * another's audit trail. Cursor codec + query parsing are PURE (unit-tested).
 */

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

export interface ActivityCursor {
  createdAt: number
  id: string
}

/** Opaque, URL-safe cursor for the next page boundary. */
export function encodeActivityCursor(c: ActivityCursor): string {
  return Buffer.from(`${c.createdAt}:${c.id}`, 'utf8').toString('base64url')
}

/** Decode a cursor; returns null for a malformed/empty value (caller treats null
 *  as "from the start" — a bad cursor can never widen the team scope). */
export function decodeActivityCursor(raw: string | null | undefined): ActivityCursor | null {
  if (!raw) return null
  let decoded: string
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8')
  } catch {
    return null
  }
  const idx = decoded.indexOf(':')
  if (idx < 0) return null
  const createdAt = Number(decoded.slice(0, idx))
  const id = decoded.slice(idx + 1)
  if (!Number.isFinite(createdAt) || id.length === 0) return null
  return { createdAt, id }
}

export interface ActivityQuery {
  limit: number
  cursor: ActivityCursor | null
}

/** Parse + clamp the raw query string (limit 1..100, default 50; opaque cursor). */
export function parseActivityQuery(q: { limit?: unknown; cursor?: unknown }): ActivityQuery {
  let limit = DEFAULT_LIMIT
  const rawLimit = q.limit
  const n = typeof rawLimit === 'string' ? Number(rawLimit) : typeof rawLimit === 'number' ? rawLimit : NaN
  if (Number.isFinite(n)) limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(n)))
  const cursor = typeof q.cursor === 'string' ? decodeActivityCursor(q.cursor.trim()) : null
  return { limit, cursor }
}

export interface ActivityItem {
  id: string
  createdAt: number
  action: string
  target: string | null
  result: string
  detail: string | null
  actorId: string
  /** Resolved from User by actorId (AuditLog has no FK); null if the actor is gone. */
  actorEmail: string | null
  actorName: string | null
}

export interface ActivityPage {
  items: ActivityItem[]
  nextCursor: string | null
}

/**
 * List a team's audit trail, newest first, one page at a time. teamId MUST be the
 * server-resolved ctx(req).teamId — the WHERE is always anchored on it, so this can
 * never surface another tenant's rows even with a forged cursor.
 */
export async function listActivity(
  teamId: string,
  query: ActivityQuery,
  db: PrismaClient = prisma,
): Promise<ActivityPage> {
  const where = query.cursor
    ? {
        teamId,
        OR: [
          { createdAt: { lt: query.cursor.createdAt } },
          { createdAt: query.cursor.createdAt, id: { lt: query.cursor.id } },
        ],
      }
    : { teamId }

  const rows = await db.auditLog.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1, // one extra row tells us whether another page exists
  })
  const hasMore = rows.length > query.limit
  const page = hasMore ? rows.slice(0, query.limit) : rows

  // AuditLog.actorId is a bare string (no FK to User) — resolve display names in one
  // batched query, scoped to this page's actors.
  const actorIds = [...new Set(page.map((r) => r.actorId))]
  const users = actorIds.length
    ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true, name: true } })
    : []
  const byId = new Map(users.map((u) => [u.id, u]))

  const items: ActivityItem[] = page.map((r) => {
    const u = byId.get(r.actorId)
    return {
      id: r.id,
      createdAt: r.createdAt,
      action: r.action,
      target: r.target ?? null,
      result: r.result,
      detail: r.detail ?? null,
      actorId: r.actorId,
      actorEmail: u?.email ?? null,
      actorName: u?.name ?? null,
    }
  })

  const last = page[page.length - 1]
  const nextCursor = hasMore && last ? encodeActivityCursor({ createdAt: last.createdAt, id: last.id }) : null
  return { items, nextCursor }
}

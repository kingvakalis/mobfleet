import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { prisma } from './db'

/**
 * Shift / time-tracking persistence (team-scoped).
 *
 * INVARIANT: at most ONE active shift per (teamId, userId). Enforced in two layers:
 *  1. Application: startShift reads-then-creates inside a transaction.
 *  2. DB (defense in depth): a partial unique index on (teamId,userId) WHERE
 *     status='active' (see PROPOSALS.md). A race that slips past layer 1 fails with
 *     P2002, which startShift catches and treats as "an active shift already exists"
 *     → returns the existing one (idempotent).
 *
 * Idempotency:
 *  - startShift: returns the existing active shift if one is open (never opens a 2nd).
 *  - endShift: ending an already-ended shift is a NO-OP (returns it unchanged).
 *  - corrections: team-scoped per-id via findFirst({ where: { id, teamId } }).
 *
 * The Prisma `Shift` model does NOT exist yet (see PROPOSALS.md). This module compiles
 * against an injectable DB PORT; `prismaShiftsDb()` adapts the live client via
 * `prisma as unknown as ShiftsDb`, so `tsc --noEmit` passes without the delegate and
 * the integration tests SKIP until the model exists.
 */

// ── Domain ──────────────────────────────────────────────────────────────────────

export const SHIFT_STATUSES = ['active', 'ended'] as const
export type ShiftStatus = (typeof SHIFT_STATUSES)[number]

export interface ShiftRow {
  id: string
  teamId: string
  userId: string
  startedAt: number
  endedAt: number | null
  status: string
  correctedBy: string | null
  correctedAt: number | null
  note: string | null
  createdAt: number
  updatedAt: number
}

export interface ShiftRecord {
  id: string
  userId: string
  startedAt: number
  endedAt: number | null
  status: string
  durationMs: number | null
  correctedBy: string | null
  correctedAt: number | null
  note: string | null
}

/** Map a row to the client record (adds the derived duration). Pure. */
export function toShiftRecord(row: ShiftRow): ShiftRecord {
  return {
    id: row.id,
    userId: row.userId,
    startedAt: row.startedAt,
    endedAt: row.endedAt ?? null,
    status: row.status,
    durationMs: row.endedAt != null ? row.endedAt - row.startedAt : null,
    correctedBy: row.correctedBy ?? null,
    correctedAt: row.correctedAt ?? null,
    note: row.note ?? null,
  }
}

// ── Validation (Zod v4) ───────────────────────────────────────────────────────

export const startShiftBody = z.object({
  note: z.string().trim().max(500).optional(),
})
export type StartShiftBody = z.infer<typeof startShiftBody>

export const endShiftBody = z.object({
  note: z.string().trim().max(500).optional(),
})
export type EndShiftBody = z.infer<typeof endShiftBody>

/** Manager correction of a shift's start/end (gated by team.manage_shifts in the route). */
export const correctShiftBody = z
  .object({
    startedAt: z.number().int().positive().optional(),
    endedAt: z.number().int().positive().nullable().optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((b) => b.startedAt !== undefined || b.endedAt !== undefined || b.note !== undefined, {
    message: 'at least one of startedAt, endedAt, note is required',
  })
export type CorrectShiftBody = z.infer<typeof correctShiftBody>

/** Validate a correction's resulting time window. Pure. endedAt may be null (re-open). */
export function isValidShiftWindow(startedAt: number, endedAt: number | null): boolean {
  if (endedAt == null) return true
  return endedAt >= startedAt
}

export const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
  userId: z.string().optional(),
})
export type HistoryQuery = z.infer<typeof historyQuery>

// ── DB port + adapter ─────────────────────────────────────────────────────────

/** Prisma error with a code (P2002 = unique violation). Narrowed without importing
 *  the not-yet-generated client's error class. */
export function isUniqueViolation(e: unknown): boolean {
  return Boolean(e && typeof e === 'object' && (e as { code?: unknown }).code === 'P2002')
}

export interface ShiftsTx {
  shift: {
    findFirst(args: unknown): Promise<ShiftRow | null>
    findMany(args: unknown): Promise<ShiftRow[]>
    create(args: unknown): Promise<ShiftRow>
    update(args: unknown): Promise<ShiftRow>
  }
}

export interface ShiftsDb extends ShiftsTx {
  $transaction<T>(fn: (tx: ShiftsTx) => Promise<T>): Promise<T>
}

export function prismaShiftsDb(): ShiftsDb {
  return prisma as unknown as ShiftsDb
}

const id = () => `shift_${randomUUID()}`

// ── Data access (team-scoped) ────────────────────────────────────────────────────

/** The user's currently-active shift in this team (or null). */
export async function currentShift(teamId: string, userId: string, db: ShiftsTx = prismaShiftsDb()): Promise<ShiftRow | null> {
  return db.shift.findFirst({ where: { teamId, userId, status: 'active' } })
}

/**
 * Open a shift for (teamId, userId) IDEMPOTENTLY. Inside a transaction it re-checks
 * for an open shift and returns it if present (never a 2nd active shift). A concurrent
 * winner that slips through is caught by the P2002 partial-unique fallback, which
 * re-reads + returns the now-existing active shift. `created` tells the route whether
 * a new shift was opened.
 */
export async function startShift(teamId: string, userId: string, body: StartShiftBody, now: number, db: ShiftsDb = prismaShiftsDb()): Promise<{ shift: ShiftRow; created: boolean }> {
  try {
    return await db.$transaction(async (tx) => {
      const open = await tx.shift.findFirst({ where: { teamId, userId, status: 'active' } })
      if (open) return { shift: open, created: false }
      const shift = await tx.shift.create({
        data: {
          id: id(),
          teamId,
          userId,
          startedAt: now,
          endedAt: null,
          status: 'active',
          correctedBy: null,
          correctedAt: null,
          note: body.note ?? null,
          createdAt: now,
          updatedAt: now,
        },
      })
      return { shift, created: true }
    })
  } catch (e) {
    if (isUniqueViolation(e)) {
      const open = await db.shift.findFirst({ where: { teamId, userId, status: 'active' } })
      if (open) return { shift: open, created: false }
    }
    throw e
  }
}

/**
 * End the user's active shift IDEMPOTENTLY. With no open shift: returns
 * { shift: null, ended: false } (the route maps that to a 404). Re-ending is naturally
 * a no-op because only an `active` shift is selected.
 */
export async function endShift(teamId: string, userId: string, body: EndShiftBody, now: number, db: ShiftsDb = prismaShiftsDb()): Promise<{ shift: ShiftRow | null; ended: boolean }> {
  const open = await db.shift.findFirst({ where: { teamId, userId, status: 'active' } })
  if (!open) return { shift: null, ended: false }
  const updated = await db.shift.update({
    where: { id: open.id },
    data: { endedAt: now, status: 'ended', note: body.note ?? open.note, updatedAt: now },
  })
  return { shift: updated, ended: true }
}

/** Read ONE shift, team-scoped (cross-tenant id → null → 404). */
export async function getShift(teamId: string, shiftId: string, db: ShiftsTx = prismaShiftsDb()): Promise<ShiftRow | null> {
  return db.shift.findFirst({ where: { id: shiftId, teamId } })
}

/**
 * Paginated shift history (newest start first), team-scoped. The cursor is the
 * startedAt of the last seen row; an optional userId narrows to one employee (the
 * route gates a cross-user read behind team.view_all_shifts). Returns one extra row
 * to compute nextCursor.
 */
export async function listShifts(
  teamId: string,
  opts: { limit: number; cursor?: number; userId?: string },
  db: ShiftsTx = prismaShiftsDb(),
): Promise<{ shifts: ShiftRow[]; nextCursor: number | null }> {
  const where: Record<string, unknown> = { teamId }
  if (opts.userId) where.userId = opts.userId
  if (opts.cursor != null) where.startedAt = { lt: opts.cursor }
  const rows = await db.shift.findMany({ where, orderBy: { startedAt: 'desc' }, take: opts.limit + 1 })
  const hasMore = rows.length > opts.limit
  const page = hasMore ? rows.slice(0, opts.limit) : rows
  const last = page[page.length - 1]
  const nextCursor = hasMore && last ? last.startedAt : null
  return { shifts: page, nextCursor }
}

/** Decode a numeric history cursor (epoch ms); null/invalid → undefined (from start). */
export function parseShiftCursor(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Manager correction of a shift's start/end/note (team-scoped per-id). Stamps
 * correctedBy/correctedAt. Returns null when the id isn't in this team (route 404s)
 * and throws a RangeError when the resulting window is invalid (route 400s).
 */
export async function correctShift(
  teamId: string,
  shiftId: string,
  managerId: string,
  body: CorrectShiftBody,
  now: number,
  db: ShiftsTx = prismaShiftsDb(),
): Promise<ShiftRow | null> {
  const existing = await db.shift.findFirst({ where: { id: shiftId, teamId } })
  if (!existing) return null

  const nextStart = body.startedAt ?? existing.startedAt
  const nextEnd = body.endedAt !== undefined ? body.endedAt : existing.endedAt
  if (!isValidShiftWindow(nextStart, nextEnd)) throw new RangeError('endedAt must be at or after startedAt')

  const data: Record<string, unknown> = { correctedBy: managerId, correctedAt: now, updatedAt: now }
  if (body.startedAt !== undefined) data.startedAt = body.startedAt
  if (body.endedAt !== undefined) {
    data.endedAt = body.endedAt
    // Re-opening (endedAt -> null) flips status back to active; setting an end closes it.
    data.status = body.endedAt == null ? 'active' : 'ended'
  }
  if (body.note !== undefined) data.note = body.note

  return db.shift.update({ where: { id: shiftId }, data })
}

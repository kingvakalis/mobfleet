import type { FastifyInstance } from 'fastify'
import { can } from '../../../src/lib/authorization/effective-access'
import { actor, ctx, requirePermission } from '../auth/context'
import { logAudit } from '../auth/db'
import { HttpError, badRequest, forbidden, notFound } from '../http-error'
import {
  startShiftBody,
  endShiftBody,
  correctShiftBody,
  historyQuery,
  startShift,
  endShift,
  currentShift,
  getShift,
  listShifts,
  correctShift,
  parseShiftCursor,
  toShiftRecord,
} from '../shifts'

/**
 * Team-scoped shift / time-tracking API.
 *
 * AUTH model:
 *  - A member always manages their OWN shift (start/end/current) — no extra permission
 *    beyond an authenticated team membership (the clock-in/out is a self action).
 *  - Reading ANOTHER user's shift data (history for a specific userId, or the team-wide
 *    feed) requires `team.view_all_shifts`.
 *  - Corrections (editing start/end/note) require `team.manage_shifts`.
 *
 * Every query is anchored on ctx().teamId; per-id reads/writes are team-scoped via
 * findFirst({id,teamId}) so a foreign id 404s. No NEW permission keys are added.
 *
 *   POST /v1/shifts/start          -> { shift, created }                 (self)
 *   POST /v1/shifts/end            -> { shift }                          (self)
 *   GET  /v1/shifts/current        -> { shift: ShiftRecord | null }      (self)
 *   GET  /v1/shifts/history        -> { shifts, nextCursor }             (self; ?userId / all → team.view_all_shifts)
 *   POST /v1/shifts/:id/correction -> { shift }                          (team.manage_shifts)
 */
export function registerShiftsRoutes(app: FastifyInstance) {
  // Clock in (self). Idempotent: returns the existing active shift if one is open.
  app.post('/v1/shifts/start', async (req) => {
    const c = ctx(req)
    const body = startShiftBody.parse(req.body ?? {})
    let result
    try {
      result = await startShift(c.teamId, c.userId, body, Date.now())
    } catch {
      throw new HttpError(500, 'could not start shift')
    }
    if (result.created) {
      await logAudit({ teamId: c.teamId, actorId: c.userId, action: 'shift.start', target: result.shift.id, result: 'allowed' })
    }
    return { shift: toShiftRecord(result.shift), created: result.created }
  })

  // Clock out (self). 404 when there is no open shift; re-ending is a no-op upstream.
  app.post('/v1/shifts/end', async (req) => {
    const c = ctx(req)
    const body = endShiftBody.parse(req.body ?? {})
    let result
    try {
      result = await endShift(c.teamId, c.userId, body, Date.now())
    } catch {
      throw new HttpError(500, 'could not end shift')
    }
    if (!result.shift) throw notFound('no active shift to end')
    await logAudit({ teamId: c.teamId, actorId: c.userId, action: 'shift.end', target: result.shift.id, result: 'allowed' })
    return { shift: toShiftRecord(result.shift) }
  })

  // The caller's own currently-open shift (or null).
  app.get('/v1/shifts/current', async (req) => {
    const c = ctx(req)
    const row = await currentShift(c.teamId, c.userId)
    return { shift: row ? toShiftRecord(row) : null }
  })

  // Paginated history. Self by default; a specific ?userId other than the caller, or an
  // explicit all=true team-wide feed, requires team.view_all_shifts.
  app.get('/v1/shifts/history', async (req) => {
    const c = ctx(req)
    const q = historyQuery.parse((req.query ?? {}) as Record<string, unknown>)
    const all = (req.query as { all?: unknown } | undefined)?.all === 'true'

    let userFilter: string | undefined = c.userId
    if (all) {
      requirePermission(req, 'team.view_all_shifts')
      userFilter = undefined // whole team
    } else if (q.userId && q.userId !== c.userId) {
      if (!can(actor(req), 'team.view_all_shifts')) throw forbidden("missing permission: team.view_all_shifts")
      userFilter = q.userId
    }

    const limit = q.limit ?? 50
    const cursor = parseShiftCursor(q.cursor)
    const { shifts, nextCursor } = await listShifts(c.teamId, { limit, cursor, userId: userFilter })
    return { shifts: shifts.map(toShiftRecord), nextCursor }
  })

  // Manager correction of a shift's start/end/note. team.manage_shifts; team-scoped.
  app.post('/v1/shifts/:id/correction', async (req) => {
    requirePermission(req, 'team.manage_shifts')
    const c = ctx(req)
    const shiftId = (req.params as { id: string }).id
    const body = correctShiftBody.parse(req.body)

    // Confirm the shift exists in THIS team before correcting (404 conceals cross-tenant).
    const existing = await getShift(c.teamId, shiftId)
    if (!existing) throw notFound('shift not found')

    let row
    try {
      row = await correctShift(c.teamId, shiftId, c.userId, body, Date.now())
    } catch (e) {
      if (e instanceof RangeError) throw badRequest(e.message)
      throw new HttpError(500, 'could not correct shift')
    }
    if (!row) throw notFound('shift not found')
    await logAudit({
      teamId: c.teamId,
      actorId: c.userId,
      action: 'shift.correction',
      target: shiftId,
      result: 'allowed',
      detail: Object.keys(body).join(','),
    })
    return { shift: toShiftRecord(row) }
  })
}

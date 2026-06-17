import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  startShiftBody,
  correctShiftBody,
  historyQuery,
  isValidShiftWindow,
  isUniqueViolation,
  parseShiftCursor,
  toShiftRecord,
  startShift,
  endShift,
  listShifts,
  correctShift,
  type ShiftRow,
  type ShiftsDb,
  type ShiftsTx,
} from './shifts'

const row = (over: Partial<ShiftRow> = {}): ShiftRow => ({
  id: 'shift_1', teamId: 'team-1', userId: 'user-1', startedAt: 1000, endedAt: null,
  status: 'active', correctedBy: null, correctedAt: null, note: null, createdAt: 1000, updatedAt: 1000, ...over,
})

// ── Pure helpers ──────────────────────────────────────────────────────────────
test('toShiftRecord derives durationMs only when ended', () => {
  assert.equal(toShiftRecord(row({ startedAt: 100, endedAt: null })).durationMs, null)
  assert.equal(toShiftRecord(row({ startedAt: 100, endedAt: 400 })).durationMs, 300)
})

test('isValidShiftWindow: end must be >= start; null end is always valid', () => {
  assert.equal(isValidShiftWindow(100, 200), true)
  assert.equal(isValidShiftWindow(100, 100), true)
  assert.equal(isValidShiftWindow(200, 100), false)
  assert.equal(isValidShiftWindow(100, null), true)
})

test('isUniqueViolation recognizes a P2002 code only', () => {
  assert.equal(isUniqueViolation({ code: 'P2002' }), true)
  assert.equal(isUniqueViolation({ code: 'P2025' }), false)
  assert.equal(isUniqueViolation(new Error('x')), false)
  assert.equal(isUniqueViolation(null), false)
})

test('parseShiftCursor parses a numeric cursor or returns undefined', () => {
  assert.equal(parseShiftCursor('1700000000000'), 1700000000000)
  assert.equal(parseShiftCursor(undefined), undefined)
  assert.equal(parseShiftCursor('abc'), undefined)
})

// ── Zod ─────────────────────────────────────────────────────────────────────
test('startShiftBody accepts empty/optional note', () => {
  assert.equal(startShiftBody.safeParse({}).success, true)
  assert.equal(startShiftBody.safeParse({ note: 'x'.repeat(501) }).success, false)
})

test('correctShiftBody requires at least one field and validates types', () => {
  assert.equal(correctShiftBody.safeParse({}).success, false)
  assert.equal(correctShiftBody.safeParse({ note: 'fix' }).success, true)
  assert.equal(correctShiftBody.safeParse({ endedAt: null }).success, true)
  assert.equal(correctShiftBody.safeParse({ startedAt: -5 }).success, false)
})

test('historyQuery coerces limit and clamps the range', () => {
  assert.equal(historyQuery.safeParse({ limit: '50' }).success, true)
  assert.equal(historyQuery.safeParse({ limit: '0' }).success, false)
  assert.equal(historyQuery.safeParse({ limit: '999' }).success, false)
})

// ── Fake DB ─────────────────────────────────────────────────────────────────
function fakeDb(seed: ShiftRow[] = []): ShiftsDb & { rows: ShiftRow[] } {
  const rows = [...seed]
  const tx: ShiftsTx = {
    shift: {
      async findFirst(args: unknown) {
        const w = (args as { where: Partial<ShiftRow> }).where
        return rows.find((r) => Object.entries(w).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v)) ?? null
      },
      async findMany(args: unknown) {
        const a = args as { where: Record<string, unknown>; orderBy?: unknown; take?: number }
        let out = rows.filter((r) => {
          return Object.entries(a.where).every(([k, v]) => {
            if (v && typeof v === 'object' && 'lt' in (v as object)) return (r as unknown as Record<string, number>)[k] < (v as { lt: number }).lt
            return (r as unknown as Record<string, unknown>)[k] === v
          })
        })
        out = out.sort((x, y) => y.startedAt - x.startedAt)
        return a.take ? out.slice(0, a.take) : out
      },
      async create(args: unknown) { const r = (args as { data: ShiftRow }).data; rows.push(r); return r },
      async update(args: unknown) {
        const { where, data } = args as { where: { id: string }; data: Partial<ShiftRow> }
        const r = rows.find((x) => x.id === where.id)!
        Object.assign(r, data)
        return r
      },
    },
  }
  return { rows, ...tx, async $transaction(fn) { return fn(tx) } }
}

// ── startShift idempotency ────────────────────────────────────────────────────
test('startShift opens a new shift when none is active', async () => {
  const db = fakeDb()
  const { shift, created } = await startShift('team-1', 'user-1', {}, 5000, db)
  assert.equal(created, true)
  assert.equal(shift.status, 'active')
  assert.equal(shift.startedAt, 5000)
  assert.equal(db.rows.length, 1)
})

test('startShift is idempotent — returns the existing active shift, never a 2nd', async () => {
  const db = fakeDb([row({ id: 'shift_open' })])
  const { shift, created } = await startShift('team-1', 'user-1', {}, 9000, db)
  assert.equal(created, false)
  assert.equal(shift.id, 'shift_open')
  assert.equal(db.rows.length, 1) // no second active shift
})

test('startShift P2002 fallback returns the racing winner active shift', async () => {
  // A db whose create throws P2002 but whose findFirst (post-throw) finds an active row.
  const winner = row({ id: 'shift_winner' })
  const db: ShiftsDb = {
    shift: {
      async findFirst() { return winner }, // post-throw re-read
      async findMany() { return [] },
      async create() { throw { code: 'P2002' } },
      async update(a: unknown) { return (a as { data: ShiftRow }).data },
    },
    async $transaction(fn) {
      // Inside the tx, pretend no open shift was seen (lost the read race), then create throws.
      const txEmpty: ShiftsTx = {
        shift: {
          async findFirst() { return null },
          async findMany() { return [] },
          async create() { throw { code: 'P2002' } },
          async update(a: unknown) { return (a as { data: ShiftRow }).data },
        },
      }
      return fn(txEmpty)
    },
  }
  const { shift, created } = await startShift('team-1', 'user-1', {}, 1, db)
  assert.equal(created, false)
  assert.equal(shift.id, 'shift_winner')
})

// ── endShift ─────────────────────────────────────────────────────────────────
test('endShift closes the active shift', async () => {
  const db = fakeDb([row({ id: 'shift_open', startedAt: 1000 })])
  const { shift, ended } = await endShift('team-1', 'user-1', {}, 4000, db)
  assert.equal(ended, true)
  assert.equal(shift!.status, 'ended')
  assert.equal(shift!.endedAt, 4000)
})

test('endShift with no open shift is a no-op (ended:false)', async () => {
  const db = fakeDb([row({ id: 'shift_done', status: 'ended', endedAt: 2000 })])
  const { shift, ended } = await endShift('team-1', 'user-1', {}, 4000, db)
  assert.equal(ended, false)
  assert.equal(shift, null)
})

// ── listShifts pagination + team scope ───────────────────────────────────────
test('listShifts paginates newest-first and emits a nextCursor', async () => {
  const db = fakeDb([
    row({ id: 's1', startedAt: 100 }), row({ id: 's2', startedAt: 200 }), row({ id: 's3', startedAt: 300 }),
  ])
  const page1 = await listShifts('team-1', { limit: 2 }, db)
  assert.deepEqual(page1.shifts.map((s) => s.id), ['s3', 's2'])
  assert.equal(page1.nextCursor, 200)
  const page2 = await listShifts('team-1', { limit: 2, cursor: page1.nextCursor! }, db)
  assert.deepEqual(page2.shifts.map((s) => s.id), ['s1'])
  assert.equal(page2.nextCursor, null)
})

test('listShifts is team- and user-scoped', async () => {
  const db = fakeDb([
    row({ id: 'a', teamId: 'team-1', userId: 'user-1', startedAt: 1 }),
    row({ id: 'b', teamId: 'team-1', userId: 'user-2', startedAt: 2 }),
    row({ id: 'c', teamId: 'team-2', userId: 'user-1', startedAt: 3 }),
  ])
  const mine = await listShifts('team-1', { limit: 10, userId: 'user-1' }, db)
  assert.deepEqual(mine.shifts.map((s) => s.id), ['a'])
  const teamWide = await listShifts('team-1', { limit: 10 }, db)
  assert.deepEqual(teamWide.shifts.map((s) => s.id).sort(), ['a', 'b']) // team-2 excluded
})

// ── correctShift ─────────────────────────────────────────────────────────────
test('correctShift stamps correctedBy/At and updates the window', async () => {
  const db = fakeDb([row({ id: 'shift_c', startedAt: 1000, endedAt: 2000, status: 'ended' })])
  const out = await correctShift('team-1', 'shift_c', 'mgr-1', { startedAt: 1100, endedAt: 2100 }, 9999, db)
  assert.equal(out!.startedAt, 1100)
  assert.equal(out!.endedAt, 2100)
  assert.equal(out!.correctedBy, 'mgr-1')
  assert.equal(out!.correctedAt, 9999)
})

test('correctShift returns null for an id not in the team (404 upstream)', async () => {
  const db = fakeDb([row({ id: 'shift_c', teamId: 'team-OTHER' })])
  const out = await correctShift('team-1', 'shift_c', 'mgr-1', { note: 'x' }, 1, db)
  assert.equal(out, null)
})

test('correctShift throws RangeError when the resulting window is invalid', async () => {
  const db = fakeDb([row({ id: 'shift_c', startedAt: 1000, endedAt: 2000 })])
  await assert.rejects(() => correctShift('team-1', 'shift_c', 'mgr-1', { endedAt: 500 }, 1, db), RangeError)
})

test('correctShift re-opening (endedAt:null) flips status back to active', async () => {
  const db = fakeDb([row({ id: 'shift_c', startedAt: 1000, endedAt: 2000, status: 'ended' })])
  const out = await correctShift('team-1', 'shift_c', 'mgr-1', { endedAt: null }, 1, db)
  assert.equal(out!.status, 'active')
  assert.equal(out!.endedAt, null)
})

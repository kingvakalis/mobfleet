import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PrismaClient } from '@prisma/client'
import {
  startShift,
  endShift,
  currentShift,
  listShifts,
  correctShift,
  type ShiftsDb,
} from './shifts'
import { itSkip, testDb, resetDb, seedUser, seedMembership } from './it-support'

/**
 * PostgreSQL integration tests for shifts. DOUBLE-GATED on itSkip + the proposed
 * `Shift` table existing (skips until the lead adds the model). Drives the logic
 * through the injectable port. Exercises the one-active-shift invariant + team scope.
 * Run via `npm run test:it`.
 */

async function tableExists(db: PrismaClient, table: string): Promise<boolean> {
  try {
    const rows = await db.$queryRawUnsafe<{ exists: boolean }[]>(`SELECT to_regclass('"${table}"') IS NOT NULL AS exists`)
    return Boolean(rows[0]?.exists)
  } catch {
    return false
  }
}

let present: boolean | null = null
async function skipReason(): Promise<false | string> {
  if (itSkip) return itSkip
  if (present === null) present = await tableExists(testDb(), 'Shift')
  return present ? false : 'Shift model not yet in the schema (see PROPOSALS.md)'
}

const port = (): ShiftsDb => testDb() as unknown as ShiftsDb

test('shifts: start is idempotent (one active per user), end closes it', async (t) => {
  const reason = await skipReason()
  if (reason) return t.skip(reason)
  const db = testDb(); await resetDb(db)
  await db.$executeRawUnsafe('TRUNCATE TABLE "Shift" CASCADE').catch(() => {})
  const u = await seedUser(db)
  const { team } = await seedMembership(db, u.id)

  const a = await startShift(team.id, u.id, {}, Date.now(), port())
  assert.equal(a.created, true)
  const b = await startShift(team.id, u.id, {}, Date.now(), port())
  assert.equal(b.created, false) // existing active shift returned, not a 2nd
  assert.equal(a.shift.id, b.shift.id)

  assert.equal((await currentShift(team.id, u.id, port()))?.id, a.shift.id)

  const ended = await endShift(team.id, u.id, {}, Date.now(), port())
  assert.equal(ended.ended, true)
  assert.equal(ended.shift?.status, 'ended')

  // Re-end is a no-op now that no active shift exists.
  assert.equal((await endShift(team.id, u.id, {}, Date.now(), port())).ended, false)

  // After ending, a new start opens a fresh shift.
  assert.equal((await startShift(team.id, u.id, {}, Date.now(), port())).created, true)
})

test('shifts: history is team/user scoped; corrections are team-scoped + stamped', async (t) => {
  const reason = await skipReason()
  if (reason) return t.skip(reason)
  const db = testDb(); await resetDb(db)
  await db.$executeRawUnsafe('TRUNCATE TABLE "Shift" CASCADE').catch(() => {})
  const u1 = await seedUser(db); const u2 = await seedUser(db)
  const { team } = await seedMembership(db, u1.id)
  await seedMembership(db, u2.id, { teamName: 'Other' })

  const s1 = await startShift(team.id, u1.id, {}, 1000, port()); await endShift(team.id, u1.id, {}, 2000, port())

  const mine = await listShifts(team.id, { limit: 10, userId: u1.id }, port())
  assert.equal(mine.shifts.length, 1)

  // Correct s1's window; correctedBy/At are stamped.
  const corrected = await correctShift(team.id, s1.shift.id, u1.id, { endedAt: 3000 }, 9999, port())
  assert.equal(corrected?.endedAt, 3000)
  assert.equal(corrected?.correctedBy, u1.id)

  // A foreign team can't correct it.
  const otherTeam = await seedMembership(db, (await seedUser(db)).id)
  assert.equal(await correctShift(otherTeam.team.id, s1.shift.id, u1.id, { note: 'x' }, 1, port()), null)
})

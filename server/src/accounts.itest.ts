import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PrismaClient } from '@prisma/client'
import {
  listAccounts,
  getAccount,
  createAccount,
  updateAccount,
  deleteAccount,
  importAccounts,
  type AccountsDb,
} from './accounts'
import { itSkip, testDb, resetDb, seedUser, seedMembership } from './it-support'

/**
 * PostgreSQL integration tests for the Account vault. DOUBLE-GATED:
 *  1. itSkip — TEST_DATABASE_URL must be set (the shared harness gate).
 *  2. accountTableExists() — the proposed `Account` table must exist in the schema
 *     (the lead hasn't added the model yet → these skip cleanly until then).
 *
 * The generated Prisma client has no `account` delegate yet, so we drive the logic
 * functions through the same injectable port the routes use, casting testDb() to it.
 * Run via `npm run test:it`.
 */

async function tableExists(db: PrismaClient, table: string): Promise<boolean> {
  try {
    const rows = await db.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT to_regclass('"${table}"') IS NOT NULL AS exists`,
    )
    return Boolean(rows[0]?.exists)
  } catch {
    return false
  }
}

let accountTablePresent: boolean | null = null
async function skipReason(): Promise<false | string> {
  if (itSkip) return itSkip
  if (accountTablePresent === null) accountTablePresent = await tableExists(testDb(), 'Account')
  return accountTablePresent ? false : 'Account model not yet in the schema (see PROPOSALS.md)'
}

const port = (): AccountsDb => testDb() as unknown as AccountsDb

test('accounts: create / read / update / delete are team-scoped', async (t) => {
  const reason = await skipReason()
  if (reason) return t.skip(reason)
  const db = testDb(); await resetDb(db)
  await db.$executeRawUnsafe('TRUNCATE TABLE "Account" CASCADE').catch(() => {})
  const u = await seedUser(db)
  const { team } = await seedMembership(db, u.id)
  const other = await seedMembership(db, (await seedUser(db)).id)

  const created = await createAccount(team.id, { handle: '@a', platform: 'Instagram', username: 'acme', email: 'a@x.com', password: 'secret' }, Date.now(), port())
  assert.equal(created.teamId, team.id)

  const read = await getAccount(team.id, created.id, port())
  assert.equal(read?.id, created.id)

  // Cross-team read is impossible (findFirst on {id, teamId}).
  assert.equal(await getAccount(other.team.id, created.id, port()), null)

  const updated = await updateAccount(team.id, created.id, { status: 'banned' }, Date.now(), port())
  assert.equal(updated?.status, 'banned')

  // Cross-team update returns null (not found in that team).
  assert.equal(await updateAccount(other.team.id, created.id, { status: 'active' }, Date.now(), port()), null)

  const list = await listAccounts(team.id, port())
  assert.equal(list.length, 1)

  assert.equal(await deleteAccount(team.id, created.id, port()), true)
  assert.equal(await deleteAccount(team.id, created.id, port()), false) // idempotent re-delete
})

test('accounts: import is idempotent on (teamId, username)', async (t) => {
  const reason = await skipReason()
  if (reason) return t.skip(reason)
  const db = testDb(); await resetDb(db)
  await db.$executeRawUnsafe('TRUNCATE TABLE "Account" CASCADE').catch(() => {})
  const u = await seedUser(db)
  const { team } = await seedMembership(db, u.id)

  const payload = { accounts: [{ handle: '@a', platform: 'Instagram' as const, username: 'dup', email: 'a@x.com' }] }
  const first = await importAccounts(team.id, payload, Date.now(), port())
  assert.deepEqual(first, { created: 1, updated: 0, total: 1 })
  const second = await importAccounts(team.id, payload, Date.now(), port())
  assert.deepEqual(second, { created: 0, updated: 1, total: 1 }) // updated in place, no duplicate
  assert.equal((await listAccounts(team.id, port())).length, 1)
})

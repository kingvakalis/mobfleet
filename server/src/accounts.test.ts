import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createAccountBody,
  updateAccountBody,
  importAccountsBody,
  buildAccountCreateData,
  buildAccountUpdateData,
  toSafeAccount,
  importAccounts,
  type AccountRow,
  type AccountsDb,
  type CreateAccountBody,
} from './accounts'

const row = (over: Partial<AccountRow> = {}): AccountRow => ({
  id: 'acct_1', teamId: 'team-1', handle: '@acme', platform: 'Instagram', username: 'acme',
  email: 'a@b.com', password: 'super-secret', phone: null, assignedPhone: null,
  group: 'Unassigned', owner: 'Unassigned', twoFA: false, status: 'warming', tags: ['x'],
  followers: 0, notes: '', createdAt: 1, updatedAt: 1, ...over,
})

// ── toSafeAccount: never leaks the password ──────────────────────────────────
test('toSafeAccount reduces password to a boolean and never serializes it', () => {
  const safe = toSafeAccount(row({ password: 're_super_secret_pw' }))
  assert.equal(safe.hasPassword, true)
  assert.equal('password' in safe, false)
  assert.equal(JSON.stringify(safe).includes('re_super_secret_pw'), false)
  assert.deepEqual(safe.tags, ['x'])
})

test('toSafeAccount: null password → hasPassword false; non-array tags → []', () => {
  const safe = toSafeAccount(row({ password: null, tags: 'oops' as unknown as string[] }))
  assert.equal(safe.hasPassword, false)
  assert.deepEqual(safe.tags, [])
})

// ── buildAccountCreateData: defaults ─────────────────────────────────────────
test('buildAccountCreateData applies the documented defaults', () => {
  const body: CreateAccountBody = { handle: '@h', platform: 'TikTok', username: 'u', email: 'e@x.com' }
  const data = buildAccountCreateData('team-9', body, 1234)
  assert.equal(data.teamId, 'team-9')
  assert.equal(data.group, 'Unassigned')
  assert.equal(data.owner, 'Unassigned')
  assert.equal(data.status, 'warming')
  assert.equal(data.twoFA, false)
  assert.equal(data.followers, 0)
  assert.equal(data.notes, '')
  assert.equal(data.password, null)
  assert.deepEqual(data.tags, [])
  assert.equal(data.createdAt, 1234)
  assert.equal(data.updatedAt, 1234)
  assert.ok(String(data.id).startsWith('acct_'))
})

// ── buildAccountUpdateData: only present keys are written ─────────────────────
test('buildAccountUpdateData writes only present keys + updatedAt', () => {
  const data = buildAccountUpdateData({ status: 'banned' }, 999)
  assert.deepEqual(Object.keys(data).sort(), ['status', 'updatedAt'])
  assert.equal(data.status, 'banned')
  assert.equal(data.updatedAt, 999)
})

test('buildAccountUpdateData can clear nullable fields explicitly', () => {
  const data = buildAccountUpdateData({ phone: undefined }, 1)
  assert.equal('phone' in data, false) // undefined is treated as "absent", not "clear"
})

// ── Zod validation ───────────────────────────────────────────────────────────
test('createAccountBody accepts valid input and rejects bad platform/email', () => {
  assert.equal(createAccountBody.safeParse({ handle: 'h', platform: 'Instagram', username: 'u', email: 'e@x.com' }).success, true)
  assert.equal(createAccountBody.safeParse({ handle: 'h', platform: 'Facebook', username: 'u', email: 'e@x.com' }).success, false)
  assert.equal(createAccountBody.safeParse({ handle: 'h', platform: 'TikTok', username: 'u', email: 'nope' }).success, false)
  assert.equal(createAccountBody.safeParse({ handle: '', platform: 'TikTok', username: 'u', email: 'e@x.com' }).success, false)
})

test('updateAccountBody is fully partial', () => {
  assert.equal(updateAccountBody.safeParse({}).success, true)
  assert.equal(updateAccountBody.safeParse({ followers: -1 }).success, false)
})

test('importAccountsBody requires 1..1000 valid rows', () => {
  assert.equal(importAccountsBody.safeParse({ accounts: [] }).success, false)
  assert.equal(importAccountsBody.safeParse({ accounts: [{ handle: 'h', platform: 'TikTok', username: 'u', email: 'e@x.com' }] }).success, true)
})

// ── importAccounts: idempotent dedupe by (teamId, username) ───────────────────
function fakeDb(seed: AccountRow[] = []): AccountsDb & { rows: AccountRow[] } {
  const rows = [...seed]
  return {
    rows,
    account: {
      async findMany() { return rows },
      async findFirst(args: unknown) {
        const w = (args as { where: Partial<AccountRow> }).where
        return rows.find((r) => Object.entries(w).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v)) ?? null
      },
      async create(args: unknown) {
        const r = (args as { data: AccountRow }).data
        rows.push(r)
        return r
      },
      async update(args: unknown) {
        const { where, data } = args as { where: { id: string }; data: Partial<AccountRow> }
        const r = rows.find((x) => x.id === where.id)!
        Object.assign(r, data)
        return r
      },
      async delete(args: unknown) {
        const id = (args as { where: { id: string } }).where.id
        const i = rows.findIndex((x) => x.id === id)
        const [r] = rows.splice(i, 1)
        return r
      },
    },
  }
}

test('importAccounts: new usernames create, existing usernames update (idempotent)', async () => {
  const db = fakeDb([row({ id: 'acct_x', username: 'existing', status: 'warming' })])
  const first = await importAccounts('team-1', {
    accounts: [
      { handle: 'h', platform: 'Instagram', username: 'existing', email: 'e@x.com', status: 'banned' },
      { handle: 'h', platform: 'TikTok', username: 'brand-new', email: 'n@x.com' },
    ],
  }, 100, db)
  assert.deepEqual(first, { created: 1, updated: 1, total: 2 })
  assert.equal(db.rows.find((r) => r.username === 'existing')!.status, 'banned') // updated in place

  // Re-running the SAME import creates nothing new (idempotent on (teamId, username)).
  const second = await importAccounts('team-1', {
    accounts: [
      { handle: 'h', platform: 'Instagram', username: 'existing', email: 'e@x.com', status: 'banned' },
      { handle: 'h', platform: 'TikTok', username: 'brand-new', email: 'n@x.com' },
    ],
  }, 200, db)
  assert.deepEqual(second, { created: 0, updated: 2, total: 2 })
  assert.equal(db.rows.filter((r) => r.username === 'brand-new').length, 1) // no duplicate
})

test('importAccounts collapses intra-payload duplicate usernames (last wins)', async () => {
  const db = fakeDb()
  const res = await importAccounts('team-1', {
    accounts: [
      { handle: 'h', platform: 'Instagram', username: 'dup', email: 'e@x.com', status: 'warming' },
      { handle: 'h', platform: 'TikTok', username: 'dup', email: 'e@x.com', status: 'active' },
    ],
  }, 1, db)
  assert.deepEqual(res, { created: 1, updated: 0, total: 1 })
  assert.equal(db.rows.filter((r) => r.username === 'dup').length, 1)
  assert.equal(db.rows.find((r) => r.username === 'dup')!.status, 'active') // last wins
})

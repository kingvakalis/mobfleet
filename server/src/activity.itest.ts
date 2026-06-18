import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { listActivity, parseActivityQuery } from './activity'
import { itSkip, testDb, resetDb, seedUser, seedMembership } from './it-support'

// PostgreSQL integration tests for the Activity read API. Run via `npm run test:it`;
// skips when TEST_DATABASE_URL is unset. AuditLog is cleared by resetDb's TRUNCATE
// ... CASCADE (it cascades from Team).

function seedAudit(db: PrismaClient, teamId: string, actorId: string, action: string, createdAt: number) {
  return db.auditLog.create({ data: { id: `aud_${randomUUID()}`, teamId, actorId, action, result: 'allowed', createdAt } })
}

test('listActivity: newest-first, resolves the actor email/name, paginates with a cursor', { skip: itSkip }, async () => {
  const db = testDb(); await resetDb(db)
  const u = await seedUser(db, { email: 'actor@acme.com', name: 'Actor' })
  const { team } = await seedMembership(db, u.id, { teamName: 'Acme' })
  await seedAudit(db, team.id, u.id, 'invite.create', 1000)
  await seedAudit(db, team.id, u.id, 'invite.revoke', 2000)
  await seedAudit(db, team.id, u.id, 'role.change', 3000)

  const page1 = await listActivity(team.id, parseActivityQuery({ limit: '2' }), db)
  assert.equal(page1.items.length, 2)
  assert.equal(page1.items[0].action, 'role.change') // newest first
  assert.equal(page1.items[1].action, 'invite.revoke')
  assert.equal(page1.items[0].actorEmail, 'actor@acme.com')
  assert.equal(page1.items[0].actorName, 'Actor')
  assert.ok(page1.nextCursor)

  const page2 = await listActivity(team.id, parseActivityQuery({ limit: '2', cursor: page1.nextCursor as string }), db)
  assert.equal(page2.items.length, 1)
  assert.equal(page2.items[0].action, 'invite.create')
  assert.equal(page2.nextCursor, null)
})

test('listActivity: STRICTLY team-scoped — one team never sees another team\'s audit rows', { skip: itSkip }, async () => {
  const db = testDb(); await resetDb(db)
  const a = await seedUser(db, { email: 'a@x.com' })
  const b = await seedUser(db, { email: 'b@y.com' })
  const teamA = (await seedMembership(db, a.id, { teamName: 'A' })).team
  const teamB = (await seedMembership(db, b.id, { teamName: 'B' })).team
  await seedAudit(db, teamA.id, a.id, 'invite.create', 1000)
  await seedAudit(db, teamB.id, b.id, 'invite.create', 1000)

  const listA = await listActivity(teamA.id, parseActivityQuery({}), db)
  const listB = await listActivity(teamB.id, parseActivityQuery({}), db)
  assert.equal(listA.items.length, 1)
  assert.equal(listB.items.length, 1)
  assert.notEqual(listA.items[0].id, listB.items[0].id) // disjoint rows, no leakage
})

test('listActivity: same-millisecond rows paginate deterministically via the id tiebreaker (no dupes/skips)', { skip: itSkip }, async () => {
  const db = testDb(); await resetDb(db)
  const u = await seedUser(db)
  const { team } = await seedMembership(db, u.id)
  await seedAudit(db, team.id, u.id, 'a.one', 5000)
  await seedAudit(db, team.id, u.id, 'a.two', 5000)
  await seedAudit(db, team.id, u.id, 'a.three', 5000)

  const seen = new Set<string>()
  let cursor: string | null = null
  let guard = 0
  do {
    const page = await listActivity(team.id, parseActivityQuery({ limit: '1', cursor: cursor ?? undefined }), db)
    for (const it of page.items) {
      assert.equal(seen.has(it.id), false, 'no duplicate row across pages')
      seen.add(it.id)
    }
    cursor = page.nextCursor
    guard++
  } while (cursor && guard < 10)
  assert.equal(seen.size, 3) // every row visited exactly once
})

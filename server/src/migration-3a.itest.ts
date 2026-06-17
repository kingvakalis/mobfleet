import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { itSkip, testDb, resetDb, seedUser } from './it-support'

// PostgreSQL integration tests for the Step 3A schema migration
// (20260616120000_add_migration_mapping_and_audit_schema): proves the new
// columns/table the migration produces are present and behave correctly against a
// real Postgres. Run via `npm run test:it` with TEST_DATABASE_URL pointed at a
// DISPOSABLE database that has the post-3A schema applied (`prisma db push` /
// `migrate deploy`); skips cleanly when TEST_DATABASE_URL is unset.

test('Team.supabaseTeamId + archivedAt: round-trip; supabaseTeamId is unique; both nullable', { skip: itSkip }, async () => {
  const db = testDb(); await resetDb(db)
  const supaId = randomUUID()
  const mapped = await db.team.create({ data: { id: `team_${randomUUID()}`, name: 'Mapped', createdAt: Date.now(), supabaseTeamId: supaId } })
  assert.equal(mapped.supabaseTeamId, supaId)
  assert.equal(mapped.archivedAt, null)

  // Native team: both new columns default to null (unaffected by the migration).
  const native = await db.team.create({ data: { id: `team_${randomUUID()}`, name: 'Native', createdAt: Date.now() } })
  assert.equal(native.supabaseTeamId, null)

  // Archive is a reversible timestamp marker.
  const archived = await db.team.update({ where: { id: native.id }, data: { archivedAt: Date.now() } })
  assert.ok(typeof archived.archivedAt === 'number' && archived.archivedAt > 0)

  // supabaseTeamId is @unique → a second team can't claim the same Supabase id.
  await assert.rejects(
    db.team.create({ data: { id: `team_${randomUUID()}`, name: 'Dup', createdAt: Date.now(), supabaseTeamId: supaId } }),
    /Unique constraint|P2002/,
  )
  // …but multiple nulls are allowed (Postgres unique ignores NULLs).
  await db.team.create({ data: { id: `team_${randomUUID()}`, name: 'Native2', createdAt: Date.now() } })
  assert.equal(await db.team.count({ where: { supabaseTeamId: null } }), 2)
})

test('Invite.invitedByUserId is now nullable (migrated invite with no inviter) and still works with an inviter', { skip: itSkip }, async () => {
  const db = testDb(); await resetDb(db)
  const team = await db.team.create({ data: { id: `team_${randomUUID()}`, name: 'T', createdAt: Date.now(), supabaseTeamId: randomUUID() } })

  // Migrated invite with a null inviter (the migration must not invent a wrong user).
  const orphan = await db.invite.create({
    data: { id: `inv_${randomUUID()}`, teamId: team.id, email: 'a@test.local', role: 'operator', token: randomUUID(), status: 'pending', invitedByUserId: null, createdAt: Date.now(), expiresAt: Date.now() + 1000 },
  })
  assert.equal(orphan.invitedByUserId, null)

  // App-created invite with a real inviter still round-trips.
  const inviter = await seedUser(db)
  const withInviter = await db.invite.create({
    data: { id: `inv_${randomUUID()}`, teamId: team.id, email: 'b@test.local', role: 'admin', token: randomUUID(), status: 'pending', invitedByUserId: inviter.id, createdAt: Date.now(), expiresAt: Date.now() + 1000 },
  })
  assert.equal(withInviter.invitedByUserId, inviter.id)

  // Deleting the inviter SET NULLs the invite's FK (ON DELETE SET NULL) — invite survives.
  await db.user.delete({ where: { id: inviter.id } })
  const after = await db.invite.findUnique({ where: { id: withInviter.id } })
  assert.equal(after?.invitedByUserId, null)
})

test('MigrationRecord: stores batch/entity/action + before/after JSON + status/error and is queryable by batch', { skip: itSkip }, async () => {
  const db = testDb(); await resetDb(db)
  await db.migrationRecord.deleteMany({})
  const batchId = `batch_${randomUUID()}`
  await db.migrationRecord.create({
    data: { id: `mr_${randomUUID()}`, batchId, entity: 'team', action: 'create', supabaseId: randomUUID(), prismaId: `team_${randomUUID()}`, before: undefined, after: { name: 'Acme' }, status: 'ok', createdAt: Date.now() },
  })
  await db.migrationRecord.create({
    data: { id: `mr_${randomUUID()}`, batchId, entity: 'membership', action: 'update', prismaId: `mem_x`, before: { role: 'viewer' }, after: { role: 'admin' }, status: 'ok', createdAt: Date.now() },
  })
  await db.migrationRecord.create({
    data: { id: `mr_${randomUUID()}`, batchId, entity: 'team', action: 'archive', prismaId: `team_y`, before: { archivedAt: null }, after: { archivedAt: 1 }, status: 'error', error: 'demo', createdAt: Date.now() },
  })

  const rows = await db.migrationRecord.findMany({ where: { batchId }, orderBy: { createdAt: 'asc' } })
  assert.equal(rows.length, 3)
  const archive = rows.find((r) => r.action === 'archive')
  assert.deepEqual(archive?.before, { archivedAt: null })
  assert.deepEqual(archive?.after, { archivedAt: 1 })
  assert.equal(archive?.status, 'error')
  assert.equal(archive?.error, 'demo')
  // `status` defaults to 'ok' when omitted.
  const dflt = await db.migrationRecord.create({ data: { id: `mr_${randomUUID()}`, batchId, entity: 'user', action: 'create', createdAt: Date.now() } })
  assert.equal(dflt.status, 'ok')
})

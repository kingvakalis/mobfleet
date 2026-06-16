import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Client } from 'pg'
import { testDb, resetDb } from '../it-support'
import { readSourceSnapshot } from './source'
import { readTargetSnapshot } from './target'
import { analyze } from './analyze'

/**
 * End-to-end integration test for the read-only migration inventory against DISPOSABLE
 * seeded source + target Postgres databases. Proves: the REPEATABLE READ READ ONLY source
 * snapshot, DMMF-driven child counting, artifact classification, blocker detection, and that
 * BOTH databases are logically unchanged by the dry run.
 *
 * Run via `npm run test:it` with:
 *   TEST_DATABASE_URL    disposable Prisma target (post-3A schema applied)
 *   TEST_SOURCE_DB_URL   disposable Supabase-shaped source
 * Skips cleanly when either is unset.
 */
const SRC_URL = process.env.TEST_SOURCE_DB_URL
const skip: false | string = process.env.TEST_DATABASE_URL && SRC_URL ? false : 'set TEST_DATABASE_URL and TEST_SOURCE_DB_URL'

const J0 = '2024-01-01T00:00:00Z' // source join time (early)
const TLATE = Date.parse('2024-06-01T00:00:00Z') // artifact team createdAt (later)

async function seedSource(url: string): Promise<void> {
  const c = new Client({ connectionString: url })
  await c.connect()
  try {
    await c.query('DROP SCHEMA IF EXISTS auth CASCADE')
    await c.query('CREATE SCHEMA auth')
    await c.query('CREATE TABLE auth.users (id text primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb, created_at timestamptz)')
    await c.query('DROP TABLE IF EXISTS public.team_invites, public.team_members, public.teams CASCADE')
    await c.query('CREATE TABLE public.teams (id text primary key, name text not null, owner_user_id text, created_at timestamptz)')
    await c.query('CREATE TABLE public.team_members (id text primary key, team_id text, user_id text, role text, status text, email text, name text, invited_by text, scope_type text, scope_groups jsonb, scope_phones jsonb, overrides jsonb, joined_at timestamptz)')
    await c.query('CREATE TABLE public.team_invites (id text primary key, team_id text, email text, role text, token text, status text, invited_by text, created_at timestamptz, expires_at timestamptz, accepted_at timestamptz)')
    await c.query(`INSERT INTO auth.users (id,email,email_confirmed_at,raw_user_meta_data,created_at) VALUES
      ('auth_bob','bob@x.com', now(), '{"full_name":"Bob"}', $1),
      ('auth_alice','alice@x.com', now(), '{"name":"Alice"}', $1)`, [J0])
    await c.query(`INSERT INTO public.teams (id,name,owner_user_id,created_at) VALUES
      ('s_acme','Acme','auth_bob',$1), ('s_beta','Beta','auth_alice',$1)`, [J0])
    await c.query(`INSERT INTO public.team_members (id,team_id,user_id,role,status,email,name,invited_by,scope_type,scope_groups,scope_phones,overrides,joined_at) VALUES
      ('m1','s_acme','auth_bob','owner','active','bob@x.com','Bob',null,'workspace','[]','[]','{}',$1),
      ('m2','s_beta','auth_alice','owner','active','alice@x.com','Alice',null,'workspace','[]','[]','{}',$1)`, [J0])
    await c.query(`INSERT INTO public.team_invites (id,team_id,email,role,token,status,invited_by,created_at,expires_at,accepted_at) VALUES
      ('i1','s_acme','newhire@x.com','operator','tok_abcdef123456','pending',null,$1,$1,null)`, [J0])
  } finally {
    await c.end()
  }
}

/** Deterministic per-table content checksums (proves logical content is unchanged). */
async function sourceChecksums(url: string): Promise<Record<string, string>> {
  const c = new Client({ connectionString: url })
  await c.connect()
  try {
    const sums: Record<string, string> = {}
    for (const [k, tbl] of [['authUsers', 'auth.users'], ['teams', 'public.teams'], ['members', 'public.team_members'], ['invites', 'public.team_invites']] as const) {
      const row = (await c.query<{ sum: string }>(`SELECT coalesce(md5(string_agg(r::text, ',' ORDER BY r::text)), 'empty') AS sum FROM ${tbl} r`)).rows[0]
      sums[k] = row.sum
    }
    return sums
  } finally {
    await c.end()
  }
}

async function seedTarget(db: ReturnType<typeof testDb>): Promise<void> {
  await resetDb(db)
  await db.user.create({ data: { id: 'pu_bob', authProviderId: 'auth_bob', email: 'bob@x.com', createdAt: Date.now() } })
  await db.user.create({ data: { id: 'pu_alice', authProviderId: 'auth_alice', email: 'alice@x.com', createdAt: Date.now() } })
  await db.user.create({ data: { id: 'pu_ghost', authProviderId: 'ghost_not_in_source', email: 'ghost@x.com', createdAt: Date.now() } })
  // already-mapped team (idempotent), matching membership
  await db.team.create({ data: { id: 'pt_acme', name: 'Acme', createdAt: Date.now(), supabaseTeamId: 's_acme' } })
  await db.membership.create({ data: { id: 'pm_acme', userId: 'pu_bob', teamId: 'pt_acme', role: 'owner', status: 'active', scopeType: 'workspace', createdAt: Date.now() } })
  // artifact candidate (unmapped, owner migrated, name pattern, no children, created later)
  await db.team.create({ data: { id: 'pt_art', name: "bob's Workspace", createdAt: TLATE } })
  await db.membership.create({ data: { id: 'pm_art', userId: 'pu_bob', teamId: 'pt_art', role: 'owner', status: 'active', scopeType: 'workspace', createdAt: TLATE } })
  // native (unmapped but has a child record -> never archive)
  await db.team.create({ data: { id: 'pt_native', name: "alice's Workspace", createdAt: TLATE } })
  await db.membership.create({ data: { id: 'pm_native', userId: 'pu_alice', teamId: 'pt_native', role: 'owner', status: 'active', scopeType: 'workspace', createdAt: TLATE } })
  await db.deviceSession.create({ data: { id: 'ds1', teamId: 'pt_native', deviceId: 'd1', startedAt: Date.now() } })
  // unknown origin (unmapped, owner NOT migrated) -> blocker, never auto-archived
  await db.team.create({ data: { id: 'pt_unknown', name: 'Mystery', createdAt: TLATE } })
  await db.membership.create({ data: { id: 'pm_unknown', userId: 'pu_ghost', teamId: 'pt_unknown', role: 'owner', status: 'active', scopeType: 'workspace', createdAt: TLATE } })
}

async function targetCounts(db: ReturnType<typeof testDb>): Promise<Record<string, number>> {
  return {
    users: await db.user.count(), teams: await db.team.count(), memberships: await db.membership.count(),
    invites: await db.invite.count(), deviceSessions: await db.deviceSession.count(),
    migrationRecords: await db.migrationRecord.count(),
  }
}

test('inventory: end-to-end classification + plan + blockers against seeded source/target', { skip }, async () => {
  const db = testDb()
  await seedSource(SRC_URL!)
  await seedTarget(db)

  const source = await readSourceSnapshot(SRC_URL!)
  // The snapshot is provably repeatable-read + read-only.
  assert.equal(source.proof.isolation, 'repeatable read')
  assert.equal(source.proof.readOnly, true)
  assert.equal(source.authUsers.length, 2)
  assert.equal(source.teams.length, 2)
  assert.equal(source.members.length, 2)
  assert.equal(source.invites.length, 1)

  const target = await readTargetSnapshot(db)
  const report = analyze(source, target)

  // Plan
  assert.equal(report.plan.teamsAlreadyMapped, 1) // s_acme
  assert.equal(report.plan.teamsToCreate, 1) // s_beta
  assert.equal(report.plan.usersToCreate, 0) // bob + alice already in target
  assert.equal(report.plan.artifactsToArchive, 1) // pt_art

  // Artifact classification
  const cls = Object.fromEntries(report.artifacts.map((a) => [a.teamId, a.classification]))
  assert.equal(cls['pt_art'], 'auto_provision_candidate')
  assert.equal(cls['pt_native'], 'native')
  assert.equal(cls['pt_unknown'], 'unknown')
  assert.equal(target.childCountsByTeam['pt_native']['DeviceSession'], 1) // DMMF-driven child count

  // Blockers: the unknown-origin team blocks Phase 3C
  assert.equal(report.hasBlockers, true)
  assert.ok(report.blockers.some((f) => f.code === 'ARTIFACT_UNKNOWN_ORIGIN'))
  // Mapped membership matched -> no conflict; null inviter -> no missing-inviter finding
  assert.ok(!report.findings.some((f) => f.code === 'TGT_MEMBERSHIP_CONFLICT'))
  assert.ok(!report.findings.some((f) => f.code === 'IDENT_MISSING_INVITED_BY'))
})

test('inventory: dry run leaves SOURCE logically unchanged and TARGET row counts unchanged', { skip }, async () => {
  const db = testDb()
  await seedSource(SRC_URL!)
  await seedTarget(db)

  const srcBefore = await sourceChecksums(SRC_URL!)
  const tgtBefore = await targetCounts(db)

  // Run the read-only pipeline twice (idempotent re-inspection).
  const r1 = analyze(await readSourceSnapshot(SRC_URL!), await readTargetSnapshot(db))
  const r2 = analyze(await readSourceSnapshot(SRC_URL!), await readTargetSnapshot(db))

  const srcAfter = await sourceChecksums(SRC_URL!)
  const tgtAfter = await targetCounts(db)

  assert.deepEqual(srcAfter, srcBefore, 'source content must be byte-for-byte logically unchanged')
  assert.deepEqual(tgtAfter, tgtBefore, 'target row counts must be unchanged (no writes)')
  assert.equal(tgtAfter.migrationRecords, 0, 'no MigrationRecord rows are created during 3B')
  // Deterministic re-inspection
  assert.deepEqual(r1.counts, r2.counts)
  assert.deepEqual(r1.plan, r2.plan)
})

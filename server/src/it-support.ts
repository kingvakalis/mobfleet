import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

/**
 * Integration-test harness (PostgreSQL). Used ONLY by *.itest.ts (run via
 * `npm run test:it`), never by the pure `npm test` suite. Point TEST_DATABASE_URL
 * at a DISPOSABLE database — NEVER production — and apply the schema first
 * (`npx prisma db push`). When TEST_DATABASE_URL is unset, the integration tests
 * skip cleanly (itSkip), so this module never opens a connection in that case.
 */
const TEST_DB_URL = process.env.TEST_DATABASE_URL

/** node:test skip value: false → run; a reason string → skip. */
export const itSkip: false | string = TEST_DB_URL ? false : 'set TEST_DATABASE_URL to run integration tests'

let client: PrismaClient | undefined
export function testDb(): PrismaClient {
  if (!TEST_DB_URL) throw new Error('TEST_DATABASE_URL is not set')
  if (!client) client = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } })
  return client
}

/** Clear the entities these tests create (CASCADE clears dependent rows). */
export async function resetDb(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe('TRUNCATE TABLE "Invite", "Membership", "Team", "User" CASCADE')
}

/** Seed a User (the ensured profile) and return it in the FirstTeamUser shape. */
export async function seedUser(db: PrismaClient, over: { email?: string; name?: string | null } = {}) {
  const u = await db.user.create({
    data: {
      id: `user_${randomUUID()}`,
      authProviderId: `auth_${randomUUID()}`,
      email: over.email ?? `u-${randomUUID()}@test.local`,
      name: over.name ?? null,
      createdAt: Date.now(),
    },
  })
  return { id: u.id, email: u.email, name: u.name }
}

/** Seed a team + membership for `userId` (defaults: owner / active). */
export async function seedMembership(
  db: PrismaClient,
  userId: string,
  opts: { teamName?: string; role?: string; status?: string } = {},
) {
  const team = await db.team.create({ data: { id: `team_${randomUUID()}`, name: opts.teamName ?? 'Seeded', createdAt: Date.now() } })
  const membership = await db.membership.create({
    data: { id: `mem_${randomUUID()}`, userId, teamId: team.id, role: opts.role ?? 'owner', status: opts.status ?? 'active', createdAt: Date.now() },
  })
  return { team, membership }
}

/** Seed a pending (or expired) invite for an email, with its own inviter + team. */
export async function seedInvite(
  db: PrismaClient,
  email: string,
  opts: { teamName?: string; role?: string; expired?: boolean } = {},
) {
  const team = await db.team.create({ data: { id: `team_${randomUUID()}`, name: opts.teamName ?? 'Inviter', createdAt: Date.now() } })
  const inviter = await seedUser(db)
  const now = Date.now()
  return db.invite.create({
    data: {
      id: `inv_${randomUUID()}`, teamId: team.id, email: email.toLowerCase(), role: opts.role ?? 'operator',
      token: randomUUID(), status: 'pending', invitedByUserId: inviter.id,
      createdAt: now, expiresAt: opts.expired ? now - 1000 : now + 7 * 24 * 60 * 60 * 1000,
    },
  })
}

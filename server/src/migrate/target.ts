import type { PrismaClient } from '@prisma/client'
import { countChildrenByRelation, expectedTargetTables } from './relations'
import type { TargetSchemaReport, TargetSnapshot } from './types'

/**
 * Read-only snapshot of the Prisma target. Only SELECT/count queries -- never writes.
 *
 * Schema-drift safe: it inspects `pg_tables` BEFORE querying any model, queries/counts ONLY
 * tables that exist, and reports expected/present/missing/extra so the analyzer can raise a
 * blocker for each missing expected table instead of crashing. Per-team child counts (every
 * PRESENT Team relation) + audit counts are gathered only for unmapped ACTIVE teams.
 */
export async function readTargetSnapshot(prisma: PrismaClient): Promise<TargetSnapshot> {
  // 1) Present public tables (before touching any model).
  const rows = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
  )
  const present = new Set(rows.map((r) => r.tablename))
  const expected = expectedTargetTables()
  const schema: TargetSchemaReport = {
    expected,
    present: expected.filter((t) => present.has(t)),
    missing: expected.filter((t) => !present.has(t)),
    extra: [...present].filter((t) => !expected.includes(t) && !t.startsWith('_')).sort(),
  }

  // 2) Read core models only when present (a missing core table -> [] here + a blocker in analyze).
  const users = present.has('User') ? await prisma.user.findMany({ select: { id: true, authProviderId: true, email: true } }) : []
  const teams = present.has('Team') ? await prisma.team.findMany({ select: { id: true, name: true, supabaseTeamId: true, archivedAt: true, createdAt: true } }) : []
  const memberships = present.has('Membership') ? await prisma.membership.findMany({ select: { id: true, userId: true, teamId: true, role: true, status: true, scopeType: true, scopeGroups: true, scopePhones: true, overrides: true } }) : []
  const invites = present.has('Invite') ? await prisma.invite.findMany({ select: { id: true, teamId: true, email: true, token: true, status: true } }) : []

  // 3) Child counts only for unmapped ACTIVE teams; skip any missing relation table.
  const childCountsByTeam: Record<string, Record<string, number>> = {}
  const auditCountByTeam: Record<string, number> = {}
  for (const t of teams) {
    if (t.supabaseTeamId !== null || t.archivedAt !== null) continue
    const counts = await countChildrenByRelation(prisma, t.id, present)
    childCountsByTeam[t.id] = counts
    auditCountByTeam[t.id] = counts['AuditLog'] ?? 0
  }

  return { users, teams, memberships, invites, childCountsByTeam, auditCountByTeam, schema }
}

import type { PrismaClient } from '@prisma/client'
import { countChildrenByRelation, expectedTargetTables } from './relations'
import type { Phase3aSchemaReport, TargetSchemaReport, TargetSnapshot, TgtTeam } from './types'

/**
 * Read-only snapshot of the Prisma target. Only SELECT/count queries -- never writes.
 *
 * Schema-drift + pre-3A safe: it inspects `pg_tables` and `information_schema.columns` BEFORE
 * querying any model, queries/counts ONLY tables and columns that exist, and reports
 * expected/present/missing tables plus Phase 3A column/table presence. If the Phase 3A migration
 * is not deployed (no `Team.supabaseTeamId`/`archivedAt`, no `MigrationRecord`, non-nullable
 * `Invite.invitedByUserId`), the analyzer raises blockers and marks mapping/archival conclusions
 * as unavailable -- it never crashes and still reads all legacy data.
 */
export async function readTargetSnapshot(prisma: PrismaClient): Promise<TargetSnapshot> {
  // 1) Present public tables.
  const tableRows = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
  )
  const present = new Set(tableRows.map((r) => r.tablename))
  const expected = expectedTargetTables()
  const schema: TargetSchemaReport = {
    expected,
    present: expected.filter((t) => present.has(t)),
    missing: expected.filter((t) => !present.has(t)),
    extra: [...present].filter((t) => !expected.includes(t) && !t.startsWith('_')).sort(),
  }

  // 1b) Phase 3A column/table presence (the 3A migration may not be deployed yet).
  const colRows = await prisma.$queryRawUnsafe<Array<{ table_name: string; column_name: string; is_nullable: string }>>(
    `SELECT table_name, column_name, is_nullable FROM information_schema.columns
     WHERE table_schema = 'public' AND (
       (table_name = 'Team' AND column_name IN ('supabaseTeamId', 'archivedAt')) OR
       (table_name = 'Invite' AND column_name = 'invitedByUserId'))`,
  )
  const hasCol = (t: string, c: string): boolean => colRows.some((r) => r.table_name === t && r.column_name === c)
  const inviteCol = colRows.find((r) => r.table_name === 'Invite' && r.column_name === 'invitedByUserId')
  const phase3a: Phase3aSchemaReport = {
    supabaseTeamIdPresent: hasCol('Team', 'supabaseTeamId'),
    archivedAtPresent: hasCol('Team', 'archivedAt'),
    inviteInvitedByNullable: inviteCol?.is_nullable === 'YES',
    migrationRecordPresent: present.has('MigrationRecord'),
    missing: [],
  }
  if (!phase3a.supabaseTeamIdPresent) phase3a.missing.push('Team.supabaseTeamId')
  if (!phase3a.archivedAtPresent) phase3a.missing.push('Team.archivedAt')
  if (!phase3a.inviteInvitedByNullable) phase3a.missing.push('Invite.invitedByUserId (must be nullable)')
  if (!phase3a.migrationRecordPresent) phase3a.missing.push('MigrationRecord')

  // 2) Core reads only when the table is present (missing core table -> [] + a blocker in analyze).
  const users = present.has('User') ? await prisma.user.findMany({ select: { id: true, authProviderId: true, email: true } }) : []
  const memberships = present.has('Membership') ? await prisma.membership.findMany({ select: { id: true, userId: true, teamId: true, role: true, status: true, scopeType: true, scopeGroups: true, scopePhones: true, overrides: true } }) : []
  const invites = present.has('Invite') ? await prisma.invite.findMany({ select: { id: true, teamId: true, email: true, token: true, status: true } }) : []

  // 2b) Team read selects the 3A columns ONLY if they exist (never SELECT a missing column).
  let teams: TgtTeam[] = []
  if (present.has('Team')) {
    const cols = ['"id"', '"name"', '"createdAt"']
    if (phase3a.supabaseTeamIdPresent) cols.push('"supabaseTeamId"')
    if (phase3a.archivedAtPresent) cols.push('"archivedAt"')
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; name: string; createdAt: number; supabaseTeamId?: string | null; archivedAt?: number | null }>>(
      `SELECT ${cols.join(', ')} FROM "Team"`,
    )
    teams = rows.map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: Number(r.createdAt),
      supabaseTeamId: phase3a.supabaseTeamIdPresent ? (r.supabaseTeamId ?? null) : null,
      archivedAt: phase3a.archivedAtPresent ? (r.archivedAt ?? null) : null,
    }))
  }

  // 3) Child counts only when mapping/artifact analysis can run (supabaseTeamId present), for
  //    unmapped ACTIVE teams; skip any missing relation table.
  const childCountsByTeam: Record<string, Record<string, number>> = {}
  const auditCountByTeam: Record<string, number> = {}
  if (phase3a.supabaseTeamIdPresent) {
    for (const t of teams) {
      if (t.supabaseTeamId !== null || t.archivedAt !== null) continue
      const counts = await countChildrenByRelation(prisma, t.id, present)
      childCountsByTeam[t.id] = counts
      auditCountByTeam[t.id] = counts['AuditLog'] ?? 0
    }
  }

  return { users, teams, memberships, invites, childCountsByTeam, auditCountByTeam, schema, phase3a }
}

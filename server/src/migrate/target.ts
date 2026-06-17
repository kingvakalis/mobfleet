import type { PrismaClient } from '@prisma/client'
import { CORE_READ_COLUMNS, countChildrenByRelation, expectedTargetTables, teamRelations } from './relations'
import type {
  ColumnDrift, Phase3aSchemaReport, TargetColumnReport, TargetSchemaReport, TargetSnapshot,
  TgtInvite, TgtMembership, TgtTeam, TgtUser,
} from './types'

/**
 * Read-only snapshot of the Prisma target. Only SELECT/count queries -- never writes.
 *
 * Schema-drift safe at BOTH granularities:
 *   - tables:  inspects pg_tables, queries/counts ONLY present tables (missing -> blocker).
 *   - columns: inspects information_schema.columns for EVERY column the inventory intends to read
 *              (CORE_READ_COLUMNS + each Team relation's FK column) BEFORE any query, and SELECTs
 *              only columns that exist. A missing read column is recorded in `columns` (-> a
 *              TGT_EXPECTED_COLUMN_MISSING blocker in analyze) and its field is left `undefined` --
 *              never coerced to a default. Pre-3A targets (no Team.supabaseTeamId/archivedAt, no
 *              MigrationRecord, non-nullable Invite.invitedByUserId) are tolerated via `phase3a`.
 * It never crashes on drift and still reads every legacy column that does exist.
 *
 * The only interpolated identifiers in raw SQL are table/column names sourced from CORE_READ_COLUMNS
 * (constants) and the Prisma DMMF (teamRelations) -- never user input -- so there is no injection.
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

  // 2) Every column of every public table (one read) -> table -> Set(columns) + nullability.
  const allCols = await prisma.$queryRawUnsafe<Array<{ table_name: string; column_name: string; is_nullable: string }>>(
    "SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_schema = 'public'",
  )
  const colsByTable = new Map<string, Set<string>>()
  const nullableByTable = new Map<string, Map<string, string>>()
  for (const r of allCols) {
    ;(colsByTable.get(r.table_name) ?? colsByTable.set(r.table_name, new Set()).get(r.table_name)!).add(r.column_name)
    ;(nullableByTable.get(r.table_name) ?? nullableByTable.set(r.table_name, new Map()).get(r.table_name)!).set(r.column_name, r.is_nullable)
  }
  const hasColumn = (t: string, c: string): boolean => colsByTable.get(t)?.has(c) ?? false

  // 2a) Phase 3A column/table presence (the 3A migration may not be deployed yet).
  const phase3a: Phase3aSchemaReport = {
    supabaseTeamIdPresent: hasColumn('Team', 'supabaseTeamId'),
    archivedAtPresent: hasColumn('Team', 'archivedAt'),
    inviteInvitedByNullable: nullableByTable.get('Invite')?.get('invitedByUserId') === 'YES',
    migrationRecordPresent: present.has('MigrationRecord'),
    missing: [],
  }
  if (!phase3a.supabaseTeamIdPresent) phase3a.missing.push('Team.supabaseTeamId')
  if (!phase3a.archivedAtPresent) phase3a.missing.push('Team.archivedAt')
  if (!phase3a.inviteInvitedByNullable) phase3a.missing.push('Invite.invitedByUserId (must be nullable)')
  if (!phase3a.migrationRecordPresent) phase3a.missing.push('MigrationRecord')

  // 2b) Read-column inventory: inspect every column the inventory intends to read. Core tables ->
  //     CORE_READ_COLUMNS; each present Team relation -> its Team-FK column (a 'count' read). Only
  //     columns of PRESENT tables are inspected (a missing table is a separate TABLE-level blocker).
  const relations = teamRelations()
  const intended: ColumnDrift[] = []
  for (const [table, cols] of Object.entries(CORE_READ_COLUMNS)) for (const c of cols) intended.push({ table, column: c.column, impacts: c.impacts })
  for (const r of relations) intended.push({ table: r.model, column: r.teamFkField, impacts: ['count'] })

  const columns: TargetColumnReport = { inspected: [], present: [], missing: [], byTable: {} }
  for (const ir of intended) {
    if (!present.has(ir.table)) continue
    columns.inspected.push({ table: ir.table, column: ir.column })
    const bt = (columns.byTable[ir.table] ??= { present: [], missing: [] })
    if (hasColumn(ir.table, ir.column)) {
      columns.present.push({ table: ir.table, column: ir.column })
      bt.present.push(ir.column)
    } else {
      columns.missing.push({ table: ir.table, column: ir.column, impacts: ir.impacts })
      bt.missing.push(ir.column)
    }
  }

  // 3) Core reads -- SELECT ONLY the columns that exist; a missing read column stays `undefined`.
  const readRows = async (table: string, cols: string[]): Promise<Array<Record<string, unknown>>> => {
    if (!present.has(table)) return []
    const avail = cols.filter((c) => hasColumn(table, c))
    if (avail.length === 0) return []
    const list = avail.map((c) => `"${c}"`).join(', ')
    return prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT ${list} FROM "${table}"`)
  }

  const users: TgtUser[] = (await readRows('User', CORE_READ_COLUMNS.User.map((c) => c.column))).map((r) => ({
    id: hasColumn('User', 'id') ? (r.id as string) : undefined,
    authProviderId: hasColumn('User', 'authProviderId') ? (r.authProviderId as string) : undefined,
    email: hasColumn('User', 'email') ? (r.email as string) : undefined,
  }))

  const memberships: TgtMembership[] = (await readRows('Membership', CORE_READ_COLUMNS.Membership.map((c) => c.column))).map((r) => ({
    id: hasColumn('Membership', 'id') ? (r.id as string) : undefined,
    userId: hasColumn('Membership', 'userId') ? (r.userId as string) : undefined,
    teamId: hasColumn('Membership', 'teamId') ? (r.teamId as string) : undefined,
    role: hasColumn('Membership', 'role') ? (r.role as string) : undefined,
    status: hasColumn('Membership', 'status') ? (r.status as string) : undefined,
    scopeType: hasColumn('Membership', 'scopeType') ? (r.scopeType as string) : undefined,
    scopeGroups: hasColumn('Membership', 'scopeGroups') ? r.scopeGroups : undefined,
    scopePhones: hasColumn('Membership', 'scopePhones') ? r.scopePhones : undefined,
    overrides: hasColumn('Membership', 'overrides') ? r.overrides : undefined,
  }))

  const invites: TgtInvite[] = (await readRows('Invite', CORE_READ_COLUMNS.Invite.map((c) => c.column))).map((r) => ({
    id: hasColumn('Invite', 'id') ? (r.id as string) : undefined,
    teamId: hasColumn('Invite', 'teamId') ? (r.teamId as string) : undefined,
    email: hasColumn('Invite', 'email') ? (r.email as string) : undefined,
    token: hasColumn('Invite', 'token') ? (r.token as string) : undefined,
    status: hasColumn('Invite', 'status') ? (r.status as string) : undefined,
  }))

  // Team read selects the legacy columns that exist + the 3A columns ONLY if present.
  const teamCols = [...CORE_READ_COLUMNS.Team.map((c) => c.column)]
  if (phase3a.supabaseTeamIdPresent) teamCols.push('supabaseTeamId')
  if (phase3a.archivedAtPresent) teamCols.push('archivedAt')
  const teams: TgtTeam[] = (await readRows('Team', teamCols)).map((r) => ({
    id: hasColumn('Team', 'id') ? (r.id as string) : undefined,
    name: hasColumn('Team', 'name') ? (r.name as string) : undefined,
    createdAt: hasColumn('Team', 'createdAt') && r.createdAt != null ? Number(r.createdAt) : undefined,
    supabaseTeamId: phase3a.supabaseTeamIdPresent ? ((r.supabaseTeamId as string | null) ?? null) : null,
    archivedAt: phase3a.archivedAtPresent ? ((r.archivedAt as number | null) ?? null) : null,
  }))

  // 4) Child counts only when mapping/artifact analysis can run (supabaseTeamId present), for
  //    unmapped ACTIVE teams; count ONLY relations whose table AND Team-FK column both exist.
  const countable = relations.filter((r) => present.has(r.model) && hasColumn(r.model, r.teamFkField))
  const childCountsByTeam: Record<string, Record<string, number>> = {}
  const auditCountByTeam: Record<string, number> = {}
  if (phase3a.supabaseTeamIdPresent) {
    for (const t of teams) {
      if (t.id === undefined || t.supabaseTeamId !== null || t.archivedAt !== null) continue
      const counts = await countChildrenByRelation(prisma, t.id, countable)
      childCountsByTeam[t.id] = counts
      auditCountByTeam[t.id] = counts['AuditLog'] ?? 0
    }
  }

  return { users, teams, memberships, invites, childCountsByTeam, auditCountByTeam, schema, phase3a, columns }
}

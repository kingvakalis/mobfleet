import { Prisma, type PrismaClient } from '@prisma/client'
import type { ReadImpact } from './types'

/**
 * The set of Prisma models that hold a foreign key back to Team, derived from the
 * LIVE Prisma DMMF -- never a hardcoded list. A newly-added Team relation is therefore
 * inventoried automatically; relations.test.ts guards against any drift/filtering.
 */
export interface TeamRelation {
  /** Related model name, e.g. 'Device'. */
  model: string
  /** Prisma client delegate, e.g. 'device'. */
  delegate: string
  /** Scalar FK field on the related model referencing Team.id, e.g. 'teamId'. */
  teamFkField: string
}

const lcFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1)

export function teamRelations(): TeamRelation[] {
  const models = Prisma.dmmf.datamodel.models
  const team = models.find((m) => m.name === 'Team')
  if (!team) throw new Error('relations: Team model not found in Prisma DMMF')
  const out: TeamRelation[] = []
  for (const f of team.fields) {
    if (f.kind !== 'object') continue // relation fields only
    const related = models.find((m) => m.name === f.type)
    if (!related) throw new Error(`relations: related model ${f.type} not found`)
    // The back-relation field on the related model pointing to Team carries the FK scalar.
    const back = related.fields.find((rf) => rf.kind === 'object' && rf.type === 'Team' && rf.relationName === f.relationName)
    const fk = back?.relationFromFields?.[0]
    if (!fk) throw new Error(`relations: could not resolve Team FK on ${f.type} (relation ${f.relationName})`)
    out.push({ model: f.type, delegate: lcFirst(f.type), teamFkField: fk })
  }
  return out.sort((a, b) => a.model.localeCompare(b.model))
}

type Counter = { count: (args: { where: Record<string, unknown> }) => Promise<number> }

/** The exact set of target tables the inventory READS: the core models loaded directly plus
 *  every Team-FK relation (DMMF-derived). MigrationRecord is intentionally excluded -- it has no
 *  Team relation and is never read. */
export const CORE_TARGET_MODELS = ['User', 'Team', 'Membership', 'Invite'] as const
export function expectedTargetTables(): string[] {
  return [...new Set([...CORE_TARGET_MODELS, ...teamRelations().map((r) => r.model)])].sort()
}

/** One column the inventory READS from a core table, tagged with the analyses it powers. */
export interface ReadColumn { column: string; impacts: ReadImpact[] }

/**
 * SINGLE SOURCE OF TRUTH for the columns the inventory reads from each core table. It is used BOTH
 * to (a) inspect information_schema.columns BEFORE querying and (b) build the SELECT list -- so a
 * column can never be selected without first being verified to exist, and target schema drift is
 * detected generically instead of needing a one-off patch per column. Each column is tagged with
 * the analyses it powers, so a missing column reports precisely what becomes unavailable.
 *
 * Phase 3A columns (Team.supabaseTeamId/archivedAt, Invite.invitedByUserId nullability) are
 * intentionally NOT here -- they are reported by the dedicated Phase 3A presence check. Child
 * relation tables contribute their Team-FK column (a 'count' read) dynamically from the DMMF.
 *
 * `readColumnDriftAgainstDmmf()` validates every entry against the live DMMF so a schema rename
 * surfaces in the test suite rather than silently selecting a stale column name.
 */
export const CORE_READ_COLUMNS: Record<(typeof CORE_TARGET_MODELS)[number], ReadColumn[]> = {
  User: [
    { column: 'id', impacts: ['identity', 'artifact'] },
    { column: 'authProviderId', impacts: ['identity', 'artifact'] },
    { column: 'email', impacts: ['identity'] },
  ],
  Team: [
    { column: 'id', impacts: ['count', 'identity', 'artifact'] },
    { column: 'name', impacts: ['artifact'] },
    { column: 'createdAt', impacts: ['artifact'] },
  ],
  Membership: [
    { column: 'id', impacts: ['identity'] },
    { column: 'userId', impacts: ['identity', 'artifact', 'parity'] },
    { column: 'teamId', impacts: ['identity', 'artifact', 'parity'] },
    { column: 'role', impacts: ['artifact', 'parity'] },
    { column: 'status', impacts: ['parity'] },
    { column: 'scopeType', impacts: ['parity'] },
    { column: 'scopeGroups', impacts: ['parity'] },
    { column: 'scopePhones', impacts: ['parity'] },
    { column: 'overrides', impacts: ['parity'] },
  ],
  Invite: [
    { column: 'id', impacts: ['identity'] },
    { column: 'teamId', impacts: ['identity'] },
    { column: 'email', impacts: ['identity'] },
    { column: 'token', impacts: ['identity'] },
    { column: 'status', impacts: ['identity'] },
  ],
}

/** Validate CORE_READ_COLUMNS against the live Prisma DMMF: every read column must be a scalar
 *  field of its model. Returns the (table,column) entries the implementation reads but the schema no
 *  longer has (drift). Empty = consistent. Guards relations.test.ts against a stale read-column. */
export function readColumnDriftAgainstDmmf(): Array<{ table: string; column: string }> {
  const models = Prisma.dmmf.datamodel.models
  const out: Array<{ table: string; column: string }> = []
  for (const [table, cols] of Object.entries(CORE_READ_COLUMNS)) {
    const m = models.find((x) => x.name === table)
    const scalars = new Set((m?.fields ?? []).filter((f) => f.kind === 'scalar').map((f) => f.name))
    for (const c of cols) if (!scalars.has(c.column)) out.push({ table, column: c.column })
  }
  return out
}

/** Count child rows of `teamId` across the supplied Team relations (read-only; counts touch ONLY
 *  the FK column). The caller pre-filters to relations whose table AND Team-FK column both exist, so
 *  this never queries a missing table or column. Returns a map keyed by related model name. */
export async function countChildrenByRelation(
  prisma: PrismaClient,
  teamId: string,
  relations: TeamRelation[],
): Promise<Record<string, number>> {
  const client = prisma as unknown as Record<string, Counter>
  const counts: Record<string, number> = {}
  for (const r of relations) counts[r.model] = await client[r.delegate].count({ where: { [r.teamFkField]: teamId } })
  return counts
}

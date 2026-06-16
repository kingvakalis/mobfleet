import { Prisma, type PrismaClient } from '@prisma/client'

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

/** Count child rows of `teamId` across every Team relation that is PRESENT (read-only). Relations
 *  whose table is absent (schema drift) are SKIPPED -- never queried -- and omitted from the result.
 *  Returns a map keyed by related model name. */
export async function countChildrenByRelation(
  prisma: PrismaClient,
  teamId: string,
  presentTables?: Set<string>,
): Promise<Record<string, number>> {
  const client = prisma as unknown as Record<string, Counter>
  const counts: Record<string, number> = {}
  for (const r of teamRelations()) {
    if (presentTables && !presentTables.has(r.model)) continue // skip missing tables
    counts[r.model] = await client[r.delegate].count({ where: { [r.teamFkField]: teamId } })
  }
  return counts
}

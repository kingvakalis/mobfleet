import type { PrismaClient } from '@prisma/client'
import { countChildrenByRelation } from './relations'
import type { TargetSnapshot } from './types'

/**
 * Read-only snapshot of the Prisma target. Only SELECT/count queries -- never writes.
 * Per-team child counts (every Team relation, from DMMF) + audit counts are gathered ONLY
 * for unmapped ACTIVE teams (the artifact-classification candidates), to bound the work.
 */
export async function readTargetSnapshot(prisma: PrismaClient): Promise<TargetSnapshot> {
  const [users, teams, memberships, invites] = await Promise.all([
    prisma.user.findMany({ select: { id: true, authProviderId: true, email: true } }),
    prisma.team.findMany({ select: { id: true, name: true, supabaseTeamId: true, archivedAt: true, createdAt: true } }),
    prisma.membership.findMany({ select: { id: true, userId: true, teamId: true, role: true, status: true, scopeType: true, scopeGroups: true, scopePhones: true, overrides: true } }),
    prisma.invite.findMany({ select: { id: true, teamId: true, email: true, token: true, status: true } }),
  ])

  const childCountsByTeam: Record<string, Record<string, number>> = {}
  const auditCountByTeam: Record<string, number> = {}
  for (const t of teams) {
    if (t.supabaseTeamId !== null || t.archivedAt !== null) continue // only unmapped active teams
    const counts = await countChildrenByRelation(prisma, t.id)
    childCountsByTeam[t.id] = counts
    auditCountByTeam[t.id] = counts['AuditLog'] ?? 0
  }

  return { users, teams, memberships, invites, childCountsByTeam, auditCountByTeam }
}

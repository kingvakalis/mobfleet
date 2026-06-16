import type { InventoryReport } from './types'

/**
 * Rendering for the inventory report. The InventoryReport produced by analyze() already
 * masks emails and fingerprints invite tokens, and never contains connection strings or
 * service-role credentials -- so BOTH the JSON and the human summary are safe to persist.
 */
export function toJson(report: InventoryReport): string {
  return JSON.stringify(report, null, 2)
}

export function renderHuman(report: InventoryReport): string {
  const L: string[] = []
  L.push('========== Supabase -> Prisma migration inventory (DRY-RUN, read-only) ==========')
  L.push(report.generatedAt ? `generated: ${report.generatedAt}` : 'generated: (unstamped)')
  if (report.source.proof) {
    L.push(`source snapshot: isolation=${report.source.proof.isolation}, read_only=${report.source.proof.readOnly}, backend_pid=${report.source.proof.backendPid}`)
  }
  if (report.targetReadOnly) {
    const t = report.targetReadOnly
    L.push(`target role: ${t.currentUser}@${t.database} read-only verified (insert=${t.canInsert} update=${t.canUpdate} delete=${t.canDelete} create=${t.canCreate})`)
  }
  L.push('')
  L.push(`SOURCE  authUsers=${report.source.authUsers} teams=${report.source.teams} members=${report.source.members} invites=${report.source.invites}`)
  L.push(`TARGET  users=${report.target.users} teams=${report.target.teams} (mapped=${report.target.mappedTeams}, unmappedActive=${report.target.unmappedActiveTeams}, archived=${report.target.archivedTeams}) memberships=${report.target.memberships} invites=${report.target.invites}`)
  L.push('')
  L.push('PLAN (what a future --commit WOULD do; nothing is written now):')
  L.push(`  usersToCreate=${report.plan.usersToCreate}  teamsToCreate=${report.plan.teamsToCreate}  teamsAlreadyMapped=${report.plan.teamsAlreadyMapped}`)
  L.push(`  membershipsToUpsert=${report.plan.membershipsToUpsert}  invitesToMigrate=${report.plan.invitesToMigrate}  artifactsToArchive=${report.plan.artifactsToArchive}`)
  L.push('')
  L.push('ARTIFACT CLASSIFICATION (unmapped active Prisma teams):')
  const byClass = { auto_provision_candidate: 0, native: 0, unknown: 0 }
  for (const a of report.artifacts) byClass[a.classification]++
  L.push(`  candidate=${byClass.auto_provision_candidate}  native=${byClass.native}  unknown=${byClass.unknown} (unknown => BLOCKER, never auto-archived)`)
  for (const a of report.artifacts) {
    L.push(`   - ${a.teamId} "${a.teamName}" => ${a.classification.toUpperCase()} (members=${a.evidence.memberCount}, owners=${a.evidence.ownerCount}, children=${a.evidence.hasChildren}, audit=${a.evidence.auditCount}, namePattern=${a.evidence.nameMatchesAutoProvisionPattern}, ownerMigrated=${a.evidence.ownerIsMigrated}, createdAfter=${a.evidence.createdAfterOwnerSupabaseMembership})`)
  }
  L.push('')
  L.push(`FINDINGS  blocker=${report.counts.bySeverity.blocker} warn=${report.counts.bySeverity.warn} info=${report.counts.bySeverity.info}`)
  for (const code of Object.keys(report.counts.byCode).sort()) L.push(`  ${code}: ${report.counts.byCode[code]}`)
  L.push('')
  if (report.findings.length) {
    L.push('DETAIL (refs/emails masked; full evidence in the JSON report):')
    for (const f of report.findings) L.push(`  [${f.severity.toUpperCase()}] ${f.code} <${f.entity}:${f.ref}> ${f.detail}`)
    L.push('')
  }
  if (report.hasBlockers) {
    L.push(`RESULT: ${report.blockers.length} BLOCKER(S) -- Phase 3C is BLOCKED until resolved. Exit code 1.`)
  } else {
    L.push('RESULT: no blockers. Phase 3C may proceed (still requires explicit approval). Exit code 0.')
  }
  L.push('=================================================================================')
  return L.join('\n')
}

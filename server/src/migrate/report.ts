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
  const na = (v: number | null): string => (v === null ? 'unavailable' : String(v))
  L.push('========== Supabase -> Prisma migration inventory (DRY-RUN, read-only) ==========')
  L.push(report.generatedAt ? `generated: ${report.generatedAt}` : 'generated: (unstamped)')
  L.push(
    report.sourceSnapshot
      ? `source mode: ${report.sourceMode} (snapshot v${report.sourceSnapshot.version}, generatedAt=${report.sourceSnapshot.generatedAt}, sha256=${report.sourceSnapshot.sha256})`
      : `source mode: ${report.sourceMode}`,
  )
  if (report.source.proof) {
    L.push(`source snapshot: isolation=${report.source.proof.isolation}, read_only=${report.source.proof.readOnly}, backend_pid=${report.source.proof.backendPid}`)
  }
  for (const rp of [report.sourceRole, report.targetReadOnly]) {
    if (!rp) continue
    const ok = rp.violations.length === 0
    L.push(`${rp.label} role: ${rp.role}@${rp.database} -- read-only ${ok ? 'VERIFIED' : 'VIOLATIONS(' + rp.violations.length + ')'} ` +
      `[superuser=${rp.isSuperuser} createdb=${rp.canCreateDb} createrole=${rp.canCreateRole} replication=${rp.isReplication} ` +
      `bypassrls=${rp.bypassRls} dbOwner=${rp.isDatabaseOwner} ownsSchemas=${rp.ownedSchemas.length} ownsTables=${rp.ownedTables.length} ` +
      `createDb=${rp.canCreateOnDatabase} createSchemas=${rp.schemasWithCreate.length} writableTables=${rp.tablesWritable.length} ` +
      `privRoleMember=${rp.memberOfPrivilegedRoleCount} default_ro=${rp.defaultTransactionReadOnly}]`)
    if (!ok) for (const v of rp.violations) L.push(`    ! ${v}`)
  }
  L.push('')
  L.push(`SOURCE  authUsers=${report.source.authUsers} teams=${report.source.teams} members=${report.source.members} invites=${report.source.invites}`)
  L.push(`TARGET  users=${report.target.users} teams=${report.target.teams} (mapped=${na(report.target.mappedTeams)}, unmappedActive=${na(report.target.unmappedActiveTeams)}, archived=${na(report.target.archivedTeams)}) memberships=${report.target.memberships} invites=${report.target.invites}`)
  const sc = report.targetSchema
  L.push(`TARGET SCHEMA  expected=${sc.expected.length} present=${sc.present.length} missing=${sc.missing.length} extra=${sc.extra.length}`)
  if (sc.missing.length) L.push(`  MISSING (blockers): ${sc.missing.join(', ')}`)
  if (sc.extra.length) L.push(`  extra (present but not read by the inventory): ${sc.extra.join(', ')}`)
  const p3 = report.phase3a
  const p3ok = p3.missing.length === 0
  L.push(`PHASE 3A SCHEMA  ${p3ok ? 'applied' : 'NOT fully applied'} ` +
    `[supabaseTeamId=${p3.supabaseTeamIdPresent} archivedAt=${p3.archivedAtPresent} inviteInvitedByNullable=${p3.inviteInvitedByNullable} MigrationRecord=${p3.migrationRecordPresent}]`)
  if (!p3ok) L.push(`  MISSING (blockers): ${p3.missing.join(', ')}  -> mapping/archival reported as "unavailable", not zero`)
  L.push('')
  L.push('PLAN (what a future --commit WOULD do; nothing is written now):')
  L.push(`  usersToCreate=${report.plan.usersToCreate}  teamsToCreate=${na(report.plan.teamsToCreate)}  teamsAlreadyMapped=${na(report.plan.teamsAlreadyMapped)}`)
  L.push(`  membershipsToUpsert=${report.plan.membershipsToUpsert}  invitesToMigrate=${report.plan.invitesToMigrate}  artifactsToArchive=${na(report.plan.artifactsToArchive)}`)
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

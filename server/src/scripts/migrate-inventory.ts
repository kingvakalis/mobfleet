import { writeFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { analyze } from '../migrate/analyze'
import { assertTargetReadOnly } from '../migrate/preflight'
import { readSourceSnapshot } from '../migrate/source'
import { loadSourceSnapshot } from '../migrate/snapshot'
import { readTargetSnapshot } from '../migrate/target'
import { renderHuman, toJson } from '../migrate/report'

/**
 * Phase 3B entrypoint: READ-ONLY Supabase->Prisma migration inventory + conflict report.
 * DRY-RUN ONLY -- this script has no write path at all. The Prisma TARGET is always read-only
 * (verified pre-flight). The SOURCE is one of two modes:
 *   - live:            read Supabase over one REPEATABLE READ READ ONLY transaction (SUPABASE_DB_URL)
 *   - offline_snapshot: load a local JSON file (--source-snapshot <path>) -- NO Supabase connection
 * It emits a human summary + machine-readable JSON and exits non-zero if blockers exist.
 *
 * Runtime (operator-supplied; do NOT point at production without separate approval + credentials):
 *   --source-snapshot <path>  offline source JSON (mutually exclusive with SUPABASE_DB_URL)
 *   SUPABASE_DB_URL           live source (direct Postgres reading auth.users)
 *   DATABASE_URL              the Prisma target (read by the default PrismaClient)
 *   MIGRATE_REPORT_OUT        optional JSON report path (default ./migration-inventory.json)
 *
 * Connection strings + credentials are NEVER printed.
 */

/** Show only host:port/db -- never user:password. */
function maskConn(url: string | undefined): string {
  if (!url) return '(unset)'
  try {
    const u = new URL(url)
    return `${u.hostname}:${u.port || '5432'}${u.pathname}`
  } catch {
    return '(masked)'
  }
}

/** Parse `--source-snapshot <path>` from argv. */
function parseSnapshotArg(argv: string[]): string | null | undefined {
  const i = argv.indexOf('--source-snapshot')
  if (i < 0) return undefined
  const p = argv[i + 1]
  return p && !p.startsWith('--') ? p : null // null = flag present but no path
}

async function main(): Promise<number> {
  const snapshotPath = parseSnapshotArg(process.argv.slice(2))
  if (snapshotPath === null) {
    console.error('migrate-inventory: --source-snapshot requires a file path. Aborting.')
    return 2
  }
  const sourceUrl = process.env.SUPABASE_DB_URL
  const targetUrl = process.env.DATABASE_URL

  // Source selection (offline snapshot vs live) is mutually exclusive -- fail closed.
  if (snapshotPath && sourceUrl) {
    console.error('migrate-inventory: --source-snapshot and SUPABASE_DB_URL are mutually exclusive. Aborting.')
    return 2
  }
  if (!snapshotPath && !sourceUrl) {
    console.error('migrate-inventory: provide --source-snapshot <local-json-path> OR SUPABASE_DB_URL. Aborting.')
    return 2
  }

  console.log('migrate-inventory: DRY-RUN (read-only). No writes to Supabase or Prisma.')
  console.log(`  target (Prisma):   ${maskConn(targetUrl)}`)
  if (snapshotPath) console.log(`  source: OFFLINE snapshot file (NO Supabase connection): ${snapshotPath}`)
  else console.log(`  source (Supabase): ${maskConn(sourceUrl)}`)

  const prisma = new PrismaClient()
  let report
  try {
    // Fail fast: prove the TARGET role is least-privilege read-only BEFORE reading anything.
    const targetReadOnly = await assertTargetReadOnly(prisma)
    console.log(`  target role: ${targetReadOnly.role}@${targetReadOnly.database} -- least-privilege read-only VERIFIED`)
    // Source: offline snapshot file (no connection) OR live RR READ ONLY transaction (role enforced).
    const source = snapshotPath
      ? loadSourceSnapshot(snapshotPath)
      : await readSourceSnapshot(sourceUrl!, { enforceReadOnlyRole: true })
    if (source.mode === 'offline_snapshot') {
      console.log(`  source snapshot: v${source.snapshotMeta?.version} generatedAt=${source.snapshotMeta?.generatedAt} sha256=${source.snapshotMeta?.sha256}`)
    } else {
      console.log(`  source role: ${source.roleProof?.role}@${source.roleProof?.database} -- least-privilege read-only VERIFIED`)
    }
    const target = await readTargetSnapshot(prisma)
    report = analyze(source, target)
    report.targetReadOnly = targetReadOnly
  } finally {
    await prisma.$disconnect()
  }
  report.generatedAt = new Date().toISOString()

  const out = process.env.MIGRATE_REPORT_OUT ?? 'migration-inventory.json'
  writeFileSync(out, toJson(report))
  console.log(renderHuman(report))
  console.log(`\nJSON report written to ${out}`)

  return report.hasBlockers ? 1 : 0
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error('migrate-inventory: FAILED:', err instanceof Error ? err.message : err)
    process.exit(2)
  })

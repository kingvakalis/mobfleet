import { writeFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { analyze } from '../migrate/analyze'
import { assertTargetReadOnly } from '../migrate/preflight'
import { readSourceSnapshot } from '../migrate/source'
import { readTargetSnapshot } from '../migrate/target'
import { renderHuman, toJson } from '../migrate/report'

/**
 * Phase 3B entrypoint: READ-ONLY Supabase->Prisma migration inventory + conflict report.
 * DRY-RUN ONLY -- this script has no write path at all. It reads the Supabase source through
 * one REPEATABLE READ READ ONLY transaction and the Prisma target read-only, then emits a
 * human summary + a machine-readable JSON report and exits non-zero if blockers exist.
 *
 * Runtime env (supplied deliberately by the operator; do NOT point at production without
 * separate approval + separately-supplied credentials):
 *   SUPABASE_DB_URL    direct Postgres connection to the Supabase source (reads auth.users)
 *   DATABASE_URL       the Prisma target (read by the default PrismaClient)
 *   MIGRATE_REPORT_OUT optional path for the JSON report (default ./migration-inventory.json)
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

async function main(): Promise<number> {
  const sourceUrl = process.env.SUPABASE_DB_URL
  const targetUrl = process.env.DATABASE_URL
  if (!sourceUrl) {
    console.error('migrate-inventory: SUPABASE_DB_URL is required (direct Postgres to the Supabase source). Aborting.')
    return 2
  }
  console.log('migrate-inventory: DRY-RUN (read-only). No writes to Supabase or Prisma.')
  console.log(`  source (Supabase): ${maskConn(sourceUrl)}`)
  console.log(`  target (Prisma):   ${maskConn(targetUrl)}`)

  const prisma = new PrismaClient()
  let report
  try {
    // Fail fast: prove the TARGET role is least-privilege read-only BEFORE reading anything.
    const targetReadOnly = await assertTargetReadOnly(prisma)
    console.log(`  target role: ${targetReadOnly.role}@${targetReadOnly.database} -- least-privilege read-only VERIFIED`)
    // Source: one REPEATABLE READ READ ONLY transaction (proven), and the source role is
    // verified least-privilege read-only on that same connection (enforced -> aborts on any violation).
    const source = await readSourceSnapshot(sourceUrl, { enforceReadOnlyRole: true })
    console.log(`  source role: ${source.roleProof.role}@${source.roleProof.database} -- least-privilege read-only VERIFIED`)
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

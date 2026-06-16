import { writeFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { analyze } from '../migrate/analyze'
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

  const source = await readSourceSnapshot(sourceUrl)

  const prisma = new PrismaClient()
  let report
  try {
    const target = await readTargetSnapshot(prisma)
    report = analyze(source, target)
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

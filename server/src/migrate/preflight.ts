import type { PrismaClient } from '@prisma/client'
import type { TargetReadOnlyProof } from './types'

/**
 * Proves the TARGET (Prisma) connection's role is least-privilege READ-ONLY before any
 * read runs (rule 5). Uses ONLY catalog SELECTs (`has_table_privilege` /
 * `has_database_privilege`) -- it never attempts a write. Throws (aborting the run) if the
 * role holds INSERT/UPDATE/DELETE on any business table or CREATE on the database. A
 * read-only role is also a non-owner, so it cannot ALTER/DROP those tables either.
 */
const BUSINESS_TABLES = ['Team', 'Membership', 'Invite', 'User']

export async function assertTargetReadOnly(prisma: PrismaClient): Promise<TargetReadOnlyProof> {
  const inList = BUSINESS_TABLES.map((t) => `'${t}'`).join(',')
  const rows = await prisma.$queryRawUnsafe<Array<{ who: string; db: string; ins: boolean; upd: boolean; del: boolean; crt: boolean }>>(
    `SELECT current_user AS who,
            current_database() AS db,
            coalesce(bool_or(has_table_privilege(current_user, c.oid, 'INSERT')), false) AS ins,
            coalesce(bool_or(has_table_privilege(current_user, c.oid, 'UPDATE')), false) AS upd,
            coalesce(bool_or(has_table_privilege(current_user, c.oid, 'DELETE')), false) AS del,
            has_database_privilege(current_user, current_database(), 'CREATE') AS crt
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname IN (${inList})
     GROUP BY current_user, current_database()`,
  )
  const r = rows[0]
  const proof: TargetReadOnlyProof = {
    currentUser: r?.who ?? '(unknown)',
    database: r?.db ?? '(unknown)',
    canInsert: Boolean(r?.ins),
    canUpdate: Boolean(r?.upd),
    canDelete: Boolean(r?.del),
    canCreate: Boolean(r?.crt),
  }
  if (proof.canInsert || proof.canUpdate || proof.canDelete || proof.canCreate) {
    throw new Error(
      `migrate/preflight: REFUSING to run -- the target connection is NOT least-privilege read-only ` +
        `(insert=${proof.canInsert} update=${proof.canUpdate} delete=${proof.canDelete} create=${proof.canCreate}). ` +
        `Supply a read-only Prisma role with only SELECT.`,
    )
  }
  return proof
}

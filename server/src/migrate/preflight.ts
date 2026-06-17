import type { PrismaClient } from '@prisma/client'
import type { RoleReadOnlyProof } from './types'

/**
 * Hardened least-privilege READ-ONLY verification for a database role (rule 5). Uses ONLY
 * catalog SELECTs (`pg_roles`, `pg_namespace`, `pg_class`, `has_*_privilege`, `pg_has_role`)
 * -- it never attempts a write. Works over any SQL runner so it can verify BOTH the source
 * (a `pg` client inside the proven REPEATABLE READ READ ONLY transaction) and the target
 * (the Prisma client). Aborts (assertRoleReadOnly throws) unless the role:
 *   - is NOT a superuser and lacks CREATEDB / CREATEROLE / REPLICATION / BYPASSRLS
 *   - is NOT the database owner, nor an inspected-schema owner, nor an inspected-table owner
 *   - is NOT a (direct or inherited) member of any privileged/owner role
 *   - has NO CREATE on the database or on the inspected schemas
 *   - has NO INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on the inspected tables
 *   - has default_transaction_read_only enabled
 */
export type SqlRunner = (sql: string) => Promise<Array<Record<string, unknown>>>

export interface RoleCheckOpts {
  label: string
  schemas: string[]
  tables: { schema: string; name: string }[]
}

export const SOURCE_ROLE_OPTS: RoleCheckOpts = {
  label: 'source',
  schemas: ['auth', 'public'],
  tables: [
    { schema: 'auth', name: 'users' },
    { schema: 'public', name: 'teams' },
    { schema: 'public', name: 'team_members' },
    { schema: 'public', name: 'team_invites' },
  ],
}
export const TARGET_ROLE_OPTS: RoleCheckOpts = {
  label: 'target',
  schemas: ['public'],
  tables: [
    { schema: 'public', name: 'Team' },
    { schema: 'public', name: 'Membership' },
    { schema: 'public', name: 'Invite' },
    { schema: 'public', name: 'User' },
  ],
}

const lit = (s: string): string => `'${s.replace(/'/g, "''")}'`
const b = (v: unknown): boolean => v === true || v === 't' || v === 'true'

export async function inspectRoleReadOnly(run: SqlRunner, opts: RoleCheckOpts): Promise<RoleReadOnlyProof> {
  const schemaArr = `ARRAY[${opts.schemas.map(lit).join(',')}]::text[]`
  const tuples = opts.tables.map((t) => `(${lit(t.schema)},${lit(t.name)})`).join(',')
  const tablePred = opts.tables.length ? `(n.nspname, c.relname) IN (${tuples})` : 'false'

  const q1 = (await run(
    `SELECT current_user AS role, current_database() AS db,
            r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls,
            (SELECT pg_get_userbyid(datdba) = current_user FROM pg_database WHERE datname = current_database()) AS is_db_owner,
            has_database_privilege(current_user, current_database(), 'CREATE') AS create_db,
            current_setting('default_transaction_read_only') AS dtro
     FROM pg_roles r WHERE r.rolname = current_user`,
  ))[0] ?? {}

  const q2 = await run(
    `SELECT n.nspname AS schema, pg_get_userbyid(n.nspowner) = current_user AS owns,
            has_schema_privilege(current_user, n.nspname, 'CREATE') AS can_create
     FROM pg_namespace n WHERE n.nspname = ANY (${schemaArr})`,
  )

  const q3 = await run(
    `SELECT n.nspname AS schema, c.relname AS name, pg_get_userbyid(c.relowner) = current_user AS owns,
            has_table_privilege(current_user, c.oid, 'INSERT') AS ins,
            has_table_privilege(current_user, c.oid, 'UPDATE') AS upd,
            has_table_privilege(current_user, c.oid, 'DELETE') AS del,
            has_table_privilege(current_user, c.oid, 'TRUNCATE') AS trunc,
            has_table_privilege(current_user, c.oid, 'REFERENCES') AS refs,
            has_table_privilege(current_user, c.oid, 'TRIGGER') AS trig
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'r' AND ${tablePred}`,
  )

  const q4 = (await run(
    `WITH privileged AS (
       SELECT oid FROM pg_roles WHERE rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls
       UNION SELECT datdba FROM pg_database WHERE datname = current_database()
       UNION SELECT nspowner FROM pg_namespace WHERE nspname = ANY (${schemaArr})
       UNION SELECT c.relowner FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind='r' AND ${tablePred}
     )
     SELECT count(*)::int AS n FROM privileged p JOIN pg_roles r ON r.oid = p.oid
     WHERE r.rolname <> current_user AND pg_has_role(current_user, r.oid, 'MEMBER')`,
  ))[0] ?? {}

  const ownedSchemas = q2.filter((r) => b(r.owns)).map((r) => String(r.schema))
  const schemasWithCreate = q2.filter((r) => b(r.can_create)).map((r) => String(r.schema))
  const ownedTables = q3.filter((r) => b(r.owns)).map((r) => `${r.schema}.${r.name}`)
  const tablesWritable = q3
    .filter((r) => b(r.ins) || b(r.upd) || b(r.del) || b(r.trunc) || b(r.refs) || b(r.trig))
    .map((r) => `${r.schema}.${r.name}`)

  const proof: RoleReadOnlyProof = {
    label: opts.label,
    role: String(q1.role ?? '(unknown)'),
    database: String(q1.db ?? '(unknown)'),
    isSuperuser: b(q1.rolsuper),
    canCreateDb: b(q1.rolcreatedb),
    canCreateRole: b(q1.rolcreaterole),
    isReplication: b(q1.rolreplication),
    bypassRls: b(q1.rolbypassrls),
    isDatabaseOwner: b(q1.is_db_owner),
    ownedSchemas,
    ownedTables,
    schemasWithCreate,
    tablesWritable,
    canCreateOnDatabase: b(q1.create_db),
    memberOfPrivilegedRoleCount: Number(q4.n ?? 0),
    defaultTransactionReadOnly: String(q1.dtro ?? 'off'),
    violations: [],
  }
  const v = proof.violations
  if (proof.isSuperuser) v.push('role is a superuser')
  if (proof.canCreateDb) v.push('role has CREATEDB')
  if (proof.canCreateRole) v.push('role has CREATEROLE')
  if (proof.isReplication) v.push('role has REPLICATION')
  if (proof.bypassRls) v.push('role has BYPASSRLS')
  if (proof.isDatabaseOwner) v.push('role is the database owner')
  if (ownedSchemas.length) v.push(`role owns schema(s): ${ownedSchemas.join(', ')}`)
  if (ownedTables.length) v.push(`role owns inspected table(s): ${ownedTables.join(', ')}`)
  if (proof.canCreateOnDatabase) v.push('role has CREATE on the database')
  if (schemasWithCreate.length) v.push(`role has CREATE on schema(s): ${schemasWithCreate.join(', ')}`)
  if (tablesWritable.length) v.push(`role has write privilege on table(s): ${tablesWritable.join(', ')}`)
  if (proof.memberOfPrivilegedRoleCount > 0) v.push(`role is a member of ${proof.memberOfPrivilegedRoleCount} privileged/owner role(s)`)
  if (proof.defaultTransactionReadOnly !== 'on') v.push('default_transaction_read_only is not enabled')
  return proof
}

export async function assertRoleReadOnly(run: SqlRunner, opts: RoleCheckOpts): Promise<RoleReadOnlyProof> {
  const proof = await inspectRoleReadOnly(run, opts)
  if (proof.violations.length) {
    throw new Error(`migrate/preflight [${opts.label}]: REFUSING to run -- role "${proof.role}" is not least-privilege read-only: ${proof.violations.join('; ')}`)
  }
  return proof
}

export function prismaSqlRunner(prisma: PrismaClient): SqlRunner {
  return (sql) => prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(sql)
}

/** Convenience wrapper: assert the TARGET (Prisma) connection role is least-privilege read-only. */
export function assertTargetReadOnly(prisma: PrismaClient): Promise<RoleReadOnlyProof> {
  return assertRoleReadOnly(prismaSqlRunner(prisma), TARGET_ROLE_OPTS)
}

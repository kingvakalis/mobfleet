import { Client } from 'pg'
import { assertRoleReadOnly, inspectRoleReadOnly, SOURCE_ROLE_OPTS, type SqlRunner } from './preflight'
import type { SourceSnapshot, SrcAuthUser, SrcInvite, SrcMember, SrcTeam } from './types'

/**
 * Reads the entire Supabase source snapshot through ONE connection inside ONE
 * `REPEATABLE READ READ ONLY` transaction, and PROVES that mode before reading
 * anything (rule 1). Also verifies the source ROLE is least-privilege read-only on that
 * SAME connection (opts.enforceReadOnlyRole aborts on any violation; otherwise the proof is
 * still collected). Aborts (throws) if the transaction is not provably repeatable-read +
 * read-only. The transaction is rolled back at the end; nothing is ever written.
 *
 * The connection string is NEVER logged. Pass it from a runtime-supplied env var.
 */
export async function readSourceSnapshot(connectionString: string, opts: { enforceReadOnlyRole?: boolean } = {}): Promise<SourceSnapshot> {
  const client = new Client({ connectionString, application_name: 'mobfleet-migrate-inventory-dryrun' })
  await client.connect()
  try {
    // READ ONLY at the transaction level: any write (even accidental) errors at the DB.
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')

    const proofRow = (
      await client.query<{ iso: string; ro: string; pid: number }>(
        "SELECT current_setting('transaction_isolation') AS iso, current_setting('transaction_read_only') AS ro, pg_backend_pid() AS pid",
      )
    ).rows[0]
    const isolation = String(proofRow?.iso ?? '')
    const readOnly = String(proofRow?.ro ?? '') === 'on'
    if (isolation !== 'repeatable read' || !readOnly) {
      throw new Error(
        `migrate/source: refusing to read -- snapshot is not provably REPEATABLE READ + READ ONLY (isolation=${JSON.stringify(isolation)}, read_only=${JSON.stringify(proofRow?.ro)})`,
      )
    }
    const backendPid = Number(proofRow.pid)

    // Verify the SOURCE role is least-privilege read-only on this SAME connection/transaction.
    const run: SqlRunner = (sql) => client.query(sql).then((r) => r.rows as Array<Record<string, unknown>>)
    const roleProof = opts.enforceReadOnlyRole
      ? await assertRoleReadOnly(run, SOURCE_ROLE_OPTS)
      : await inspectRoleReadOnly(run, SOURCE_ROLE_OPTS)

    // All four reads run on THIS client, inside THIS one proven transaction.
    const authUsers = (
      await client.query<SrcAuthUser>(
        `SELECT id::text AS id, email, email_confirmed_at::text AS "emailConfirmedAt",
                coalesce(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name') AS "fullName",
                created_at::text AS "createdAt"
         FROM auth.users`,
      )
    ).rows

    const teams = (
      await client.query<SrcTeam>(
        `SELECT id::text AS id, name, owner_user_id::text AS "ownerUserId", created_at::text AS "createdAt"
         FROM public.teams`,
      )
    ).rows

    const members = (
      await client.query<SrcMember>(
        `SELECT id::text AS id, team_id::text AS "teamId", user_id::text AS "userId", role::text AS role,
                status, email, name, invited_by::text AS "invitedBy", scope_type AS "scopeType",
                scope_groups AS "scopeGroups", scope_phones AS "scopePhones", overrides,
                joined_at::text AS "joinedAt"
         FROM public.team_members`,
      )
    ).rows

    const invites = (
      await client.query<SrcInvite>(
        `SELECT id::text AS id, team_id::text AS "teamId", email, role::text AS role, token, status,
                invited_by::text AS "invitedBy", created_at::text AS "createdAt",
                expires_at::text AS "expiresAt", accepted_at::text AS "acceptedAt"
         FROM public.team_invites`,
      )
    ).rows

    // Read-only: roll back (there is nothing to commit) before releasing the connection.
    await client.query('ROLLBACK')

    return { authUsers, teams, members, invites, mode: 'live', proof: { isolation, readOnly, backendPid }, roleProof, snapshotMeta: null }
  } finally {
    await client.end()
  }
}

// Shared types for the read-only Supabase->Prisma migration inventory (Phase 3B).
// NO database access here -- pure data shapes + the conflict-code catalogue, so the
// analyzer (analyze.ts) is exhaustively unit-testable without a DB.

export type Severity = 'blocker' | 'warn' | 'info'

/** Stable, machine-readable conflict codes. Anything 'blocker' must block Phase 3C
 *  and force a non-zero exit. */
export type ConflictCode =
  // ── Identity-collision matrix (rule 4) ──
  | 'IDENT_DUP_AUTH_PROVIDER_ID' // one authProviderId presents conflicting source identities
  | 'IDENT_PRISMA_AUTHID_EMAIL_CONFLICT' // existing Prisma user: same authProviderId, different email
  | 'IDENT_PRISMA_EMAIL_DIFF_AUTHID' // existing Prisma user: same normalized email, different authProviderId
  | 'IDENT_DUP_SUPABASE_EMAIL' // duplicate normalized emails among Supabase auth.users
  | 'IDENT_MISSING_AUTH_USER' // membership/owner references an auth.users id that is absent
  | 'IDENT_INVITE_RECIPIENT_AMBIGUOUS' // invite email matches multiple/conflicting auth users
  | 'IDENT_MISSING_INVITED_BY' // invite.invited_by references a missing/absent user (-> null)
  | 'IDENT_EMAIL_CHANGED' // auth.users.email differs from the team_members.email snapshot
  | 'IDENT_PRISMA_EMAIL_UNIQUE_CONFLICT' // migrating would violate Prisma User.email @unique
  // ── Target conflicts (rule 5) ──
  | 'TGT_SUPABASE_ID_UNEXPECTED_TEAM' // a mapped Team.supabaseTeamId points at an unexpected/renamed team
  | 'TGT_MEMBERSHIP_CONFLICT' // existing membership on the mapped team disagrees with source
  | 'TGT_INVITE_TOKEN_COLLISION' // a token already exists in Prisma for a different team/email/status
  | 'TGT_EXPECTED_TABLE_MISSING' // an expected target table is absent (schema drift) -- it is skipped, not queried
  | 'TGT_EXPECTED_COLUMN_MISSING' // an expected read column is absent on a present table (legacy/drift) -- never selected
  | 'TGT_PHASE3A_SCHEMA_MISSING' // a required Phase 3A table/column is absent (migration not deployed) -- never queried
  | 'SRC_DUP_MEMBERSHIP' // duplicate (team_id,user_id) source membership rows
  | 'SRC_INVALID_ROLE' // source role not in the known set
  | 'SRC_INVALID_STATUS' // source status not in the known set
  | 'SRC_MALFORMED_SCOPE' // scope_type invalid or scope_groups/scope_phones not a string[]
  | 'SRC_MALFORMED_OVERRIDES' // overrides not an object of {key: 'allow'|'deny'}
  | 'SRC_TEAM_NO_OWNER' // source team has no owner membership and no owner_user_id resolvable
  | 'SRC_TEAM_AMBIGUOUS_OWNER' // source team has multiple conflicting owners
  // ── Artifact classification (rule 3) ──
  | 'ARTIFACT_UNKNOWN_ORIGIN' // an unmapped Prisma team cannot be confidently classified

export const SEVERITY: Record<ConflictCode, Severity> = {
  IDENT_DUP_AUTH_PROVIDER_ID: 'blocker',
  IDENT_PRISMA_AUTHID_EMAIL_CONFLICT: 'blocker',
  IDENT_PRISMA_EMAIL_DIFF_AUTHID: 'blocker',
  IDENT_DUP_SUPABASE_EMAIL: 'blocker',
  IDENT_MISSING_AUTH_USER: 'blocker',
  IDENT_INVITE_RECIPIENT_AMBIGUOUS: 'blocker',
  IDENT_MISSING_INVITED_BY: 'info', // resolved by mapping to null (no false attribution)
  IDENT_EMAIL_CHANGED: 'warn', // resolved by using the current auth.users.email
  IDENT_PRISMA_EMAIL_UNIQUE_CONFLICT: 'blocker',
  TGT_SUPABASE_ID_UNEXPECTED_TEAM: 'blocker',
  TGT_MEMBERSHIP_CONFLICT: 'blocker',
  TGT_INVITE_TOKEN_COLLISION: 'blocker',
  TGT_EXPECTED_TABLE_MISSING: 'blocker',
  TGT_EXPECTED_COLUMN_MISSING: 'blocker',
  TGT_PHASE3A_SCHEMA_MISSING: 'blocker',
  SRC_DUP_MEMBERSHIP: 'blocker',
  SRC_INVALID_ROLE: 'blocker',
  SRC_INVALID_STATUS: 'blocker',
  SRC_MALFORMED_SCOPE: 'blocker',
  SRC_MALFORMED_OVERRIDES: 'blocker',
  SRC_TEAM_NO_OWNER: 'blocker',
  SRC_TEAM_AMBIGUOUS_OWNER: 'blocker',
  ARTIFACT_UNKNOWN_ORIGIN: 'blocker',
}

export const VALID_ROLES = ['owner', 'admin', 'manager', 'operator', 'viewer'] as const
export const VALID_STATUSES = ['active', 'suspended'] as const
export const VALID_SCOPE_TYPES = ['workspace', 'assigned_groups', 'assigned_phones', 'self'] as const

export interface Finding {
  code: ConflictCode
  severity: Severity
  entity: 'user' | 'team' | 'membership' | 'invite' | 'table'
  /** A stable, NON-SECRET reference for manual resolution (e.g. a Supabase team id,
   *  a masked email key). Never a token or connection string. */
  ref: string
  detail: string
  evidence?: Record<string, unknown>
}

// ── Source snapshot (read from Supabase via one REPEATABLE READ READ ONLY tx) ──
export interface SrcAuthUser {
  id: string
  email: string | null
  emailConfirmedAt: string | null
  fullName: string | null
  createdAt: string | null
}
export interface SrcTeam {
  id: string
  name: string
  ownerUserId: string | null
  createdAt: string | null
}
export interface SrcMember {
  id: string
  teamId: string
  userId: string
  role: string
  status: string
  email: string | null
  name: string | null
  invitedBy: string | null
  scopeType: string
  scopeGroups: unknown
  scopePhones: unknown
  overrides: unknown
  joinedAt: string | null
}
export interface SrcInvite {
  id: string
  teamId: string
  email: string
  role: string
  token: string
  status: string
  invitedBy: string | null
  createdAt: string | null
  expiresAt: string | null
  acceptedAt: string | null
}
export interface SnapshotProof {
  isolation: string // expected 'repeatable read'
  readOnly: boolean // expected true
  backendPid: number // the single backend connection all reads ran on
}
/** Proof that a connection's ROLE is least-privilege read-only (rule 5, hardened): no
 *  superuser/CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS attributes; not the database or
 *  inspected-schema owner; owns none of the inspected tables; not a member of any
 *  privileged/owner role; no CREATE on the database or inspected schemas; no
 *  INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on inspected tables; and
 *  default_transaction_read_only enabled. `violations` is empty for a compliant role. */
export interface RoleReadOnlyProof {
  label: string // 'source' | 'target'
  role: string
  database: string
  isSuperuser: boolean
  canCreateDb: boolean
  canCreateRole: boolean
  isReplication: boolean
  bypassRls: boolean
  isDatabaseOwner: boolean
  ownedSchemas: string[]
  ownedTables: string[]
  schemasWithCreate: string[]
  tablesWritable: string[]
  canCreateOnDatabase: boolean
  memberOfPrivilegedRoleCount: number
  defaultTransactionReadOnly: string
  violations: string[]
}
/** Offline-snapshot provenance: the exported file's declared version, its generation timestamp,
 *  and a deterministic SHA-256 of the file bytes. */
export interface SnapshotFileMeta {
  version: number
  generatedAt: string
  sha256: string
}

export interface SourceSnapshot {
  authUsers: SrcAuthUser[]
  teams: SrcTeam[]
  members: SrcMember[]
  invites: SrcInvite[]
  /** 'live' = read from Supabase over one RR READ ONLY tx; 'offline_snapshot' = loaded from a local file. */
  mode: 'live' | 'offline_snapshot'
  proof: SnapshotProof | null // live mode only
  roleProof: RoleReadOnlyProof | null // live mode only
  snapshotMeta: SnapshotFileMeta | null // offline mode only
}

// ── Target snapshot (read-only from Prisma) ──
// Every read column is OPTIONAL: a field is `undefined` ONLY when its column is absent on the live
// target (legacy/drift). The analyzer NEVER coerces a missing field to a default -- it consults the
// column-drift report (below) and reports the dependent check as unavailable. supabaseTeamId/
// archivedAt remain string|null / number|null (their presence is the Phase 3A report's concern).
export interface TgtUser { id?: string; authProviderId?: string; email?: string }
export interface TgtTeam { id?: string; name?: string; supabaseTeamId: string | null; archivedAt: number | null; createdAt?: number }
export interface TgtMembership { id?: string; userId?: string; teamId?: string; role?: string; status?: string; scopeType?: string; scopeGroups?: unknown; scopePhones?: unknown; overrides?: unknown }
export interface TgtInvite { id?: string; teamId?: string; email?: string; token?: string; status?: string }

/** Which analysis a read column powers -- so a missing column reports exactly what becomes
 *  unavailable: a child-row count, an identity check, artifact classification, or a parity check. */
export type ReadImpact = 'count' | 'identity' | 'artifact' | 'parity'

/** An expected read column that is absent on a PRESENT target table. */
export interface ColumnDrift { table: string; column: string; impacts: ReadImpact[] }

/** Target column-drift report: every (table,column) the inventory intended to read was inspected via
 *  information_schema.columns BEFORE any query; `missing` columns are never selected. byTable carries
 *  per-table present/missing names for the analyzer's availability gating and the human report. */
export interface TargetColumnReport {
  inspected: Array<{ table: string; column: string }>
  present: Array<{ table: string; column: string }>
  missing: ColumnDrift[]
  byTable: Record<string, { present: string[]; missing: string[] }>
}
/** Target schema-drift report: expected = tables the inventory reads; present/missing = of those;
 *  extra = present public tables not read by the inventory (excludes internal `_*`). */
export interface TargetSchemaReport {
  expected: string[]
  present: string[]
  missing: string[]
  extra: string[]
}

/** Presence of the Phase 3A schema items in the live target (the 3A migration may not be
 *  deployed yet). When `supabaseTeamIdPresent` is false the mapping/artifact analysis cannot run
 *  and its conclusions are reported as unavailable (null), not zero. `missing` lists each absent
 *  required item (e.g. "Team.supabaseTeamId", "MigrationRecord"). */
export interface Phase3aSchemaReport {
  supabaseTeamIdPresent: boolean
  archivedAtPresent: boolean
  inviteInvitedByNullable: boolean
  migrationRecordPresent: boolean
  missing: string[]
}

/** childCountsByTeam[teamId][relationModel] = row count (every PRESENT Team relation whose FK column
 *  also exists, from DMMF). */
export interface TargetSnapshot {
  users: TgtUser[]
  teams: TgtTeam[]
  memberships: TgtMembership[]
  invites: TgtInvite[]
  childCountsByTeam: Record<string, Record<string, number>>
  auditCountByTeam: Record<string, number>
  schema: TargetSchemaReport
  phase3a: Phase3aSchemaReport
  /** Column-drift report. Optional only so pure analyzer fixtures may omit it (then every read
   *  column is treated as present); the live target reader ALWAYS populates it. */
  columns?: TargetColumnReport
}

export type ArtifactClass = 'auto_provision_candidate' | 'native' | 'unknown'

export interface ArtifactVerdict {
  teamId: string
  teamName: string
  classification: ArtifactClass
  evidence: {
    memberCount: number
    ownerCount: number
    hasChildren: boolean
    childCounts: Record<string, number>
    auditCount: number
    nameMatchesAutoProvisionPattern: boolean
    ownerIsMigrated: boolean
    createdAfterOwnerSupabaseMembership: boolean | null
  }
}

export interface InventoryReport {
  /** Set by the script after analyze() (pure code cannot read the clock). */
  generatedAt: string | null
  /** 'live' or 'offline_snapshot'. */
  sourceMode: 'live' | 'offline_snapshot'
  /** Offline-snapshot provenance (version/generatedAt/sha256); null in live mode. */
  sourceSnapshot: SnapshotFileMeta | null
  /** Source role read-only proof (carried from the snapshot); null in offline mode. */
  sourceRole: RoleReadOnlyProof | null
  /** Set by the script after the target read-only pre-flight (analyze() leaves it null). */
  targetReadOnly: RoleReadOnlyProof | null
  source: { authUsers: number; teams: number; members: number; invites: number; proof: SnapshotProof | null }
  // mappedTeams/unmappedActiveTeams/archivedTeams are null = UNAVAILABLE (the Phase 3A column the
  // count depends on is absent) -- never silently 0.
  target: { users: number; teams: number; mappedTeams: number | null; unmappedActiveTeams: number | null; archivedTeams: number | null; memberships: number; invites: number }
  targetSchema: TargetSchemaReport
  /** Read-column drift: which expected columns are present/missing on present tables. */
  targetColumns: TargetColumnReport
  phase3a: Phase3aSchemaReport
  /** Which analysis sections are degraded because a column they depend on is absent. A section is
   *  'unavailable' rather than silently computed from a default/empty value. `notes` names the
   *  missing columns behind each degradation. */
  provisional: {
    identity: 'available' | 'degraded'
    membershipParity: 'available' | 'unavailable'
    artifactClassification: 'available' | 'unavailable'
    notes: string[]
  }
  plan: {
    usersToCreate: number
    teamsToCreate: number | null // null = unavailable (mapping needs Team.supabaseTeamId)
    teamsAlreadyMapped: number | null
    membershipsToUpsert: number
    invitesToMigrate: number
    artifactsToArchive: number | null
  }
  artifacts: ArtifactVerdict[]
  findings: Finding[]
  blockers: Finding[]
  counts: { byCode: Record<string, number>; bySeverity: Record<Severity, number> }
  hasBlockers: boolean
}

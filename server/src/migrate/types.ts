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
  entity: 'user' | 'team' | 'membership' | 'invite'
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
export interface SourceSnapshot {
  authUsers: SrcAuthUser[]
  teams: SrcTeam[]
  members: SrcMember[]
  invites: SrcInvite[]
  proof: SnapshotProof
}

// ── Target snapshot (read-only from Prisma) ──
export interface TgtUser { id: string; authProviderId: string; email: string }
export interface TgtTeam { id: string; name: string; supabaseTeamId: string | null; archivedAt: number | null; createdAt: number }
export interface TgtMembership { id: string; userId: string; teamId: string; role: string; status: string; scopeType: string; scopeGroups: unknown; scopePhones: unknown; overrides: unknown }
export interface TgtInvite { id: string; teamId: string; email: string; token: string; status: string }
/** childCountsByTeam[teamId][relationModel] = row count (every Team relation, from DMMF). */
export interface TargetSnapshot {
  users: TgtUser[]
  teams: TgtTeam[]
  memberships: TgtMembership[]
  invites: TgtInvite[]
  childCountsByTeam: Record<string, Record<string, number>>
  auditCountByTeam: Record<string, number>
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
  source: { authUsers: number; teams: number; members: number; invites: number; proof: SnapshotProof | null }
  target: { users: number; teams: number; mappedTeams: number; unmappedActiveTeams: number; archivedTeams: number; memberships: number; invites: number }
  plan: {
    usersToCreate: number
    teamsToCreate: number
    teamsAlreadyMapped: number
    membershipsToUpsert: number
    invitesToMigrate: number
    artifactsToArchive: number
  }
  artifacts: ArtifactVerdict[]
  findings: Finding[]
  blockers: Finding[]
  counts: { byCode: Record<string, number>; bySeverity: Record<Severity, number> }
  hasBlockers: boolean
}

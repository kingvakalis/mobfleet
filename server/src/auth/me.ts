import { effectivePermissions } from '../../../src/lib/authorization/effective-access'
import { toMember, type MembershipClassification } from './db'

/** A membership row (with its team) — the fields /v1/me needs to shape the response
 *  and compute permissions. The Prisma membership-with-team satisfies this shape. */
export interface MeMembership {
  id: string
  userId: string
  teamId: string
  role: string
  status: string
  scopeType?: string | null
  scopeGroups?: unknown
  scopePhones?: unknown
  overrides?: unknown
  team: { id: string; name: string }
}

/** One workspace the caller belongs to — a membership projected as a switchable
 *  team. `current` marks the selected team; `status` lets the client distinguish
 *  active (switchable) from suspended memberships. The set of AVAILABLE teams is
 *  this list filtered to `status === 'active'`; the full list is the caller's
 *  ACTIVE-and-SUSPENDED membership roster (so the UI can show "suspended in X"). */
export interface MeTeamSummary {
  teamId: string
  name: string
  role: string
  status: string
  membershipId: string
  current: boolean
}

/** Authoritative post-login state. Distinct states never collapse into "forbidden":
 *  a no-team user is `onboardingRequired`, a non-active member is `suspended`.
 *  `teams` is the caller's full membership roster (every team they belong to with
 *  the caller's role + status there); `emailVerified` is the IdP account flag the
 *  invite-accept gate depends on. Both are derived only from the verified identity
 *  and the caller's own rows — never from client input. */
export interface MeResponse {
  user: { id: string; email: string }
  profile: { id: string; displayName: string | null } | null
  membership: { id: string; teamId: string; role: string; status: string } | null
  team: { id: string; name: string } | null
  role: string | null
  permissions: string[]
  onboardingRequired: boolean
  suspended: boolean
  emailVerified: boolean
  teams: MeTeamSummary[]
  pendingInvite: { id: string; teamId: string; teamName: string; role: string } | null
}

/** Project the caller's memberships into the switchable-team roster, marking the
 *  currently-selected team. PURE. The caller passes the chosen team id (or null
 *  when onboarding/suspended → nothing is current). Ordering mirrors the input
 *  (createdAt asc), so the UI gets a stable list. */
export function buildTeams(memberships: MeMembership[], currentTeamId: string | null): MeTeamSummary[] {
  return memberships.map((m) => ({
    teamId: m.teamId,
    name: m.team.name,
    role: m.role,
    status: m.status,
    membershipId: m.id,
    current: currentTeamId !== null && m.teamId === currentTeamId,
  }))
}

/**
 * Shape the /v1/me payload. PURE (DB-free): the caller resolves the classification +
 * pending invite (resolveMeState); permissions are computed here from the chosen
 * membership via the shared effective-access engine, so they exactly match what the
 * server enforces. A non-ready user carries an empty permission set and null
 * team/role/membership — onboardingRequired/suspended say WHY, never ACCESS RESTRICTED.
 */
export function buildMeResponse(input: {
  identity: { providerUserId: string; email: string; emailVerified: boolean }
  user: { id: string; email: string; name: string | null }
  /** The caller's full membership roster (each row with its team), createdAt asc.
   *  Used to build `teams` — every team gets surfaced regardless of which is chosen. */
  memberships: MeMembership[]
  classification: MembershipClassification<MeMembership>
  pendingInvite: { id: string; teamId: string; teamName: string; role: string } | null
}): MeResponse {
  const { identity, user, memberships, classification, pendingInvite } = input
  const currentTeamId = classification.status === 'ready' ? classification.chosen.teamId : null
  const base: MeResponse = {
    user: { id: identity.providerUserId, email: identity.email },
    profile: { id: user.id, displayName: user.name },
    membership: null,
    team: null,
    role: null,
    permissions: [],
    onboardingRequired: classification.status === 'onboarding',
    suspended: classification.status === 'suspended',
    emailVerified: identity.emailVerified,
    teams: buildTeams(memberships, currentTeamId),
    pendingInvite,
  }
  if (classification.status !== 'ready') return base
  const m = classification.chosen
  return {
    ...base,
    membership: { id: m.id, teamId: m.teamId, role: m.role, status: m.status },
    team: { id: m.team.id, name: m.team.name },
    role: m.role,
    permissions: [...effectivePermissions(toMember(m))],
  }
}

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

/** Authoritative post-login state. Distinct states never collapse into "forbidden":
 *  a no-team user is `onboardingRequired`, a non-active member is `suspended`. */
export interface MeResponse {
  user: { id: string; email: string }
  profile: { id: string; displayName: string | null } | null
  membership: { id: string; teamId: string; role: string; status: string } | null
  team: { id: string; name: string } | null
  role: string | null
  permissions: string[]
  onboardingRequired: boolean
  suspended: boolean
  pendingInvite: { id: string; teamId: string; teamName: string; role: string } | null
}

/**
 * Shape the /v1/me payload. PURE (DB-free): the caller resolves the classification +
 * pending invite (resolveMeState); permissions are computed here from the chosen
 * membership via the shared effective-access engine, so they exactly match what the
 * server enforces. A non-ready user carries an empty permission set and null
 * team/role/membership — onboardingRequired/suspended say WHY, never ACCESS RESTRICTED.
 */
export function buildMeResponse(input: {
  identity: { providerUserId: string; email: string }
  user: { id: string; email: string; name: string | null }
  classification: MembershipClassification<MeMembership>
  pendingInvite: { id: string; teamId: string; teamName: string; role: string } | null
}): MeResponse {
  const { identity, user, classification, pendingInvite } = input
  const base: MeResponse = {
    user: { id: identity.providerUserId, email: identity.email },
    profile: { id: user.id, displayName: user.name },
    membership: null,
    team: null,
    role: null,
    permissions: [],
    onboardingRequired: classification.status === 'onboarding',
    suspended: classification.status === 'suspended',
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

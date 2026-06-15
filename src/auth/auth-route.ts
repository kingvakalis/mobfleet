import type { TeamRole } from '@/lib/database.types'

/**
 * The authoritative post-authentication routing decision — the SINGLE place that
 * classifies an authenticated user's app state. Pure + unit-tested so the rules are
 * verifiable and there is exactly one routing brain (the OnboardingGate consumes
 * this; no competing redirects in pages/effects/layouts).
 *
 * The whole point: a brand-new authenticated user with no team is
 * `onboarding_required`, NOT `forbidden`. These stay distinct — loading, suspended,
 * API/DB error, onboarding-required, and ready — so none collapse into ACCESS
 * RESTRICTED. Access-restricted is reserved for a real member who lacks permission
 * for a resource (enforced inside the app, not here).
 */
export interface AuthRouteState {
  /** Supabase configured. When false, the standalone/demo build renders freely. */
  enabled: boolean
  /** Membership still resolving. */
  loading: boolean
  /** Membership exists but is not active (suspended/removed). */
  suspended: boolean
  /** Membership resolution hit an API/DB error (never treat as "no team"). */
  error: boolean
  /** An active team membership was resolved. */
  hasTeam: boolean
  role: TeamRole | null
  /** The owner completed the first-run onboarding survey. */
  onboarded: boolean
  /** A pending invite token stashed pre-auth (takes precedence over team creation). */
  pendingInvite: string | null
}

export type AuthRouteDecision =
  | { kind: 'render' }
  | { kind: 'loading' }
  | { kind: 'suspended' }
  | { kind: 'error' }
  | { kind: 'redirect'; to: string }

export function resolveAuthRoute(s: AuthRouteState): AuthRouteDecision {
  // Standalone/demo build (Supabase unconfigured): auth + gating are no-ops.
  if (!s.enabled) return { kind: 'render' }
  // A pending invite is redeemed before anything else — never auto-create an
  // unrelated personal team for someone who was invited to an existing one.
  if (s.pendingInvite) return { kind: 'redirect', to: `/invite?token=${encodeURIComponent(s.pendingInvite)}` }
  // Never decide while membership is resolving — show the loader, never the
  // dashboard and never ACCESS RESTRICTED.
  if (s.loading) return { kind: 'loading' }
  // Suspended/removed members get the suspended screen, never a bypass team.
  if (s.suspended) return { kind: 'suspended' }
  // Workspace failed to load (API/DB). Retryable; do NOT route to onboarding and
  // do NOT auto-create a team during an outage. (A non-fatal error WITH a resolved
  // team falls through to render.)
  if (s.error && !s.hasTeam) return { kind: 'error' }
  // Authenticated but no team yet → onboarding (where the first team is created).
  if (!s.hasTeam) return { kind: 'redirect', to: '/onboarding' }
  // Workspace owner who hasn't finished the onboarding survey → onboarding.
  if (s.role === 'owner' && !s.onboarded) return { kind: 'redirect', to: '/onboarding' }
  // Active member with a team → render the app (permission checks happen inside).
  return { kind: 'render' }
}

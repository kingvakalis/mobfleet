import type { TeamRole } from '@/lib/database.types'

/**
 * The authoritative post-auth routing decision when the GATE is driven by the backend
 * `GET /v1/me` (Prisma) — the `me`-mode counterpart to resolveAuthRoute(). Pure +
 * import-free so it runs in the Playwright `engine` project (no `@/` alias / no DB).
 *
 * The hard reality this encodes: the Prisma team id (`team_<uuid>`, separate DB) and the
 * Supabase team id (bare uuid) are DISJOINT and un-mapped. So `/v1/me` is the authority
 * for routing + role ONLY; every business screen still reads the Supabase team. The gate
 * therefore must:
 *   • NEVER admit to a dashboard whose Supabase data layer is missing/erroring (no empty admit),
 *   • NEVER treat a backend `/v1/me` failure as "onboarding required" (it is `error`),
 *   • NEVER mint a bogus owner Prisma team for an existing Supabase NON-owner who simply
 *     hasn't been migrated yet (that's `awaiting-migration`, resolved by the Step 3 migration),
 *   • redeem a pending invite via the Supabase token FIRST (the Prisma /v1/me.pendingInvite is
 *     intentionally ignored here — it carries no redeemable token).
 */
export interface AuthzRouteState {
  /** Supabase auth configured. When false, the standalone/demo build renders freely. */
  enabled: boolean
  /** Initial Supabase session check still in flight. */
  sessionLoading: boolean
  /** A Supabase session exists. */
  hasSession: boolean
  /** `GET /v1/me` still loading. */
  authzLoading: boolean
  /** `GET /v1/me` errored (any status: 401 / 5xx / network). Retryable — never onboarding. */
  authzFailed: boolean
  /** `/v1/me`: no active Prisma membership. */
  onboardingRequired: boolean
  /** `/v1/me`: memberships exist but none active. */
  suspended: boolean
  /** `/v1/me`: the active Prisma role. */
  meRole: TeamRole | null
  /** The owner finished the first-run onboarding survey (Supabase user_metadata.onboarded). */
  surveyed: boolean
  /** A redeemable Supabase invite token stashed pre-auth (takes precedence over team creation). */
  localInviteToken: string | null
  /** The Supabase data-layer team has resolved (drives every business screen). */
  supabaseTeamPresent: boolean
  /** The Supabase data-layer team is still resolving. */
  supabaseTeamLoading: boolean
  /** The Supabase data-layer team load errored. */
  supabaseTeamError: boolean
  /** The current user's Supabase role (used to distinguish owner vs member pre-migration). */
  supabaseRole: TeamRole | null
}

export type AuthzRouteDecision =
  | { kind: 'render' }
  | { kind: 'loading' }
  | { kind: 'suspended' }
  | { kind: 'error' }
  | { kind: 'awaiting-migration' }
  | { kind: 'redirect'; to: string }

export function resolveAuthzDecision(s: AuthzRouteState): AuthzRouteDecision {
  // Standalone/demo build (Supabase unconfigured): auth + gating are no-ops.
  if (!s.enabled) return { kind: 'render' }
  // Supabase invite precedence — redeem the (token-bearing) Supabase invite before any
  // team creation. The Prisma /v1/me.pendingInvite is NOT consulted (no redeemable token).
  if (s.localInviteToken) return { kind: 'redirect', to: `/invite?token=${encodeURIComponent(s.localInviteToken)}` }
  // Never decide while anything the decision depends on is still loading — show the loader,
  // never the dashboard and never ACCESS RESTRICTED.
  if (s.sessionLoading || s.authzLoading || s.supabaseTeamLoading) return { kind: 'loading' }
  // No session (normally already handled upstream by ProtectedRoute).
  if (!s.hasSession) return { kind: 'redirect', to: '/login' }
  // A backend /v1/me failure (incl. 401) is retryable — NEVER onboarding, NEVER an empty admit.
  if (s.authzFailed) return { kind: 'error' }
  // Suspended/removed members get the suspended screen, never a bypass team.
  if (s.suspended) return { kind: 'suspended' }

  if (s.onboardingRequired) {
    // Genuine first-run owner: no Supabase team either → /onboarding creates BOTH
    // (Supabase team for the data layer + the Prisma authority team).
    if (!s.supabaseTeamPresent) return { kind: 'redirect', to: '/onboarding' }
    // Existing OWNER who has a Supabase team but no Prisma team yet → /onboarding silently
    // mints the matching Prisma owner team (no survey re-run).
    if (s.supabaseRole === 'owner') return { kind: 'redirect', to: '/onboarding' }
    // Existing NON-owner with a Supabase team but no Prisma membership → we must NOT mint a
    // bogus owner team (wrong team, wrong role). Hold until the Step 3 migration backfills
    // their real Prisma membership. (This case is exactly why `me`-mode stays off in prod.)
    return { kind: 'awaiting-migration' }
  }

  // `/v1/me` is ready (an active Prisma team exists):
  // Do NOT render a dashboard whose Supabase data layer failed or is absent — that would be
  // an empty/broken admit. Route to /onboarding (which backfills the Supabase team) or error.
  if (s.supabaseTeamError) return { kind: 'error' }
  if (!s.supabaseTeamPresent) return { kind: 'redirect', to: '/onboarding' }
  // Workspace owner who hasn't finished the first-run survey → finish it.
  if (s.meRole === 'owner' && !s.surveyed) return { kind: 'redirect', to: '/onboarding' }
  // Active member, authority + data layer both ready → render (permission checks happen inside).
  return { kind: 'render' }
}

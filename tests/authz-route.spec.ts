import { test, expect } from 'playwright/test'
import { resolveAuthzDecision, type AuthzRouteState } from '../src/auth/authz-route'

/**
 * Pure-function tests (no browser, no server) for the `me`-mode post-auth routing decision —
 * the authority-driven gate (GET /v1/me) used when VITE_AUTH_SOURCE=me. Runs in the Playwright
 * `engine` project. Central guarantees, INCLUDING the transitional Prisma↔Supabase mismatch
 * states (the two team-id spaces are disjoint):
 *   • a backend /v1/me failure is `error`, NEVER onboarding, NEVER an empty admit;
 *   • the gate never `render`s a dashboard whose Supabase data layer is missing/erroring;
 *   • an existing Supabase NON-owner without a Prisma team is `awaiting-migration`, never a
 *     freshly-minted bogus owner team;
 *   • a redeemable Supabase invite token routes FIRST; the Prisma /v1/me.pendingInvite is never
 *     used for routing (it isn't even an input here).
 */

// Baseline: a fully-ready owner (authority + Supabase data layer both present) → render.
const base: AuthzRouteState = {
  enabled: true,
  sessionLoading: false,
  hasSession: true,
  authzLoading: false,
  authzFailed: false,
  onboardingRequired: false,
  suspended: false,
  meRole: 'owner',
  surveyed: true,
  localInviteToken: null,
  supabaseTeamPresent: true,
  supabaseTeamLoading: false,
  supabaseTeamError: false,
  supabaseRole: 'owner',
}
const s = (o: Partial<AuthzRouteState>): AuthzRouteState => ({ ...base, ...o })

// ── Happy paths ─────────────────────────────────────────────────────────────────
test('ready owner with both authority + Supabase team → render', () => {
  expect(resolveAuthzDecision(s({}))).toEqual({ kind: 'render' })
})
test('ready non-owner member → render (no survey gate)', () => {
  expect(resolveAuthzDecision(s({ meRole: 'operator', supabaseRole: 'operator', surveyed: false }))).toEqual({ kind: 'render' })
})
test('standalone/demo build (auth disabled) → render', () => {
  expect(resolveAuthzDecision(s({ enabled: false, hasSession: false, authzFailed: true }))).toEqual({ kind: 'render' })
})

// ── Loading never decides ─────────────────────────────────────────────────────────
test('session / authz / supabase-team loading → loading (never a premature decision)', () => {
  expect(resolveAuthzDecision(s({ sessionLoading: true })).kind).toBe('loading')
  expect(resolveAuthzDecision(s({ authzLoading: true })).kind).toBe('loading')
  expect(resolveAuthzDecision(s({ supabaseTeamLoading: true })).kind).toBe('loading')
  // even with otherwise-decisive data present:
  expect(resolveAuthzDecision(s({ authzLoading: true, onboardingRequired: true })).kind).toBe('loading')
})

test('no session → /login', () => {
  expect(resolveAuthzDecision(s({ hasSession: false }))).toEqual({ kind: 'redirect', to: '/login' })
})

// ── A backend failure is ERROR, never onboarding / never an empty admit ────────────
test('authz fetch failure (5xx/network) → error, NOT onboarding', () => {
  expect(resolveAuthzDecision(s({ authzFailed: true })).kind).toBe('error')
})
test('authz failure (401-equivalent) → error, never a forced re-login loop', () => {
  // The pure machine does not special-case 401 — any /v1/me failure is retryable error.
  expect(resolveAuthzDecision(s({ authzFailed: true, onboardingRequired: true, supabaseTeamPresent: false })).kind).toBe('error')
})

// ── Suspended ──────────────────────────────────────────────────────────────────────
test('suspended → suspended (never onboarding, never a bypass team)', () => {
  expect(resolveAuthzDecision(s({ suspended: true })).kind).toBe('suspended')
})

// ── Supabase invite precedence (token-bearing) ─────────────────────────────────────
test('a stashed Supabase invite token routes to /invite FIRST', () => {
  expect(resolveAuthzDecision(s({ localInviteToken: 'tok 9' }))).toEqual({ kind: 'redirect', to: '/invite?token=tok%209' })
})
test('invite token wins over onboarding, suspended, and even loading', () => {
  for (const over of [{ onboardingRequired: true, supabaseTeamPresent: false }, { suspended: true }, { authzLoading: true }, { authzFailed: true }]) {
    expect(resolveAuthzDecision(s({ ...over, localInviteToken: 'abc' }))).toEqual({ kind: 'redirect', to: '/invite?token=abc' })
  }
})

// ── Onboarding (new owner) ─────────────────────────────────────────────────────────
test('genuine new owner (no Prisma team, no Supabase team) → /onboarding', () => {
  expect(resolveAuthzDecision(s({ onboardingRequired: true, supabaseTeamPresent: false, supabaseRole: null, surveyed: false })))
    .toEqual({ kind: 'redirect', to: '/onboarding' })
})

// ── Mismatch state: Supabase team EXISTS, Prisma team ABSENT ───────────────────────
test('existing OWNER with a Supabase team but no Prisma team → /onboarding (silently mints Prisma team)', () => {
  expect(resolveAuthzDecision(s({ onboardingRequired: true, supabaseTeamPresent: true, supabaseRole: 'owner' })))
    .toEqual({ kind: 'redirect', to: '/onboarding' })
})
test('existing NON-owner with a Supabase team but no Prisma team → awaiting-migration (NEVER a bogus owner team)', () => {
  expect(resolveAuthzDecision(s({ onboardingRequired: true, supabaseTeamPresent: true, supabaseRole: 'operator' })).kind)
    .toBe('awaiting-migration')
})

// ── Mismatch state: Prisma team EXISTS, Supabase team ABSENT/ERRORED ───────────────
test('ready authority but Supabase team absent → /onboarding (backfill), NEVER render an empty dashboard', () => {
  const d = resolveAuthzDecision(s({ supabaseTeamPresent: false, supabaseRole: null }))
  expect(d).toEqual({ kind: 'redirect', to: '/onboarding' })
  expect(d.kind).not.toBe('render')
})
test('/v1/me ok but Supabase business-data load FAILS → error, never an empty admit', () => {
  expect(resolveAuthzDecision(s({ supabaseTeamError: true })).kind).toBe('error')
  // even when the Supabase team is also reported absent during the error:
  expect(resolveAuthzDecision(s({ supabaseTeamPresent: false, supabaseTeamError: true })).kind).toBe('error')
})

// ── Owner survey gate ──────────────────────────────────────────────────────────────
test('ready owner who has NOT finished the survey → /onboarding', () => {
  expect(resolveAuthzDecision(s({ surveyed: false }))).toEqual({ kind: 'redirect', to: '/onboarding' })
})

// ── Invariants ─────────────────────────────────────────────────────────────────────
test('a backend /v1/me failure NEVER yields render', () => {
  for (const over of [{}, { onboardingRequired: true }, { supabaseTeamPresent: false }, { suspended: true }]) {
    expect(resolveAuthzDecision(s({ ...over, authzFailed: true })).kind).not.toBe('render')
  }
})
test('onboardingRequired NEVER yields render (no admit without a Prisma team)', () => {
  for (const role of ['owner', 'admin', 'operator', 'viewer'] as const) {
    expect(resolveAuthzDecision(s({ onboardingRequired: true, supabaseRole: role })).kind).not.toBe('render')
  }
})
test('the Prisma /v1/me.pendingInvite cannot drive routing — only a Supabase token does', () => {
  // There is no pendingInvite input here BY DESIGN. With no token, an onboarding-required user
  // resolves via /onboarding or awaiting-migration — never to /invite.
  expect(resolveAuthzDecision(s({ onboardingRequired: true, supabaseTeamPresent: false, localInviteToken: null })).kind).toBe('redirect')
  expect(resolveAuthzDecision(s({ onboardingRequired: true, supabaseTeamPresent: false, localInviteToken: null })))
    .not.toEqual({ kind: 'redirect', to: '/invite' })
})

import { test, expect } from 'playwright/test'
import { resolveAuthRoute, type AuthRouteState } from '../src/auth/auth-route'

/**
 * Pure-function tests (no browser, no server) for the authoritative post-auth
 * routing decision. Runs in the Playwright `engine` project. The central guarantee:
 * an authenticated user with no team is `onboarding_required`, never `forbidden` —
 * so a brand-new sign-in is never shown ACCESS RESTRICTED.
 */

const base: AuthRouteState = {
  enabled: true, loading: false, suspended: false, error: false,
  hasTeam: false, role: null, onboarded: false, pendingInvite: null,
}
const s = (o: Partial<AuthRouteState>): AuthRouteState => ({ ...base, ...o })

test('new authenticated user with no team → onboarding (NOT forbidden)', () => {
  expect(resolveAuthRoute(s({}))).toEqual({ kind: 'redirect', to: '/onboarding' })
})

test('active member with a team → render the app', () => {
  expect(resolveAuthRoute(s({ hasTeam: true, role: 'operator' }))).toEqual({ kind: 'render' })
})

test('owner who finished onboarding → render', () => {
  expect(resolveAuthRoute(s({ hasTeam: true, role: 'owner', onboarded: true }))).toEqual({ kind: 'render' })
})

test('owner who has NOT finished the survey → onboarding', () => {
  expect(resolveAuthRoute(s({ hasTeam: true, role: 'owner', onboarded: false }))).toEqual({ kind: 'redirect', to: '/onboarding' })
})

test('loading never resolves to render or a redirect (no premature decision)', () => {
  expect(resolveAuthRoute(s({ loading: true }))).toEqual({ kind: 'loading' })
  expect(resolveAuthRoute(s({ loading: true, hasTeam: true, role: 'owner' }))).toEqual({ kind: 'loading' })
})

test('API/DB error with no team → error (NOT onboarding, NOT render)', () => {
  expect(resolveAuthRoute(s({ error: true }))).toEqual({ kind: 'error' })
})

test('a non-fatal error WITH a resolved team → render (does not block a real member)', () => {
  expect(resolveAuthRoute(s({ error: true, hasTeam: true, role: 'admin' }))).toEqual({ kind: 'render' })
})

test('suspended member → suspended (never onboarding, never a bypass team)', () => {
  expect(resolveAuthRoute(s({ suspended: true }))).toEqual({ kind: 'suspended' })
  expect(resolveAuthRoute(s({ suspended: true, error: true }))).toEqual({ kind: 'suspended' })
})

test('pending invite takes precedence over team creation', () => {
  expect(resolveAuthRoute(s({ pendingInvite: 'tok 123' }))).toEqual({ kind: 'redirect', to: '/invite?token=tok%20123' })
})

test('pending invite takes precedence even over an existing team', () => {
  expect(resolveAuthRoute(s({ pendingInvite: 'abc', hasTeam: true, role: 'viewer' }))).toEqual({ kind: 'redirect', to: '/invite?token=abc' })
})

test('standalone/demo build (auth disabled) always renders', () => {
  expect(resolveAuthRoute(s({ enabled: false }))).toEqual({ kind: 'render' })
})

test('a teamless authenticated user is NEVER routed to render the gated app', () => {
  // The exact bug guard: teamless ≠ forbidden. Every teamless state resolves to
  // loading / suspended / error / onboarding — never "render" (the gated dashboard).
  for (const st of [s({}), s({ loading: true }), s({ suspended: true }), s({ error: true }), s({ pendingInvite: 'x' })]) {
    expect(resolveAuthRoute(st).kind).not.toBe('render')
  }
})

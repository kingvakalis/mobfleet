import { test, expect } from 'playwright/test'
import {
  resolveSelectedTeam,
  SELECTED_TEAM_STORAGE_KEY,
  type SelectedTeamStorage,
} from '../src/lib/selected-team'
import type { MeResponse, MeTeamSummary } from '../src/services/me-client'

/**
 * Pure-function tests for selected-team resolution — the persistence guard that
 * decides whether a localStorage team choice may be restored against the
 * authoritative /v1/me roster. No DOM: storage is injected.
 */

const KEY = SELECTED_TEAM_STORAGE_KEY

function teamSummary(over: Partial<MeTeamSummary> & { teamId: string }): MeTeamSummary {
  return {
    teamId: over.teamId,
    name: over.name ?? `Team ${over.teamId}`,
    role: over.role ?? 'member',
    status: over.status ?? 'active',
    membershipId: over.membershipId ?? `mem-${over.teamId}`,
    current: over.current ?? false,
  }
}

function me(teams: MeTeamSummary[], currentId: string | null): MeResponse {
  const current = teams.find((t) => t.teamId === currentId) ?? null
  return {
    user: { id: 'u1', email: 'u@x.io' },
    profile: { id: 'p1', displayName: null },
    membership: null,
    team: current ? { id: current.teamId, name: current.name } : null,
    role: current?.role ?? null,
    permissions: [],
    onboardingRequired: false,
    suspended: false,
    emailVerified: true,
    teams,
    pendingInvite: null,
  }
}

/** A fake storage seeded with an optional stored value. */
function fakeStorage(stored: string | null): SelectedTeamStorage & { value: string | null } {
  const box = { value: stored }
  return {
    value: stored,
    getItem: (k: string) => (k === KEY ? box.value : null),
    setItem: (k: string, v: string) => { if (k === KEY) box.value = v },
    removeItem: (k: string) => { if (k === KEY) box.value = null },
  }
}

test('no stored selection → none, honour the server current team', () => {
  const r = resolveSelectedTeam(me([teamSummary({ teamId: 'a', current: true })], 'a'), fakeStorage(null))
  expect(r.action).toBe('none')
  expect(r.teamId).toBe('a')
})

test('stored team equals current → none (no needless switch)', () => {
  const r = resolveSelectedTeam(me([teamSummary({ teamId: 'a', current: true })], 'a'), fakeStorage('a'))
  expect(r.action).toBe('none')
  expect(r.teamId).toBe('a')
})

test('stored team is active and different → restore it', () => {
  const teams = [
    teamSummary({ teamId: 'a', current: true }),
    teamSummary({ teamId: 'b', status: 'active' }),
  ]
  const r = resolveSelectedTeam(me(teams, 'a'), fakeStorage('b'))
  expect(r.action).toBe('restore')
  expect(r.teamId).toBe('b')
})

test('stored team not in the roster → discard, fall back to current', () => {
  const r = resolveSelectedTeam(
    me([teamSummary({ teamId: 'a', current: true })], 'a'),
    fakeStorage('gone'),
  )
  expect(r.action).toBe('discard')
  expect(r.teamId).toBe('a')
  if (r.action === 'discard') expect(r.message).toMatch(/no longer available/i)
})

test('stored team present but suspended → discard with status reason', () => {
  const teams = [
    teamSummary({ teamId: 'a', current: true }),
    teamSummary({ teamId: 'b', status: 'suspended', name: 'Acme' }),
  ]
  const r = resolveSelectedTeam(me(teams, 'a'), fakeStorage('b'))
  expect(r.action).toBe('discard')
  expect(r.teamId).toBe('a')
  if (r.action === 'discard') expect(r.message).toMatch(/suspended/i)
})

test('current resolves via the `current` flag when me.team is absent', () => {
  const teams = [
    teamSummary({ teamId: 'a', current: true }),
    teamSummary({ teamId: 'b', status: 'active' }),
  ]
  // me.team null but roster marks `a` current → a stored `a` is a no-op.
  const r = resolveSelectedTeam(me(teams, null), fakeStorage('a'))
  expect(r.action).toBe('none')
  expect(r.teamId).toBe('a')
})

test('null storage (no persistence available) → none', () => {
  const r = resolveSelectedTeam(me([teamSummary({ teamId: 'a', current: true })], 'a'), null)
  expect(r.action).toBe('none')
  expect(r.teamId).toBe('a')
})

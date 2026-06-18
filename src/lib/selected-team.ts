import type { MeResponse } from '@/services/me-client'

/**
 * Selected-team persistence.
 *
 * The active team header (x-team-id) is held IN-MEMORY in
 * `lib/provider/auth-token.ts` and is reset to the server's current team on every
 * page load. Users with multiple workspaces lose their selection on refresh.
 *
 * This module persists the user's deliberate team choice to localStorage and
 * resolves it against the AUTHORITATIVE `/v1/me` roster on load:
 *   - restore ONLY a team that is present AND `status === 'active'` in the roster
 *     (a removed / suspended / foreign id is never restored — never a silent
 *      wrong-team switch).
 *   - if the stored id is missing/stale/suspended, DISCARD it and fall back to
 *     the server's current team, surfacing a clear message to the caller.
 *
 * `resolveSelectedTeam` is a PURE function (storage injected) so it is unit-tested
 * without a DOM. The thin `loadSelectedTeam` / `saveSelectedTeam` / `clearSelectedTeam`
 * wrappers bind it to `window.localStorage` (guarded for SSR/tests).
 */

const STORAGE_KEY = 'mobfleet.selectedTeamId'

/** Minimal storage surface — `window.localStorage` satisfies it; tests pass a fake. */
export interface SelectedTeamStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type SelectedTeamResolution =
  /** No stored selection (or it already equals the current team): nothing to do. */
  | { action: 'none'; teamId: string | null }
  /** A valid, ACTIVE, non-current stored team: switch to it via POST /v1/me/team. */
  | { action: 'restore'; teamId: string }
  /** The stored team is gone / suspended / foreign: it was cleared, stay on the
   *  server's current team. `message` is a human reason the caller can surface. */
  | { action: 'discard'; teamId: string | null; message: string }

function currentTeamId(me: MeResponse): string | null {
  // Prefer the explicit `current` flag from the roster; fall back to `me.team`.
  return me.teams.find((t) => t.current)?.teamId ?? me.team?.id ?? null
}

/**
 * Decide what to do with a persisted selection against the live `/v1/me` roster.
 * PURE — no I/O beyond the injected storage reader.
 */
export function resolveSelectedTeam(
  me: MeResponse,
  storage: Pick<SelectedTeamStorage, 'getItem'> | null,
): SelectedTeamResolution {
  const stored = storage?.getItem(STORAGE_KEY) ?? null
  const current = currentTeamId(me)

  // No persisted choice → honour whatever the server selected.
  if (!stored) return { action: 'none', teamId: current }

  // Already on the stored team → no switch needed.
  if (stored === current) return { action: 'none', teamId: current }

  const match = me.teams.find((t) => t.teamId === stored)

  // Stored id is not in the roster at all (left/removed/foreign).
  if (!match) {
    return {
      action: 'discard',
      teamId: current,
      message: 'Your previously selected workspace is no longer available. Switched to your current workspace.',
    }
  }

  // In the roster but not switchable (suspended / non-active membership).
  if (match.status !== 'active') {
    return {
      action: 'discard',
      teamId: current,
      message: `Access to “${match.name}” is ${match.status}. Switched to your current workspace.`,
    }
  }

  // Valid, active, and different from the current team → restore it.
  return { action: 'restore', teamId: match.teamId }
}

// ─── localStorage-bound wrappers (guarded for SSR / non-DOM test envs) ──────────

function defaultStorage(): SelectedTeamStorage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    // Access can throw in privacy modes — treat as no persistence.
    return null
  }
}

/** Resolve the persisted selection from `window.localStorage` (pure logic in
 *  `resolveSelectedTeam`). Returns `{ action: 'none' }` when storage is absent. */
export function loadSelectedTeam(
  me: MeResponse,
  storage: SelectedTeamStorage | null = defaultStorage(),
): SelectedTeamResolution {
  return resolveSelectedTeam(me, storage)
}

/** Persist a deliberate team choice (called on a successful switch). */
export function saveSelectedTeam(
  teamId: string,
  storage: SelectedTeamStorage | null = defaultStorage(),
): void {
  storage?.setItem(STORAGE_KEY, teamId)
}

/** Forget any persisted selection (called on sign-out and after a discard). */
export function clearSelectedTeam(
  storage: SelectedTeamStorage | null = defaultStorage(),
): void {
  storage?.removeItem(STORAGE_KEY)
}

export { STORAGE_KEY as SELECTED_TEAM_STORAGE_KEY }

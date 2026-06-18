import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { prisma } from './db'

/**
 * Per-(team, user) preferences — a free-form JSON blob owned by the acting user,
 * scoped to the active team. Unlike WorkspaceSettings (one row per team, team-wide),
 * this is the CALLER's own preferences within a team: it is always read/written for
 * ctx().userId in ctx().teamId, so a user can never read or mutate another user's
 * preferences and one team's blob never bleeds into another (the @@unique([teamId,
 * userId]) key).
 *
 * The Prisma `UserPreference` model does NOT exist yet (see PROPOSALS.md). This module
 * compiles against an injectable DB PORT; `prismaUserPreferencesDb()` adapts the live
 * client via `prisma as unknown as UserPreferencesDb`, so `tsc --noEmit` passes
 * without the delegate and the integration tests SKIP until the model exists.
 */

const MAX_PREFERENCES_BYTES = 32_768 // 32 KiB cap on the serialized blob

// ── Validation (Zod v4) ───────────────────────────────────────────────────────
// An opaque JSON object (not an array / scalar). The size cap defends the column
// against an abusive payload; concrete keys are intentionally open (the SPA owns the
// shape) but it must be a plain object so a merge-patch is well-defined.

export const preferencesPatch = z
  .record(z.string(), z.unknown())
  .refine((v) => byteLength(v) <= MAX_PREFERENCES_BYTES, {
    message: `preferences exceed the ${MAX_PREFERENCES_BYTES}-byte limit`,
  })
export type PreferencesPatch = z.infer<typeof preferencesPatch>

export function byteLength(v: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(v ?? {}), 'utf8')
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

/** Coerce arbitrary persisted/client input to a plain object (never array/scalar/null). Pure. */
export function normalizePreferences(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return raw as Record<string, unknown>
}

/** Shallow-merge a patch over the current preferences (patch keys win). Pure. */
export function applyPreferencesPatch(current: unknown, patch: PreferencesPatch): Record<string, unknown> {
  return { ...normalizePreferences(current), ...patch }
}

// ── DB port + adapter ─────────────────────────────────────────────────────────

export interface UserPreferenceRow {
  id: string
  teamId: string
  userId: string
  preferences: unknown // Json
  updatedAt: number
}

export interface UserPreferencesDb {
  userPreference: {
    findUnique(args: unknown): Promise<UserPreferenceRow | null>
    upsert(args: unknown): Promise<UserPreferenceRow>
  }
}

export function prismaUserPreferencesDb(): UserPreferencesDb {
  return prisma as unknown as UserPreferencesDb
}

const id = () => `upref_${randomUUID()}`

// ── Data access (scoped to the acting user within the active team) ────────────────

/** Load the caller's preferences for a team (empty object when none). */
export async function loadUserPreferences(teamId: string, userId: string, db: UserPreferencesDb = prismaUserPreferencesDb()): Promise<Record<string, unknown>> {
  const row = await db.userPreference.findUnique({ where: { teamId_userId: { teamId, userId } } })
  return normalizePreferences(row?.preferences ?? null)
}

/**
 * Upsert the caller's preferences for a team (true upsert on the composite unique key
 * → never a second row). The merged object is stored whole. Idempotent: re-saving the
 * same blob is a harmless update.
 */
export async function saveUserPreferences(teamId: string, userId: string, preferences: Record<string, unknown>, now: number, db: UserPreferencesDb = prismaUserPreferencesDb()): Promise<Record<string, unknown>> {
  const normalized = normalizePreferences(preferences)
  await db.userPreference.upsert({
    where: { teamId_userId: { teamId, userId } },
    create: { id: id(), teamId, userId, preferences: normalized, updatedAt: now },
    update: { preferences: normalized, updatedAt: now },
  })
  return normalized
}

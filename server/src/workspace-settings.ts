import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { prisma } from './db'

/**
 * Per-team workspace settings (one row per team) — the server-authoritative home for
 * the WorkspaceSettings contract the SPA currently persists to localStorage
 * (src/state/settings-store.ts).
 *
 * The WorkspaceSettings type + defaults are REPLICATED here as a pure const rather
 * than imported from src/state/settings-store.ts, because that module pulls in
 * zustand + `window`/matchMedia at import time — neither of which exists in the Node
 * server. Keep these in sync with the SPA contract.
 *
 * Stored whole as a JSON blob and NORMALIZED on write; a partial/legacy/corrupt blob
 * is coerced to a complete object on read (normalizeWorkspaceSettings), so a stale
 * shape is always safe. NEVER a secret.
 *
 * The Prisma `WorkspaceSettings` model does NOT exist yet (see PROPOSALS.md). This
 * module compiles against an injectable DB PORT; `prismaWorkspaceSettingsDb()` adapts
 * the live client via `prisma as unknown as WorkspaceSettingsDb`, so `tsc --noEmit`
 * passes without the delegate and the integration tests SKIP until the model exists.
 */

// ── Contract (replicated from src/state/settings-store.ts — keep in sync) ─────────

export const THEME_IDS = ['obsidian', 'graphite', 'midnight', 'titanium', 'oled'] as const
export const ACCENT_IDS = ['teal', 'cyan', 'blue', 'emerald', 'mono'] as const
export const PERFORMANCE_MODES = ['full', 'balanced', 'reduced'] as const
export const MOTION_PREFS = ['full', 'balanced', 'reduced', 'off'] as const
export const SURFACE_STYLES = ['flat', 'soft', 'glass'] as const
export const BACKGROUND_INTENSITIES = ['off', 'minimal', 'balanced', 'atmospheric'] as const
export const DENSITIES = ['comfortable', 'compact', 'dense'] as const
export const SIDEBAR_MODES = ['expanded', 'collapsed'] as const

export interface WorkspaceSettings {
  workspaceName: string
  operatorName: string
  performanceMode: (typeof PERFORMANCE_MODES)[number]
  motion: (typeof MOTION_PREFS)[number]
  reduceMotion: boolean
  theme: (typeof THEME_IDS)[number]
  accent: (typeof ACCENT_IDS)[number]
  surface: (typeof SURFACE_STYLES)[number]
  backgroundIntensity: (typeof BACKGROUND_INTENSITIES)[number]
  density: (typeof DENSITIES)[number]
  sidebarMode: (typeof SIDEBAR_MODES)[number]
  stabilizePhone: boolean
  defaultStreamQuality: number
  defaultStreamFps: number
  confirmDestructive: boolean
  activityNotifications: boolean
}

/** Server-side defaults (no `window`/OS probing — that's a client-only concern). */
export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  workspaceName: 'MobFleet',
  operatorName: 'Operator',
  performanceMode: 'full',
  motion: 'full',
  reduceMotion: false,
  theme: 'obsidian',
  accent: 'teal',
  surface: 'soft',
  backgroundIntensity: 'balanced',
  density: 'comfortable',
  sidebarMode: 'expanded',
  stabilizePhone: false,
  defaultStreamQuality: 22,
  defaultStreamFps: 18,
  confirmDestructive: true,
  activityNotifications: true,
}

// ── Validation (Zod v4) ───────────────────────────────────────────────────────
// A partial patch — each key optional so a caller can toggle one field. Enums + bounds
// mirror the contract; the route merges the patch over the current (normalized) value.

export const workspaceSettingsPatch = z.object({
  workspaceName: z.string().trim().min(1).max(120).optional(),
  operatorName: z.string().trim().min(1).max(120).optional(),
  performanceMode: z.enum(PERFORMANCE_MODES).optional(),
  motion: z.enum(MOTION_PREFS).optional(),
  reduceMotion: z.boolean().optional(),
  theme: z.enum(THEME_IDS).optional(),
  accent: z.enum(ACCENT_IDS).optional(),
  surface: z.enum(SURFACE_STYLES).optional(),
  backgroundIntensity: z.enum(BACKGROUND_INTENSITIES).optional(),
  density: z.enum(DENSITIES).optional(),
  sidebarMode: z.enum(SIDEBAR_MODES).optional(),
  stabilizePhone: z.boolean().optional(),
  defaultStreamQuality: z.number().int().min(0).max(100).optional(),
  defaultStreamFps: z.number().int().min(1).max(60).optional(),
  confirmDestructive: z.boolean().optional(),
  activityNotifications: z.boolean().optional(),
})
export type WorkspaceSettingsPatch = z.infer<typeof workspaceSettingsPatch>

// ── Normalization (pure — coerce any blob to a complete, valid object) ────────────

const oneOf = <T extends string>(opts: readonly T[], v: unknown, fallback: T): T =>
  typeof v === 'string' && (opts as readonly string[]).includes(v) ? (v as T) : fallback

const boolOr = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)

const intInRange = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === 'number' ? v : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

const strOr = (v: unknown, max: number, fallback: string): string => {
  if (typeof v !== 'string') return fallback
  const t = v.trim()
  return t.length === 0 ? fallback : t.slice(0, max)
}

/** Coerce arbitrary persisted/client input into a complete, valid WorkspaceSettings.
 *  Every field falls back to its default — a partial or corrupt blob is always safe. */
export function normalizeWorkspaceSettings(raw: unknown): WorkspaceSettings {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_WORKSPACE_SETTINGS
  return {
    workspaceName: strOr(o.workspaceName, 120, d.workspaceName),
    operatorName: strOr(o.operatorName, 120, d.operatorName),
    performanceMode: oneOf(PERFORMANCE_MODES, o.performanceMode, d.performanceMode),
    motion: oneOf(MOTION_PREFS, o.motion, d.motion),
    reduceMotion: boolOr(o.reduceMotion, d.reduceMotion),
    theme: oneOf(THEME_IDS, o.theme, d.theme),
    accent: oneOf(ACCENT_IDS, o.accent, d.accent),
    surface: oneOf(SURFACE_STYLES, o.surface, d.surface),
    backgroundIntensity: oneOf(BACKGROUND_INTENSITIES, o.backgroundIntensity, d.backgroundIntensity),
    density: oneOf(DENSITIES, o.density, d.density),
    sidebarMode: oneOf(SIDEBAR_MODES, o.sidebarMode, d.sidebarMode),
    stabilizePhone: boolOr(o.stabilizePhone, d.stabilizePhone),
    defaultStreamQuality: intInRange(o.defaultStreamQuality, 0, 100, d.defaultStreamQuality),
    defaultStreamFps: intInRange(o.defaultStreamFps, 1, 60, d.defaultStreamFps),
    confirmDestructive: boolOr(o.confirmDestructive, d.confirmDestructive),
    activityNotifications: boolOr(o.activityNotifications, d.activityNotifications),
  }
}

/** Merge a validated patch over a base, then normalize the result. Pure. */
export function applyWorkspaceSettingsPatch(base: WorkspaceSettings, patch: WorkspaceSettingsPatch): WorkspaceSettings {
  return normalizeWorkspaceSettings({ ...base, ...patch })
}

// ── DB port + adapter ─────────────────────────────────────────────────────────

export interface WorkspaceSettingsRow {
  id: string
  teamId: string
  settings: unknown // Json
  updatedAt: number
}

export interface WorkspaceSettingsDb {
  workspaceSettings: {
    findUnique(args: unknown): Promise<WorkspaceSettingsRow | null>
    upsert(args: unknown): Promise<WorkspaceSettingsRow>
  }
}

export function prismaWorkspaceSettingsDb(): WorkspaceSettingsDb {
  return prisma as unknown as WorkspaceSettingsDb
}

const id = () => `wss_${randomUUID()}`

// ── Data access (team-scoped, one row per team) ──────────────────────────────────

/** Load a team's settings, normalized. Returns the DEFAULTS when no row exists yet —
 *  a team that never saved still gets a complete, valid object. */
export async function loadWorkspaceSettings(teamId: string, db: WorkspaceSettingsDb = prismaWorkspaceSettingsDb()): Promise<WorkspaceSettings> {
  const row = await db.workspaceSettings.findUnique({ where: { teamId } })
  return normalizeWorkspaceSettings(row?.settings ?? null)
}

/** Upsert the single settings row for a team (teamId is unique → true upsert, never a
 *  second row). The full normalized object is stored. */
export async function saveWorkspaceSettings(teamId: string, settings: WorkspaceSettings, now: number, db: WorkspaceSettingsDb = prismaWorkspaceSettingsDb()): Promise<WorkspaceSettings> {
  const normalized = normalizeWorkspaceSettings(settings)
  await db.workspaceSettings.upsert({
    where: { teamId },
    create: { id: id(), teamId, settings: normalized, updatedAt: now },
    update: { settings: normalized, updatedAt: now },
  })
  return normalized
}

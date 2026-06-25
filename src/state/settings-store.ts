import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ThemeId, AccentId } from '@/lib/themes'
import { QUALITY_MIN, QUALITY_MAX, FPS_MIN, FPS_MAX } from '@/shared/stream-quality'

/**
 * Workspace settings. Persisted locally (zustand/persist → localStorage).
 *
 * BACKEND INTEGRATION POINT: when the server grows a `/settings` resource,
 * replace the persist storage with a thin adapter that reads/writes through
 * `client` and keep this exact shape as the typed contract.
 */

export type PerformanceMode = 'full' | 'balanced' | 'reduced'
export type MotionPref = 'full' | 'balanced' | 'reduced' | 'off'
export type SurfaceStyle = 'flat' | 'soft' | 'glass'
export type BackgroundIntensity = 'off' | 'minimal' | 'balanced' | 'atmospheric'
export type Density = 'comfortable' | 'compact' | 'dense'
/** 'collapsed' = icon rail that fully expands on hover and shrinks back. */
export type SidebarMode = 'expanded' | 'collapsed'

export interface WorkspaceSettings {
  workspaceName: string
  operatorName: string
  /** Visual performance: caps 3D DPR and decorative rendering. */
  performanceMode: PerformanceMode
  /** Motion preference: page transitions, tilt, ambient drift, graph easing. */
  motion: MotionPref
  /** Force-reduce motion regardless of OS preference (legacy switch — `motion` is the richer control). */
  reduceMotion: boolean
  /** Theme preset + accent family (semantic status colors are never themed). */
  theme: ThemeId
  accent: AccentId
  surface: SurfaceStyle
  backgroundIntensity: BackgroundIntensity
  density: Density
  sidebarMode: SidebarMode
  /** Stop decorative phone-body motion (tilt/parallax) on the control page. */
  stabilizePhone: boolean
  /** Default stream quality (0–30) applied when opening phone control. */
  defaultStreamQuality: number
  /** Default stream FPS (5–30) applied when opening phone control. */
  defaultStreamFps: number
  /** Ask for confirmation before reboot / retire. */
  confirmDestructive: boolean
  /** Surface live fleet events as activity toasts. */
  activityNotifications: boolean
}

const osPrefersReducedMotion =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export const DEFAULT_SETTINGS: WorkspaceSettings = {
  workspaceName: 'MobFleet',
  operatorName: 'Operator',
  performanceMode: 'full',
  motion: osPrefersReducedMotion ? 'reduced' : 'full',
  reduceMotion: false,
  theme: 'obsidian',
  accent: 'teal',
  surface: 'soft',
  backgroundIntensity: 'balanced',
  density: 'comfortable',
  sidebarMode: 'expanded',
  // Reduced-motion users get a stable phone by default (can still opt out).
  stabilizePhone: osPrefersReducedMotion,
  defaultStreamQuality: 22,
  defaultStreamFps: 18,
  confirmDestructive: true,
  activityNotifications: true,
}

interface SettingsState extends WorkspaceSettings {
  update: (patch: Partial<WorkspaceSettings>) => void
  reset: () => void
}

/** Clamp stream quality (0–30) and FPS (5–30) into their real ranges so any UI input or older
 *  persisted state (e.g. a saved 100/60, or a legacy fps below 5) can never come back out of range. */
function clampStream(patch: Partial<WorkspaceSettings>): Partial<WorkspaceSettings> {
  const next = { ...patch }
  if (next.defaultStreamQuality != null) next.defaultStreamQuality = Math.max(QUALITY_MIN, Math.min(QUALITY_MAX, Math.round(next.defaultStreamQuality)))
  if (next.defaultStreamFps != null) next.defaultStreamFps = Math.max(FPS_MIN, Math.min(FPS_MAX, Math.round(next.defaultStreamFps)))
  return next
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      update: (patch) => set(clampStream(patch)),
      reset: () => set(DEFAULT_SETTINGS),
    }),
    {
      name: 'mobfleet-settings',
      // Clamp persisted quality/FPS down to 30 on every rehydrate (older saves may hold 100/60).
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<WorkspaceSettings>
        return { ...current, ...p, ...clampStream(p as WorkspaceSettings) }
      },
    },
  ),
)

/** Non-reactive read for imperative consumers (three.js setup etc.). */
export function getSettings(): WorkspaceSettings {
  return useSettings.getState()
}

/** Effective "no decorative motion" flag combining OS + workspace prefs. */
export function motionDisabled(s: Pick<WorkspaceSettings, 'motion' | 'reduceMotion'>): boolean {
  return osPrefersReducedMotion || s.reduceMotion || s.motion === 'reduced' || s.motion === 'off'
}

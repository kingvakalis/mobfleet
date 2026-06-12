import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Workspace settings. Persisted locally (zustand/persist → localStorage).
 *
 * BACKEND INTEGRATION POINT: when the server grows a `/settings` resource,
 * replace the persist storage with a thin adapter that reads/writes through
 * `client` and keep this exact shape as the typed contract.
 */

export type PerformanceMode = 'full' | 'balanced' | 'reduced'

export interface WorkspaceSettings {
  workspaceName: string
  operatorName: string
  /** Visual performance: drives ambient backgrounds, 3D DPR, and particles. */
  performanceMode: PerformanceMode
  /** Force-reduce motion regardless of OS preference. */
  reduceMotion: boolean
  /** Default stream quality (0–100) applied when opening phone control. */
  defaultStreamQuality: number
  /** Default stream FPS applied when opening phone control. */
  defaultStreamFps: number
  /** Ask for confirmation before reboot / retire. */
  confirmDestructive: boolean
  /** Surface live fleet events as activity toasts. */
  activityNotifications: boolean
}

export const DEFAULT_SETTINGS: WorkspaceSettings = {
  workspaceName: 'MobFleet',
  operatorName: 'Operator',
  performanceMode: 'full',
  reduceMotion: false,
  defaultStreamQuality: 22,
  defaultStreamFps: 18,
  confirmDestructive: true,
  activityNotifications: true,
}

interface SettingsState extends WorkspaceSettings {
  update: (patch: Partial<WorkspaceSettings>) => void
  reset: () => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      update: (patch) => set(patch),
      reset: () => set(DEFAULT_SETTINGS),
    }),
    { name: 'mobfleet-settings' },
  ),
)

/** Non-reactive read for imperative consumers (three.js setup etc.). */
export function getSettings(): WorkspaceSettings {
  return useSettings.getState()
}

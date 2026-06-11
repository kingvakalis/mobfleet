import type { DeviceStatus } from '@/shared/types'

/** The five fleet states. Drives every status color in the app. */
export type { DeviceStatus }

export interface StatusMeta {
  label: string
  /** Resolved CSS color (reads the token variable). */
  color: string
}

/**
 * Status → presentation. Colors are returned as `var(--…)` strings so
 * components can set them inline (dynamic status can't be a static Tailwind
 * class). One source of truth, themable via the token sheet.
 */
export const STATUS: Record<DeviceStatus, StatusMeta> = {
  online: { label: 'ONLINE', color: 'var(--status-online)' },
  busy: { label: 'BUSY', color: 'var(--status-busy)' },
  warming: { label: 'WARMING', color: 'var(--status-warming)' },
  offline: { label: 'OFFLINE', color: 'var(--status-offline)' },
  error: { label: 'ERROR', color: 'var(--status-error)' },
}

export const ALL_STATUSES: DeviceStatus[] = [
  'online',
  'busy',
  'warming',
  'offline',
  'error',
]

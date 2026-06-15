import type { DeviceCommandLogEntry } from '@/shared/types'

/**
 * Per-device command-log subscriber registry. Shared by the HTTP and mock
 * providers so the subscription semantics live in ONE tested place:
 *  - isolation: a log for device A is never delivered to device B's subscribers
 *  - clean teardown: unsubscribe removes the callback and drops empty sets
 *    (no leaked Map entries)
 *  - resilience: a throwing subscriber can't break the others
 */
export type DeviceLogCallback = (entry: DeviceCommandLogEntry) => void

export interface DeviceLogHub {
  subscribe(deviceId: string, cb: DeviceLogCallback): () => void
  emit(deviceId: string, entry: DeviceCommandLogEntry): void
  /** Live subscriber count for a device (0 if none) — for tests/diagnostics. */
  count(deviceId: string): number
}

export function createDeviceLogHub(): DeviceLogHub {
  const subs = new Map<string, Set<DeviceLogCallback>>()
  return {
    subscribe(deviceId, cb) {
      let set = subs.get(deviceId)
      if (!set) {
        set = new Set()
        subs.set(deviceId, set)
      }
      set.add(cb)
      return () => {
        const s = subs.get(deviceId)
        if (!s) return
        s.delete(cb)
        if (s.size === 0) subs.delete(deviceId) // no leaked empty sets
      }
    },
    emit(deviceId, entry) {
      const set = subs.get(deviceId)
      if (!set) return
      // Snapshot so a subscriber unsubscribing during notification is safe.
      for (const cb of [...set]) {
        try {
          cb(entry)
        } catch {
          /* a faulty subscriber must not break delivery to the others */
        }
      }
    },
    count(deviceId) {
      return subs.get(deviceId)?.size ?? 0
    },
  }
}

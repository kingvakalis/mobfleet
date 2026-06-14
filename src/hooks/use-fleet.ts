import { useMemo, useSyncExternalStore } from 'react'
import { client } from '@/lib/provider'
import { computeStats, type FleetStats } from '@/lib/provider/stats'
import type { FleetSnapshot } from '@/lib/provider/types'

/** Subscribe to the live fleet snapshot (re-renders on every stream tick). */
export function useFleet(): FleetSnapshot {
  return useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot)
}

/** Derived header counters. */
export function useFleetStats(): FleetStats {
  const snapshot = useFleet()
  return useMemo(() => computeStats(snapshot), [snapshot])
}

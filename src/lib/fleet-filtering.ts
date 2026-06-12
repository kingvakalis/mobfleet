import { STATUS } from '@/lib/status'
import type { Device, Job } from '@/lib/provider/types'
import type { FleetFilters } from '@/state/ui-store'
import { GROUP_PALETTE } from '@/lib/themes'

/** One predicate shared by the 2D graph, 3D scene, and the filter bar counts. */
export function matchesDevice(f: FleetFilters, d: Device, job?: Job | null): boolean {
  if (f.status && STATUS[d.status].label !== f.status) return false
  if (f.groups.length > 0 && !f.groups.includes(d.group)) return false
  if (f.model && d.model !== f.model) return false
  if (f.job && job?.type !== f.job) return false
  if (f.search && !d.name.toLowerCase().includes(f.search.toLowerCase())) return false
  return true
}

/** Stable color identity for each selected group (legend + node outlines). */
export function groupColor(selectedGroups: string[], group: string): string | null {
  const i = selectedGroups.indexOf(group)
  if (i === -1) return null
  return GROUP_PALETTE[i % GROUP_PALETTE.length]
}

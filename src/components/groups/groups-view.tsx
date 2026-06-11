import { useMemo } from 'react'
import { ArrowRight, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { StatusDot } from '@/components/ui/status-dot'
import { useFleet } from '@/hooks/use-fleet'
import { useUIStore } from '@/state/ui-store'
import { ALL_STATUSES, STATUS } from '@/lib/status'
import type { Device, DeviceStatus } from '@/lib/provider/types'

interface GroupSummary {
  name: string
  total: number
  counts: Record<DeviceStatus, number>
  users: string[]
  regions: number
  avgBattery: number
}

function summarize(devices: Device[]): GroupSummary[] {
  const map = new Map<string, Device[]>()
  for (const d of devices) {
    const arr = map.get(d.group) ?? []
    arr.push(d)
    map.set(d.group, arr)
  }
  return [...map.entries()]
    .map(([name, ds]) => {
      const counts = { online: 0, busy: 0, warming: 0, offline: 0, error: 0 } as Record<DeviceStatus, number>
      const users = new Set<string>()
      const regions = new Set<string>()
      let battery = 0
      for (const d of ds) {
        counts[d.status]++
        if (d.assignedUser) users.add(d.assignedUser)
        regions.add(d.region)
        battery += d.battery
      }
      return {
        name,
        total: ds.length,
        counts,
        users: [...users],
        regions: regions.size,
        avgBattery: Math.round(battery / ds.length),
      }
    })
    .sort((a, b) => b.total - a.total)
}

function GroupCard({ g }: { g: GroupSummary }) {
  const focusGroup = useUIStore((s) => s.focusGroup)
  return (
    <Card ticks className="flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-fg">{g.name}</div>
          <div className="mono mt-1 text-[11px] text-fg-muted">
            {g.total} DEVICES · {g.regions} REGIONS · {g.avgBattery}% AVG
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => focusGroup(g.name)}>
          View <ArrowRight size={13} />
        </Button>
      </div>

      {/* status breakdown */}
      <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-line pt-4">
        {ALL_STATUSES.filter((s) => g.counts[s] > 0).map((s) => (
          <div key={s} className="flex items-center gap-1.5">
            <StatusDot status={s} size={7} pulse={s !== 'offline'} />
            <span className="mono text-[12px] text-fg">{g.counts[s]}</span>
            <span className="label text-fg-muted">{STATUS[s].label}</span>
          </div>
        ))}
      </div>

      {/* operators */}
      <div className="flex items-center gap-2 border-t border-line pt-3">
        <Users size={13} className="text-fg-muted" />
        <span className="text-[12px] text-fg-secondary">
          {g.users.length > 0 ? g.users.join(' · ') : 'Unassigned'}
        </span>
      </div>
    </Card>
  )
}

export function GroupsView() {
  const snapshot = useFleet()
  const groups = useMemo(() => summarize(snapshot.devices), [snapshot.devices])

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-6 py-4">
        <div>
          <Label className="text-fg">Groups</Label>
          <div className="mono mt-1 text-[11px] text-fg-muted">
            {groups.length} GROUPS · {snapshot.devices.length} DEVICES
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => (
            <GroupCard key={g.name} g={g} />
          ))}
        </div>
      </div>
    </div>
  )
}

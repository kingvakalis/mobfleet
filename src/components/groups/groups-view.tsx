import React, { useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface PhoneEntry {
  id: string
  name: string
  status: 'online' | 'busy' | 'offline' | 'warning'
}

interface Group {
  id: string
  name: string
  phones: PhoneEntry[]
  activeJobs: number
  status: 'active' | 'idle' | 'paused'
}

const STATUS_DOT: Record<string, string> = {
  online:  'bg-green-500',
  busy:    'bg-blue-500',
  offline: 'bg-zinc-600',
  warning: 'bg-amber-500',
}

const GROUP_STATUS_BADGE: Record<string, string> = {
  active: 'bg-green-500/15 text-green-400',
  idle:   'bg-zinc-500/15 text-zinc-400',
  paused: 'bg-amber-500/15 text-amber-400',
}

const MOCK_GROUPS: Group[] = [
  {
    id: 'g1', name: 'Instagram Farm', activeJobs: 3, status: 'active',
    phones: [
      { id: 'p1', name: 'iPhone 14 #1', status: 'online' },
      { id: 'p2', name: 'iPhone 14 #2', status: 'busy' },
      { id: 'p3', name: 'iPhone SE #1', status: 'online' },
      { id: 'p4', name: 'Pixel 7 #1',   status: 'warning' },
    ],
  },
  {
    id: 'g2', name: 'TikTok Farm', activeJobs: 2, status: 'active',
    phones: [
      { id: 'p5', name: 'iPhone 13 #1', status: 'busy' },
      { id: 'p6', name: 'iPhone 13 #2', status: 'busy' },
      { id: 'p7', name: 'Pixel 6a #1',  status: 'offline' },
    ],
  },
  {
    id: 'g3', name: 'Warmup Pool', activeJobs: 0, status: 'idle',
    phones: [
      { id: 'p8',  name: 'iPhone SE #2', status: 'offline' },
      { id: 'p9',  name: 'iPhone SE #3', status: 'offline' },
      { id: 'p10', name: 'Pixel 7a #1',  status: 'online' },
    ],
  },
  {
    id: 'g4', name: 'Carolina', activeJobs: 1, status: 'active',
    phones: [
      { id: 'p11', name: 'iPhone 15 #1', status: 'busy' },
      { id: 'p12', name: 'iPhone 15 #2', status: 'online' },
    ],
  },
  {
    id: 'g5', name: 'Lucia', activeJobs: 0, status: 'paused',
    phones: [
      { id: 'p13', name: 'iPhone 12 #1', status: 'offline' },
      { id: 'p14', name: 'Pixel 5 #1',   status: 'offline' },
    ],
  },
]

function GroupCard({ group }: { group: Group }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#111118] overflow-hidden">
      <button
        className="w-full flex items-center gap-4 p-4 hover:bg-white/[0.03] transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-sm font-medium text-white/90 truncate">{group.name}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wide ${GROUP_STATUS_BADGE[group.status]}`}>
              {group.status}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-white/40">
            <span className="flex items-center gap-1">
              <Smartphone size={11} />
              {group.phones.length} phones
            </span>
            <span>{group.activeJobs} active jobs</span>
          </div>
        </div>

        {/* Status dots row */}
        <div className="flex items-center gap-1 shrink-0">
          {group.phones.slice(0, 6).map(p => (
            <span key={p.id} className={`h-2 w-2 rounded-full ${STATUS_DOT[p.status]}`} />
          ))}
          {group.phones.length > 6 && (
            <span className="text-[10px] text-white/30 ml-0.5">+{group.phones.length - 6}</span>
          )}
        </div>

        <div className="text-white/30">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-white/[0.06] px-4 py-3">
          <div className="grid grid-cols-1 gap-1.5">
            {group.phones.map(phone => (
              <div key={phone.id} className="flex items-center gap-2.5 text-sm">
                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${STATUS_DOT[phone.status]}`} />
                <span className="text-white/60 flex-1">{phone.name}</span>
                <span className="text-[10px] text-white/30 capitalize">{phone.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function GroupsView() {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-white/[0.06] px-6 py-4">
        <div>
          <div className="text-sm font-medium text-white/90">Groups</div>
          <div className="mono mt-0.5 text-[11px] text-white/40 uppercase tracking-wide">
            {MOCK_GROUPS.length} groups · {MOCK_GROUPS.reduce((s, g) => s + g.phones.length, 0)} phones
          </div>
        </div>
        <Button variant="primary" size="sm">
          <Plus size={14} /> New Group
        </Button>
      </div>

      {/* Grid */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {MOCK_GROUPS.map(group => (
            <GroupCard key={group.id} group={group} />
          ))}
        </div>
      </div>
    </div>
  )
}

import { useState } from 'react'
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
}

const MOCK_GROUPS: Group[] = [
  { id: '1', name: 'Instagram Farm', activeJobs: 12, phones: [
    { id: 'p1', name: 'iPhone-001', status: 'online' },
    { id: 'p2', name: 'iPhone-002', status: 'busy' },
    { id: 'p3', name: 'iPhone-003', status: 'online' },
    { id: 'p4', name: 'iPhone-004', status: 'warning' },
  ]},
  { id: '2', name: 'TikTok Farm', activeJobs: 6, phones: [
    { id: 'p5', name: 'iPhone-010', status: 'online' },
    { id: 'p6', name: 'iPhone-011', status: 'online' },
    { id: 'p7', name: 'iPhone-012', status: 'offline' },
  ]},
  { id: '3', name: 'Warmup Pool', activeJobs: 3, phones: [
    { id: 'p8', name: 'iPhone-020', status: 'busy' },
    { id: 'p9', name: 'iPhone-021', status: 'online' },
  ]},
  { id: '4', name: 'Carolina', activeJobs: 8, phones: [
    { id: 'p10', name: 'iPhone-030', status: 'online' },
    { id: 'p11', name: 'iPhone-031', status: 'online' },
    { id: 'p12', name: 'iPhone-032', status: 'busy' },
  ]},
  { id: '5', name: 'Lucia', activeJobs: 5, phones: [
    { id: 'p13', name: 'iPhone-040', status: 'online' },
    { id: 'p14', name: 'iPhone-041', status: 'warning' },
  ]},
]

const statusDot: Record<string, string> = {
  online: 'bg-emerald-500',
  busy: 'bg-indigo-400',
  offline: 'bg-white/20',
  warning: 'bg-yellow-400',
}

export function GroupsView() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  function toggle(id: string) {
    setExpanded(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white/90">Groups</h2>
        <Button size="sm" className="h-7 text-xs gap-1 bg-white/[0.06] hover:bg-white/[0.1] text-white/70 border-0">
          <Plus size={12} /> New Group
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {MOCK_GROUPS.map(g => {
          const isOpen = expanded.has(g.id)
          return (
            <div key={g.id} className="rounded-xl border border-white/[0.06] bg-white/[0.03] overflow-hidden">
              <button
                onClick={() => toggle(g.id)}
                className="w-full flex items-center justify-between p-4 hover:bg-white/[0.03] transition-colors"
              >
                <div className="flex items-center gap-3">
                  {isOpen ? <ChevronDown size={14} className="text-white/40" /> : <ChevronRight size={14} className="text-white/40" />}
                  <span className="text-sm font-medium text-white/85">{g.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-white/30 flex items-center gap-1">
                    <Smartphone size={10} /> {g.phones.length}
                  </span>
                  {g.activeJobs > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-400/10 text-indigo-400">
                      {g.activeJobs} jobs
                    </span>
                  )}
                </div>
              </button>
              {isOpen && (
                <div className="border-t border-white/[0.04] px-4 pb-3 pt-2 flex flex-col gap-1.5">
                  {g.phones.map(p => (
                    <div key={p.id} className="flex items-center gap-2 text-xs text-white/50">
                      <span className={`w-1.5 h-1.5 rounded-full ${statusDot[p.status]}`} />
                      {p.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

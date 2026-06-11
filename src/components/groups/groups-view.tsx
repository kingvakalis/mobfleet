import { useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Smartphone, Zap, ArrowUpRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { groups, phones, statusMeta } from '@/lib/fleet-data'

export function GroupsView() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  function toggle(id: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/30 mb-0.5">Organization</p>
          <h1 className="text-lg font-semibold text-white/90">Groups</h1>
        </div>
        <Button size="sm" className="h-8 gap-1.5 bg-white/[0.06] hover:bg-white/[0.1] text-white/70 border-0 text-xs">
          <Plus size={13} /> New Group
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {groups.map(g => {
          const isOpen = expanded.has(g.id)
          const groupPhones = phones.filter(p => p.group === g.name)
          return (
            <div key={g.id} className="rounded-xl border border-white/[0.06] bg-white/[0.03] overflow-hidden">
              <div className="p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white/85">{g.name}</h3>
                    <p className="text-xs text-white/35 mt-0.5">{g.description}</p>
                  </div>
                  <button className="text-white/20 hover:text-white/60 transition-colors">
                    <ArrowUpRight size={14} />
                  </button>
                </div>
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1.5 text-xs text-white/45">
                    <Smartphone size={11} className="text-white/30" /> {g.phoneCount} phones
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-indigo-400">
                    <Zap size={11} /> {g.activeJobs} active
                  </span>
                </div>
              </div>
              <button
                onClick={() => toggle(g.id)}
                className="w-full flex items-center gap-2 px-4 py-2.5 border-t border-white/[0.04] hover:bg-white/[0.02] transition-colors text-xs text-white/30"
              >
                {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {isOpen ? 'Hide' : 'Show'} devices
              </button>
              {isOpen && (
                <div className="border-t border-white/[0.04] px-4 pb-3 pt-2 flex flex-col gap-1">
                  {groupPhones.slice(0, 8).map(p => {
                    const meta = statusMeta[p.status]
                    return (
                      <div key={p.id} className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-2 text-white/50">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: meta.color }} />
                          {p.name}
                        </span>
                        <span className="text-white/25 text-[10px]">{p.job}</span>
                      </div>
                    )
                  })}
                  {groupPhones.length > 8 && (
                    <span className="text-[10px] text-white/20 pt-1">+{groupPhones.length - 8} more</span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
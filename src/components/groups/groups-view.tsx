import { useState } from 'react'
import { Plus, Smartphone, Zap, Users, Clock, ArrowUpRight, Play, Settings } from 'lucide-react'
import { groups, phones } from '@/lib/fleet-data'

export function GroupsView() {
  const [search, setSearch] = useState('')

  const visible = groups.filter(g =>
    search === '' || g.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/30 mb-0.5">Fleet</p>
          <h1 className="text-lg font-semibold text-white/90">Groups</h1>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors">
          <Plus size={15} /> New Group
        </button>
      </div>

      {/* KPI row */}
      <div className="flex gap-4 px-6 py-3 border-b border-white/[0.04]">
        {[
          { label: 'Total Groups',  value: groups.length },
          { label: 'Total Phones',  value: phones.length },
          { label: 'Online',        value: phones.filter(p => p.status === 'online' || p.status === 'running').length },
          { label: 'Running Jobs',  value: phones.filter(p => p.status === 'running').length },
        ].map(k => (
          <div key={k.label} className="flex flex-col px-4 py-2 rounded-xl bg-white/[0.03] border border-white/[0.05]">
            <span className="text-[10px] text-white/30 uppercase tracking-wider">{k.label}</span>
            <span className="text-xl font-semibold text-white/90 mt-0.5">{k.value}</span>
          </div>
        ))}
        <div className="ml-auto flex items-center">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search groups..."
            className="h-8 px-3 rounded-lg bg-white/[0.04] border border-white/[0.06] text-xs text-white/80 placeholder-white/25 outline-none focus:border-white/20 w-52"
          />
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map(g => {
            const groupPhones = phones.filter(p => p.group === g.name)
            const online = groupPhones.filter(p => p.status === 'online' || p.status === 'running').length
            const users = [...new Set(groupPhones.map(p => p.assignedUser))]
            return (
              <div key={g.id} className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-5 flex flex-col gap-4 hover:border-white/[0.1] transition-colors">
                {/* Card header */}
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-white/90">{g.name}</h2>
                    <p className="text-[11px] text-white/35 mt-0.5">{g.description}</p>
                  </div>
                  <span className={[
                    'text-[10px] px-2 py-0.5 rounded-full font-medium',
                    online > 0 ? 'bg-emerald-400/10 text-emerald-400' : 'bg-white/[0.05] text-white/30',
                  ].join(' ')}>
                    {online > 0 ? 'Active' : 'Idle'}
                  </span>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="flex flex-col items-center py-2 rounded-lg bg-white/[0.03]">
                    <Smartphone size={13} className="text-white/30 mb-1" />
                    <span className="text-sm font-semibold text-white/80">{g.phoneCount}</span>
                    <span className="text-[9px] text-white/25">Phones</span>
                  </div>
                  <div className="flex flex-col items-center py-2 rounded-lg bg-white/[0.03]">
                    <div className="w-2 h-2 rounded-full bg-emerald-400 mb-1" />
                    <span className="text-sm font-semibold text-emerald-400">{online}</span>
                    <span className="text-[9px] text-white/25">Online</span>
                  </div>
                  <div className="flex flex-col items-center py-2 rounded-lg bg-white/[0.03]">
                    <Zap size={13} className="text-indigo-400 mb-1" />
                    <span className="text-sm font-semibold text-white/80">{g.activeJobs}</span>
                    <span className="text-[9px] text-white/25">Jobs</span>
                  </div>
                </div>

                {/* Assigned users */}
                <div className="flex items-center gap-1.5">
                  <Users size={11} className="text-white/25" />
                  <span className="text-[10px] text-white/35">
                    {users.slice(0, 3).join(', ')}{users.length > 3 ? ' +' + (users.length - 3) : ''}
                  </span>
                </div>

                {/* Last activity */}
                <div className="flex items-center gap-1.5">
                  <Clock size={11} className="text-white/25" />
                  <span className="text-[10px] text-white/30">
                    Last active: {groupPhones[0]?.lastActivity ?? 'N/A'}
                  </span>
                </div>

                {/* Actions */}
                <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-white/[0.04]">
                  <button className="flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-[10px] text-white/55 hover:text-white/80 transition-colors">
                    <ArrowUpRight size={11} />View Group
                  </button>
                  <button className="flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-[10px] text-white/55 hover:text-white/80 transition-colors">
                    <Smartphone size={11} />Assign Phones
                  </button>
                  <button className="flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-[10px] text-indigo-400 transition-colors">
                    <Play size={11} />Run Auto
                  </button>
                  <button className="flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-[10px] text-white/55 hover:text-white/80 transition-colors">
                    <Settings size={11} />Edit
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

import { useState, useMemo } from 'react'
import { Search, Upload, Plus, Play, MoreHorizontal, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { phones, statusMeta, type Phone } from '@/lib/fleet-data'
import { useUIStore } from '@/state/ui-store'

const FILTERS = ['Status', 'Group', 'Region', 'Proxy Status']

const proxyStyle: Record<Phone['proxyStatus'], string> = {
  healthy:      'text-emerald-400',
  issue:        'text-yellow-400',
  disconnected: 'text-red-400',
}

export function PhonesView() {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const openDrawer = useUIStore((s) => s.openDrawer)

  const visible = useMemo(() =>
    phones.filter(p => p.name.toLowerCase().includes(search.toLowerCase()) || p.group.toLowerCase().includes(search.toLowerCase())),
    [search]
  )

  function toggleAll() {
    setSelected(prev => prev.size === visible.length ? new Set() : new Set(visible.map(p => p.id)))
  }
  function toggle(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/30 mb-0.5">Fleet</p>
          <h1 className="text-lg font-semibold text-white/90">Phones</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-white/50 hover:text-white/80 text-xs">
            <Upload size={13} /> Import
          </Button>
          <Button size="sm" className="h-8 gap-1.5 bg-white/[0.08] hover:bg-white/[0.12] text-white/80 border-0 text-xs">
            <Plus size={13} /> Add Phone
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-white/[0.04]">
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search phones..."
            className="w-full h-8 pl-8 pr-3 rounded-lg bg-white/[0.04] border border-white/[0.06] text-xs text-white/80 placeholder-white/25 outline-none focus:border-white/20"
          />
        </div>
        {FILTERS.map(f => (
          <button key={f} className="h-8 px-3 rounded-lg text-xs text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-colors flex items-center gap-1">
            {f} <span className="text-white/20">▾</span>
          </button>
        ))}
        {selected.size > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-white/40">{selected.size} selected</span>
            <Button size="sm" className="h-7 text-xs gap-1 bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 border-0">
              <Play size={11} /> Run Job
            </Button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-[#0a0a0f] z-10">
            <tr className="border-b border-white/[0.06]">
              <th className="px-4 py-3 text-left w-8">
                <button onClick={toggleAll} className={\`w-4 h-4 rounded border flex items-center justify-center transition-colors \${selected.size === visible.length && visible.length > 0 ? 'bg-indigo-500 border-indigo-500' : 'border-white/20 hover:border-white/40'}\`}>
                  {selected.size === visible.length && visible.length > 0 && <Check size={10} className="text-white" />}
                </button>
              </th>
              {['Name', 'Status', 'Group', 'Region', 'Proxy', 'OS', 'Battery', 'Last Activity', 'Job', ''].map(h => (
                <th key={h} className="px-3 py-3 text-left text-[10px] font-medium text-white/25 uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => {
              const meta = statusMeta[p.status]
              const isSel = selected.has(p.id)
              return (
                <tr
                  key={p.id}
                  onClick={() => toggle(p.id)}
                  className={\`border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors cursor-pointer \${isSel ? 'bg-indigo-500/5' : ''}\`}
                >
                  <td className="px-4 py-3">
                    <div className={\`w-4 h-4 rounded border flex items-center justify-center transition-colors \${isSel ? 'bg-indigo-500 border-indigo-500' : 'border-white/15'}\`}>
                      {isSel && <Check size={10} className="text-white" />}
                    </div>
                  </td>
                  <td className="px-3 py-3 font-mono text-white/70 whitespace-nowrap">{p.name}</td>
                  <td className="px-3 py-3">
                    <span className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: meta.color }} />
                      <span style={{ color: meta.color }}>{meta.label}</span>
                    </span>
                  </td>
                  <td className="px-3 py-3 text-white/50">{p.group}</td>
                  <td className="px-3 py-3 text-white/40">{p.region}</td>
                  <td className="px-3 py-3">
                    <span className={\`font-mono \${proxyStyle[p.proxyStatus]}\`}>{p.proxyIp}</span>
                  </td>
                  <td className="px-3 py-3 text-white/40">{p.os}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      <div className="w-12 h-1 rounded-full bg-white/[0.06] overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: \`\${p.battery}%\`, background: p.battery > 30 ? '#22c55e' : '#ef4444' }} />
                      </div>
                      <span className="text-white/35">{p.battery}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-white/30">{p.lastActivity}</td>
                  <td className="px-3 py-3 text-white/35 font-mono">{p.job}</td>
                  <td className="px-3 py-3">
                    <button
                      onClick={e => { e.stopPropagation(); openDrawer(p.id); }}
                      className="px-2 py-1 rounded text-[10px] text-white/30 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
                    >
                      Control →
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
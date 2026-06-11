import { useState } from 'react'
import { Plus, RefreshCw, Trash2, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { proxies, type Proxy } from '@/lib/fleet-data'

type FilterTab = 'all' | Proxy['status']

const statusStyle: Record<Proxy['status'], { dot: string; badge: string }> = {
  healthy:    { dot: 'bg-emerald-500',  badge: 'text-emerald-400 bg-emerald-400/10' },
  failing:    { dot: 'bg-red-500',      badge: 'text-red-400 bg-red-400/10' },
  unassigned: { dot: 'bg-white/20',     badge: 'text-white/30 bg-white/[0.05]' },
}

const TABS: { id: FilterTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'healthy', label: 'Healthy' },
  { id: 'failing', label: 'Failing' },
  { id: 'unassigned', label: 'Unassigned' },
]

export function ProxiesView() {
  const [filter, setFilter] = useState<FilterTab>('all')
  const visible = filter === 'all' ? proxies : proxies.filter(p => p.status === filter)

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/30 mb-0.5">Network</p>
          <h1 className="text-lg font-semibold text-white/90">Proxies</h1>
        </div>
        <Button size="sm" className="h-8 gap-1.5 bg-white/[0.06] hover:bg-white/[0.1] text-white/70 border-0 text-xs">
          <Plus size={13} /> Add Proxy
        </Button>
      </div>

      <div className="flex gap-1">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setFilter(t.id)}
            className={\`px-3 py-1.5 text-xs rounded-md transition-colors \${filter === t.id ? 'bg-white/[0.1] text-white/90' : 'text-white/35 hover:text-white/60'}\`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-white/[0.06] overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/[0.06] bg-white/[0.02]">
              {['IP', 'Region', 'Provider', 'Latency', 'Status', 'Assigned To', ''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-[10px] font-medium text-white/25 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((p, i) => {
              const s = statusStyle[p.status]
              return (
                <tr key={p.id} className={\`border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors \${i === visible.length - 1 ? 'border-0' : ''}\`}>
                  <td className="px-4 py-3 font-mono text-white/65">{p.ip}:{p.port}</td>
                  <td className="px-4 py-3 text-white/45">{p.region}</td>
                  <td className="px-4 py-3 text-white/45">{p.provider}</td>
                  <td className="px-4 py-3 text-white/45">{p.status === 'unassigned' ? '—' : \`\${p.latencyMs}ms\`}</td>
                  <td className="px-4 py-3">
                    <span className={\`flex items-center gap-1.5 w-fit px-2 py-0.5 rounded-full text-[10px] \${s.badge}\`}>
                      <span className={\`w-1 h-1 rounded-full \${s.dot}\`} />
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-white/35">{p.assignedTo ?? <span className="italic text-white/15">unassigned</span>}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button className="p-1.5 hover:bg-white/[0.06] rounded text-white/25 hover:text-white/60 transition-colors"><RefreshCw size={11} /></button>
                      <button className="p-1.5 hover:bg-white/[0.06] rounded text-white/25 hover:text-white/60 transition-colors"><UserPlus size={11} /></button>
                      <button className="p-1.5 hover:bg-white/[0.06] rounded text-white/25 hover:text-red-400 transition-colors"><Trash2 size={11} /></button>
                    </div>
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
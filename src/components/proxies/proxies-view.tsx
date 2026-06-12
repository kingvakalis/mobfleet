import { useState } from 'react'
import { Plus, RefreshCw, Trash2, Copy, AlertTriangle } from 'lucide-react'
import { proxies } from '@/lib/fleet-data'

const statusStyle: Record<string, string> = {
  healthy:    'bg-emerald-400/10 text-emerald-400',
  failing:    'bg-red-400/10 text-red-400',
  unassigned: 'bg-white/[0.05] text-white/35',
}

export function ProxiesView() {
  const [search, setSearch] = useState('')

  const total      = proxies.length
  const healthy    = proxies.filter(p => p.status === 'healthy').length
  const failing    = proxies.filter(p => p.status === 'failing').length
  const assigned   = proxies.filter(p => p.assignedTo !== null).length
  const unassigned = proxies.filter(p => p.assignedTo === null).length

  const visible = proxies.filter(p =>
    search === '' ||
    p.ip.includes(search) ||
    p.region.toLowerCase().includes(search.toLowerCase()) ||
    p.provider.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/30 mb-0.5">Network</p>
          <h1 className="text-lg font-semibold text-white/90">Proxies</h1>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors">
          <Plus size={15} /> Add Proxy
        </button>
      </div>

      {/* KPI row */}
      <div className="flex gap-3 px-6 py-3 border-b border-white/[0.04]">
        {[
          { label: 'Total',      value: total,      color: 'text-white/80' },
          { label: 'Healthy',    value: healthy,    color: 'text-emerald-400' },
          { label: 'Failing',    value: failing,    color: 'text-red-400' },
          { label: 'Assigned',   value: assigned,   color: 'text-indigo-400' },
          { label: 'Unassigned', value: unassigned, color: 'text-white/40' },
        ].map(k => (
          <div key={k.label} className="flex flex-col px-4 py-2 rounded-xl bg-white/[0.03] border border-white/[0.05]">
            <span className="text-[10px] text-white/30 uppercase tracking-wider">{k.label}</span>
            <span className={['text-xl font-semibold mt-0.5', k.color].join(' ')}>{k.value}</span>
          </div>
        ))}
        <div className="ml-auto flex items-center">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search proxies..."
            className="h-8 px-3 rounded-lg bg-white/[0.04] border border-white/[0.06] text-xs text-white/80 placeholder-white/25 outline-none focus:border-white/20 w-52"
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-6 py-4">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-white/25 text-[10px] uppercase tracking-wider">
              <th className="text-left pb-3 font-medium">IP Address</th>
              <th className="text-left pb-3 font-medium">Region</th>
              <th className="text-left pb-3 font-medium">Provider</th>
              <th className="text-left pb-3 font-medium">Assigned Phone</th>
              <th className="text-left pb-3 font-medium">Status</th>
              <th className="text-left pb-3 font-medium">Last Check</th>
              <th className="text-right pb-3 font-medium">Latency</th>
              <th className="text-right pb-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.03]">
            {visible.map(p => (
              <tr key={p.id} className="hover:bg-white/[0.02] transition-colors group">
                <td className="py-3 pr-4 font-mono text-white/70">{p.ip}:{p.port}</td>
                <td className="py-3 pr-4 text-white/50">{p.region}</td>
                <td className="py-3 pr-4 text-white/50">{p.provider}</td>
                <td className="py-3 pr-4 text-white/50">{p.assignedTo ?? <span className="text-white/25">—</span>}</td>
                <td className="py-3 pr-4">
                  <span className={['text-[10px] px-2 py-0.5 rounded-full font-medium', statusStyle[p.status]].join(' ')}>
                    {p.status}
                  </span>
                </td>
                <td className="py-3 pr-4 text-white/30">2m ago</td>
                <td className="py-3 pr-4 text-right font-mono">
                  <span className={[p.latencyMs > 150 ? 'text-yellow-400' : p.latencyMs === 0 ? 'text-white/20' : 'text-emerald-400'].join(' ')}>
                    {p.latencyMs === 0 ? '—' : p.latencyMs + 'ms'}
                  </span>
                </td>
                <td className="py-3 text-right">
                  <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button className="p-1.5 rounded hover:bg-white/[0.06] text-white/30 hover:text-white/70 transition-colors" title="Copy IP">
                      <Copy size={12} />
                    </button>
                    <button className="p-1.5 rounded hover:bg-white/[0.06] text-white/30 hover:text-white/70 transition-colors" title="Test proxy">
                      <RefreshCw size={12} />
                    </button>
                    {p.status === 'failing' && (
                      <button className="p-1.5 rounded hover:bg-yellow-400/10 text-yellow-400/60 hover:text-yellow-400 transition-colors" title="Alert">
                        <AlertTriangle size={12} />
                      </button>
                    )}
                    <button className="p-1.5 rounded hover:bg-red-400/10 text-white/20 hover:text-red-400 transition-colors" title="Remove">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { Plus, RefreshCw, Trash2, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'

type ProxyStatus = 'healthy' | 'degraded' | 'down'
type FilterTab = 'all' | ProxyStatus

interface Proxy {
  id: string
  ip: string
  port: number
  region: string
  provider: string
  latencyMs: number
  status: ProxyStatus
  assignedTo: string | null
}

const MOCK_PROXIES: Proxy[] = [
  { id: '1', ip: '104.18.32.11', port: 8080, region: 'US-East', provider: 'Bright Data', latencyMs: 42, status: 'healthy', assignedTo: 'iPhone-001' },
  { id: '2', ip: '185.220.101.44', port: 8080, region: 'EU-NL', provider: 'Oxylabs', latencyMs: 67, status: 'healthy', assignedTo: 'iPhone-002' },
  { id: '3', ip: '91.108.4.17', port: 3128, region: 'EU-DE', provider: 'Smartproxy', latencyMs: 134, status: 'degraded', assignedTo: null },
  { id: '4', ip: '172.64.80.1', port: 8888, region: 'APAC-SG', provider: 'Bright Data', latencyMs: 188, status: 'degraded', assignedTo: 'iPhone-010' },
  { id: '5', ip: '198.199.86.11', port: 8080, region: 'US-West', provider: 'Oxylabs', latencyMs: 55, status: 'healthy', assignedTo: null },
  { id: '6', ip: '10.0.0.44', port: 1080, region: 'EU-PL', provider: 'IPRoyal', latencyMs: 0, status: 'down', assignedTo: null },
  { id: '7', ip: '203.0.113.88', port: 8080, region: 'APAC-JP', provider: 'Smartproxy', latencyMs: 210, status: 'healthy', assignedTo: 'iPhone-030' },
  { id: '8', ip: '192.0.2.55', port: 3128, region: 'US-Central', provider: 'Bright Data', latencyMs: 48, status: 'healthy', assignedTo: 'iPhone-031' },
]

const statusStyle: Record<ProxyStatus, { dot: string; badge: string }> = {
  healthy: { dot: 'bg-emerald-500', badge: 'text-emerald-400 bg-emerald-400/10' },
  degraded: { dot: 'bg-yellow-400', badge: 'text-yellow-400 bg-yellow-400/10' },
  down: { dot: 'bg-red-500', badge: 'text-red-400 bg-red-400/10' },
}

const TABS: { id: FilterTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'healthy', label: 'Healthy' },
  { id: 'degraded', label: 'Degraded' },
  { id: 'down', label: 'Down' },
]

export function ProxiesView() {
  const [filter, setFilter] = useState<FilterTab>('all')
  const visible = filter === 'all' ? MOCK_PROXIES : MOCK_PROXIES.filter(p => p.status === filter)

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white/90">Proxies</h2>
        <Button size="sm" className="h-7 text-xs gap-1 bg-white/[0.06] hover:bg-white/[0.1] text-white/70 border-0">
          <Plus size={12} /> Add Proxy
        </Button>
      </div>
      <div className="flex gap-1">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setFilter(t.id)}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${filter === t.id ? 'bg-white/[0.1] text-white/90' : 'text-white/35 hover:text-white/60'}`}
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
                <th key={h} className="px-4 py-2.5 text-left text-[10px] font-medium text-white/30 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((p, i) => {
              const s = statusStyle[p.status]
              return (
                <tr key={p.id} className={`border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors ${i === visible.length - 1 ? 'border-0' : ''}`}>
                  <td className="px-4 py-3 font-mono text-white/70">{p.ip}:{p.port}</td>
                  <td className="px-4 py-3 text-white/50">{p.region}</td>
                  <td className="px-4 py-3 text-white/50">{p.provider}</td>
                  <td className="px-4 py-3 text-white/50">{p.status === 'down' ? '—' : `${p.latencyMs}ms`}</td>
                  <td className="px-4 py-3">
                    <span className={`flex items-center gap-1.5 w-fit px-2 py-0.5 rounded-full text-[10px] ${s.badge}`}>
                      <span className={`w-1 h-1 rounded-full ${s.dot}`} />
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-white/40">{p.assignedTo ?? <span className="italic text-white/20">unassigned</span>}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button className="p-1 hover:bg-white/[0.06] rounded text-white/30 hover:text-white/60 transition-colors" title="Test"><RefreshCw size={11} /></button>
                      <button className="p-1 hover:bg-white/[0.06] rounded text-white/30 hover:text-white/60 transition-colors" title="Assign"><UserPlus size={11} /></button>
                      <button className="p-1 hover:bg-white/[0.06] rounded text-white/30 hover:text-red-400 transition-colors" title="Remove"><Trash2 size={11} /></button>
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

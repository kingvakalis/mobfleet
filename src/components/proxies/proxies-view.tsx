import React, { useState } from 'react'
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
  { id: 'px1', ip: '104.21.45.12',  port: 8080, region: 'US-West',   provider: 'Luminati',   latencyMs: 42,  status: 'healthy',  assignedTo: 'Instagram Farm' },
  { id: 'px2', ip: '172.67.183.90', port: 8080, region: 'US-East',   provider: 'Bright Data', latencyMs: 38,  status: 'healthy',  assignedTo: 'TikTok Farm' },
  { id: 'px3', ip: '185.220.101.7', port: 9050, region: 'EU-DE',     provider: 'Oxylabs',    latencyMs: 98,  status: 'healthy',  assignedTo: 'Carolina' },
  { id: 'px4', ip: '91.108.56.112', port: 3128, region: 'EU-NL',     provider: 'SmartProxy',  latencyMs: 210, status: 'degraded', assignedTo: 'Lucia' },
  { id: 'px5', ip: '45.142.212.33', port: 8888, region: 'EU-UK',     provider: 'Oxylabs',    latencyMs: 145, status: 'healthy',  assignedTo: null },
  { id: 'px6', ip: '103.152.114.5', port: 8080, region: 'APAC-SG',   provider: 'Bright Data', latencyMs: 320, status: 'degraded', assignedTo: 'Warmup Pool' },
  { id: 'px7', ip: '203.77.188.10', port: 3128, region: 'APAC-JP',   provider: 'Luminati',   latencyMs: 999, status: 'down',     assignedTo: null },
  { id: 'px8', ip: '77.247.126.95', port: 9090, region: 'US-Central', provider: 'SmartProxy',  latencyMs: 55,  status: 'healthy',  assignedTo: null },
]

const STATUS_CONFIG: Record<ProxyStatus, { dot: string; badge: string; label: string }> = {
  healthy:  { dot: 'bg-green-500',  badge: 'text-green-400 bg-green-500/10',  label: 'Healthy' },
  degraded: { dot: 'bg-amber-500',  badge: 'text-amber-400 bg-amber-500/10',  label: 'Degraded' },
  down:     { dot: 'bg-red-500',    badge: 'text-red-400   bg-red-500/10',    label: 'Down' },
}

const TABS: { id: FilterTab; label: string }[] = [
  { id: 'all',      label: 'All' },
  { id: 'healthy',  label: 'Healthy' },
  { id: 'degraded', label: 'Degraded' },
  { id: 'down',     label: 'Down' },
]

export function ProxiesView() {
  const [filter, setFilter] = useState<FilterTab>('all')

  const visible = filter === 'all' ? MOCK_PROXIES : MOCK_PROXIES.filter(p => p.status === filter)

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-white/[0.06] px-6 py-4">
        <div>
          <div className="text-sm font-medium text-white/90">Proxies</div>
          <div className="mono mt-0.5 text-[11px] text-white/40 uppercase tracking-wide">
            {MOCK_PROXIES.filter(p => p.status === 'healthy').length} healthy · {MOCK_PROXIES.length} total
          </div>
        </div>
        <Button variant="primary" size="sm">
          <Plus size={14} /> Add Proxy
        </Button>
      </div>

      {/* Filter tabs */}
      <div className="flex shrink-0 items-center gap-1 border-b border-white/[0.06] px-6 py-2">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id)}
            className={[
              'px-3 py-1 rounded text-xs transition-colors',
              filter === tab.id
                ? 'bg-white/[0.08] text-white'
                : 'text-white/40 hover:text-white/70',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 border-b border-white/[0.06] bg-[#0a0a0f]">
            <tr className="text-left">
              {['IP', 'Region', 'Provider', 'Latency', 'Status', 'Assigned To', 'Actions'].map(h => (
                <th key={h} className="mono px-4 py-3 text-[10px] font-normal uppercase tracking-widest text-white/30">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((proxy, i) => {
              const sc = STATUS_CONFIG[proxy.status]
              return (
                <tr
                  key={proxy.id}
                  className={['border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors', i % 2 === 0 ? '' : 'bg-white/[0.01]'].join(' ')}
                >
                  <td className="mono px-4 py-3 text-white/80 text-xs">{proxy.ip}:{proxy.port}</td>
                  <td className="px-4 py-3 text-white/60 text-xs">{proxy.region}</td>
                  <td className="px-4 py-3 text-white/60 text-xs">{proxy.provider}</td>
                  <td className="mono px-4 py-3 text-xs">
                    <span className={proxy.latencyMs > 500 ? 'text-red-400' : proxy.latencyMs > 150 ? 'text-amber-400' : 'text-green-400'}>
                      {proxy.latencyMs}ms
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[10px] font-medium ${sc.badge}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${sc.dot}`} />
                      {sc.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-white/50 text-xs">
                    {proxy.assignedTo ?? <span className="text-white/20">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button className="rounded p-1 text-white/30 hover:text-white/70 hover:bg-white/[0.06] transition-colors" title="Test">
                        <RefreshCw size={12} />
                      </button>
                      <button className="rounded p-1 text-white/30 hover:text-white/70 hover:bg-white/[0.06] transition-colors" title="Assign">
                        <UserPlus size={12} />
                      </button>
                      <button className="rounded p-1 text-white/30 hover:text-red-400 hover:bg-red-500/[0.08] transition-colors" title="Remove">
                        <Trash2 size={12} />
                      </button>
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

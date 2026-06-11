import { useState, useMemo } from 'react'
import { Search } from 'lucide-react'
import { buildLogs, type LogLevel } from '@/lib/fleet-data'

const levelStyle: Record<LogLevel, string> = {
  INFO:  'text-white/40',
  WARN:  'text-yellow-400',
  ERROR: 'text-red-400',
  OK:    'text-emerald-400',
}
const levelBg: Record<LogLevel, string> = {
  INFO:  'bg-white/[0.04] text-white/40',
  WARN:  'bg-yellow-400/10 text-yellow-400',
  ERROR: 'bg-red-400/10 text-red-400',
  OK:    'bg-emerald-400/10 text-emerald-400',
}

const FILTERS: ('ALL' | LogLevel)[] = ['ALL', 'INFO', 'WARN', 'ERROR', 'OK']

export function LogsView() {
  const allLogs = useMemo(() => buildLogs(120), [])
  const [filter, setFilter] = useState<'ALL' | LogLevel>('ALL')
  const [search, setSearch] = useState('')

  const visible = useMemo(
    () => allLogs.filter(l =>
      (filter === 'ALL' || l.level === filter) &&
      (search === '' || l.message.toLowerCase().includes(search.toLowerCase()) || l.device.toLowerCase().includes(search.toLowerCase()))
    ),
    [allLogs, filter, search]
  )

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/30 mb-0.5">System</p>
          <h1 className="text-lg font-semibold text-white/90">Logs</h1>
        </div>
      </div>

      <div className="flex items-center gap-3 px-6 py-3 border-b border-white/[0.04]">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search logs..."
            className="h-8 pl-8 pr-3 rounded-lg bg-white/[0.04] border border-white/[0.06] text-xs text-white/80 placeholder-white/25 outline-none focus:border-white/20 w-64"
          />
        </div>
        <div className="flex gap-1">
          {FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={['px-3 py-1 text-xs rounded-md transition-colors', filter === f ? 'bg-white/[0.1] text-white/90' : 'text-white/35 hover:text-white/60'].join(' ')}
            >
              {f}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-white/25">{visible.length} entries</span>
      </div>

      <div className="flex-1 overflow-auto px-4 py-2">
        <div className="font-mono text-[11px] space-y-0.5">
          {visible.map(l => (
            <div key={l.id} className="flex items-center gap-3 px-3 py-1.5 rounded-md hover:bg-white/[0.02] transition-colors">
              <span className="text-white/20 w-20 shrink-0">{l.ts}</span>
              <span className={['px-1.5 py-0.5 rounded text-[9px] font-semibold w-12 text-center shrink-0', levelBg[l.level]].join(' ')}>{l.level}</span>
              <span className="text-white/35 w-24 shrink-0 truncate">{l.device}</span>
              <span className={levelStyle[l.level]}>{l.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

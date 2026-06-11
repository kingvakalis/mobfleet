import { useState, useMemo } from 'react'
import { Search, Clock } from 'lucide-react'
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
const TIME_FILTERS = ['All Time', 'Last 5m', 'Last 15m', 'Last 1h']

// Extend log entries with job field for display
const JOBS = ['ig-warmup', 'story-view', 'follow-flow', 'dm-sequence', 'idle', 'app-check']

function rng(seed: number) {
  let s = seed
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return Math.abs(s) / 0x7fffffff }
}

function buildEnrichedLogs(count: number) {
  return buildLogs(count).map((l, i) => {
    const r = rng(i * 31 + 11)
    return {
      ...l,
      job: JOBS[Math.floor(r() * JOBS.length)],
      meta: 'pid:' + Math.floor(r() * 9999 + 1000),
    }
  })
}

export function LogsView() {
  const allLogs = useMemo(() => buildEnrichedLogs(150), [])
  const [filter, setFilter]   = useState<'ALL' | LogLevel>('ALL')
  const [search, setSearch]   = useState('')
  const [timeFilter, setTimeFilter] = useState('All Time')

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
        <div className="flex items-center gap-2 text-xs text-white/30">
          <Clock size={13} />
          <span>{visible.length} entries</span>
        </div>
      </div>

      <div className="flex items-center gap-3 px-6 py-3 border-b border-white/[0.04] flex-wrap">
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
        <select
          value={timeFilter}
          onChange={e => setTimeFilter(e.target.value)}
          className="ml-auto h-8 px-3 rounded-lg bg-white/[0.04] border border-white/[0.06] text-xs text-white/60 outline-none focus:border-white/20 cursor-pointer"
        >
          {TIME_FILTERS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div className="flex-1 overflow-auto px-4 py-2">
        {/* Column headers */}
        <div className="flex items-center gap-3 px-3 py-1.5 text-[9px] uppercase tracking-wider text-white/20 font-medium">
          <span className="w-20 shrink-0">Time</span>
          <span className="w-12 shrink-0">Level</span>
          <span className="w-24 shrink-0">Device</span>
          <span className="w-24 shrink-0">Job</span>
          <span className="flex-1">Message</span>
          <span className="w-24 text-right shrink-0">Meta</span>
        </div>
        <div className="font-mono text-[11px] space-y-0.5">
          {visible.map(l => (
            <div key={l.id} className="flex items-center gap-3 px-3 py-1.5 rounded-md hover:bg-white/[0.02] transition-colors">
              <span className="text-white/20 w-20 shrink-0">{l.ts}</span>
              <span className={['px-1.5 py-0.5 rounded text-[9px] font-semibold w-12 text-center shrink-0', levelBg[l.level]].join(' ')}>{l.level}</span>
              <span className="text-white/35 w-24 shrink-0 truncate">{l.device}</span>
              <span className="text-indigo-400/50 w-24 shrink-0 truncate">{(l as typeof l & { job: string }).job}</span>
              <span className={['flex-1 truncate', levelStyle[l.level]].join(' ')}>{l.message}</span>
              <span className="text-white/15 w-24 text-right shrink-0 truncate">{(l as typeof l & { meta: string }).meta}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

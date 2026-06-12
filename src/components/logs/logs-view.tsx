import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Search, Clock, Pause, Play } from 'lucide-react'
import { useActivityFeed, type ActivityEvent } from '@/components/fleet/fleet-activity'
import { fadeIn, staggerContainer } from '@/lib/motion'

/**
 * Activity — plain-language operational events (was "Logs").
 * Raw developer logs stay out of the operator interface; per-device technical
 * streams live in the device drawer's Live Log.
 */

const levelStyle: Record<ActivityEvent['level'], string> = {
  INFO:  'text-white/45',
  WARN:  'text-amber-400',
  ERROR: 'text-red-400',
  OK:    'text-emerald-400',
}
const levelBg: Record<ActivityEvent['level'], string> = {
  INFO:  'bg-white/[0.04] text-white/40',
  WARN:  'bg-amber-400/10 text-amber-400',
  ERROR: 'bg-red-400/10 text-red-400',
  OK:    'bg-emerald-400/10 text-emerald-400',
}

const RESULT_FILTERS: ('ALL' | ActivityEvent['level'])[] = ['ALL', 'OK', 'INFO', 'WARN', 'ERROR']

export function ActivityView() {
  const [paused, setPaused] = useState(false)
  const events = useActivityFeed(paused)
  const [filter, setFilter] = useState<'ALL' | ActivityEvent['level']>('ALL')
  const [search, setSearch] = useState('')
  const [deviceFilter, setDeviceFilter] = useState<string>('')

  const devices = useMemo(() => [...new Set(events.map(e => e.device))].sort(), [events])

  const visible = useMemo(
    () => events.filter(e =>
      (filter === 'ALL' || e.level === filter) &&
      (deviceFilter === '' || e.device === deviceFilter) &&
      (search === '' ||
        e.message.toLowerCase().includes(search.toLowerCase()) ||
        e.device.toLowerCase().includes(search.toLowerCase()) ||
        e.type.toLowerCase().includes(search.toLowerCase()))
    ),
    [events, filter, search, deviceFilter],
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <div>
          <p className="mono mb-1 text-[9px] uppercase tracking-[0.2em] text-white/30">System</p>
          <h1 className="mono text-lg font-bold uppercase tracking-widest text-white">Activity</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setPaused(p => !p)}
            className={[
              'mono flex items-center gap-1.5 border px-3 py-1.5 text-[10px] uppercase tracking-widest transition-colors',
              paused
                ? 'border-amber-400/40 bg-amber-400/10 text-amber-400'
                : 'border-line text-white/40 hover:text-white/70',
            ].join(' ')}
          >
            {paused ? <Play size={11} /> : <Pause size={11} />} {paused ? 'Resume' : 'Pause'}
          </button>
          <div className="flex items-center gap-2 text-xs text-white/30">
            <Clock size={13} />
            <span className="tabular-nums">{visible.length} events</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-3">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search activity..."
            className="h-8 w-64 rounded-lg border border-line bg-white/[0.03] pl-8 pr-3 text-xs text-white/80 placeholder-white/25 outline-none transition-colors focus:border-[var(--accent-border)]"
          />
        </div>
        <div className="flex gap-1">
          {RESULT_FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={[
                'rounded-md px-3 py-1 text-xs transition-colors',
                filter === f ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]' : 'text-white/35 hover:text-white/60',
              ].join(' ')}
            >
              {f}
            </button>
          ))}
        </div>
        <select
          value={deviceFilter}
          onChange={e => setDeviceFilter(e.target.value)}
          aria-label="Filter by device"
          className="ml-auto h-8 cursor-pointer rounded-lg border border-line bg-elevated px-3 text-xs text-white/60 outline-none focus:border-[var(--accent-border)]"
        >
          <option value="">All devices</option>
          {devices.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      <div className="flex-1 overflow-auto px-4 py-2">
        <div className="flex items-center gap-3 px-3 py-1.5 text-[9px] font-medium uppercase tracking-wider text-white/20">
          <span className="w-20 shrink-0">Time</span>
          <span className="w-14 shrink-0">Result</span>
          <span className="w-28 shrink-0">Device</span>
          <span className="w-28 shrink-0">Action</span>
          <span className="flex-1">Details</span>
        </div>
        <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-0.5 font-mono text-[11px]">
          {visible.map(e => (
            <motion.div key={e.id} variants={fadeIn} className="flex items-center gap-3 rounded-md px-3 py-1.5 transition-colors hover:bg-white/[0.02]">
              <span className="w-20 shrink-0 tabular-nums text-white/25">{e.ts}</span>
              <span className={['w-14 shrink-0 rounded px-1.5 py-0.5 text-center text-[9px] font-semibold', levelBg[e.level]].join(' ')}>{e.level}</span>
              <span className="w-28 shrink-0 truncate text-white/55">{e.device}</span>
              <span className={['w-28 shrink-0 truncate font-medium', levelStyle[e.level]].join(' ')}>{e.type}</span>
              <span className="flex-1 truncate text-white/40">{e.message}</span>
            </motion.div>
          ))}
        </motion.div>
        {visible.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16">
            <span className="mono text-[10px] uppercase tracking-widest text-white/25">No events match the current filters</span>
          </div>
        )}
      </div>
    </div>
  )
}

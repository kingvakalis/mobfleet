import { useState, useMemo, useEffect } from 'react'
import { Search, Upload, Plus, Check, Briefcase, Camera, RotateCcw, RefreshCw, UserPlus, Download, X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useFleet } from '@/hooks/use-fleet'
import { client } from '@/lib/provider'
import { STATUS } from '@/lib/status'
import { useUIStore } from '@/state/ui-store'

const FILTERS = ['Status', 'Group', 'Region', 'Proxy Status']

const STATUS_COLORS: Record<string, string> = {
  online:  'var(--status-online)',
  busy:    'var(--status-busy)',
  warming: 'var(--status-warming)',
  offline: 'var(--status-offline)',
  error:   'var(--status-error)',
}

function AnimatedCounter({ target, color }: { target: number; color: string }) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    let cur = 0
    const step = () => {
      cur = Math.min(cur + 1, target)
      setValue(cur)
      if (cur < target) setTimeout(step, 20)
    }
    if (target > 0) step()
    else setValue(0)
  }, [target])
  return <span className="mono text-3xl font-bold tabular-nums" style={{ color }}>{value}</span>
}

export function PhonesView() {
  const snapshot              = useFleet()
  const [search, setSearch]   = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const openPhoneControl      = useUIStore((s) => s.openPhoneControl)

  const devices = snapshot.devices

  const visible = useMemo(
    () => devices.filter(d =>
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.group.toLowerCase().includes(search.toLowerCase()) ||
      d.region.toLowerCase().includes(search.toLowerCase())
    ),
    [devices, search]
  )

  const onlineCount  = devices.filter(d => d.status === 'online' || d.status === 'busy' || d.status === 'warming').length
  const errorCount   = devices.filter(d => d.status === 'error').length
  const offlineCount = devices.filter(d => d.status === 'offline').length

  const kpis = [
    { label: 'TOTAL UNITS',   value: devices.length, color: '#ffffff',              topBorder: 'rgba(255,255,255,0.3)' },
    { label: 'ONLINE',        value: onlineCount,    color: 'var(--accent-green)',   topBorder: 'var(--accent-green)' },
    { label: 'FAULT',         value: errorCount,     color: 'var(--accent-red)',     topBorder: 'var(--accent-red)' },
    { label: 'OFFLINE',       value: offlineCount,   color: 'rgba(255,255,255,0.3)', topBorder: 'rgba(255,255,255,0.15)' },
  ]

  function toggleAll() {
    setSelected(prev => prev.size === visible.length ? new Set() : new Set(visible.map(d => d.id)))
  }
  function toggle(id: string) {
    setSelected(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  return (
    <div className="flex flex-col h-full relative bg-black">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-white/[0.08]">
        <div>
          <p className="mono text-[9px] uppercase tracking-[0.2em] text-white/30 mb-1">Fleet Registry</p>
          <h1 className="mono text-lg font-bold tracking-widest text-white uppercase">DEVICE REGISTRY</h1>
          <p className="mono text-[10px] text-white/30 tracking-wider mt-0.5">{devices.length} UNITS TRACKED</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="mono h-8 px-4 text-[10px] uppercase tracking-widest text-white/40 border border-white/[0.12] hover:border-white/30 hover:text-white/70 transition-colors">
            <Upload size={11} className="inline mr-1.5" />IMPORT
          </button>
          <button className="mono h-8 px-4 text-[10px] uppercase tracking-widest text-white border border-white/30 hover:bg-white hover:text-black transition-colors">
            <Plus size={11} className="inline mr-1.5" />ADD UNIT
          </button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-3 px-6 py-4 border-b border-white/[0.06]">
        {kpis.map(({ label, value, color, topBorder }) => (
          <div
            key={label}
            className="p-4 flex flex-col gap-2"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderTop: `2px solid ${topBorder}`,
            }}
          >
            <span className="mono text-[9px] uppercase tracking-[0.15em]" style={{ color: 'rgba(255,255,255,0.4)' }}>{label}</span>
            <AnimatedCounter target={value} color={color} />
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-white/[0.06]">
        <div className="relative flex-1 max-w-xs">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="SEARCH UNITS..."
            className="w-full h-8 pl-8 pr-3 bg-transparent border border-white/[0.08] text-[10px] mono text-white/70 placeholder-white/20 outline-none focus:border-white/20 tracking-wider"
          />
        </div>
        {FILTERS.map(f => (
          <button key={f} className="mono h-8 px-3 text-[9px] uppercase tracking-widest text-white/30 hover:text-white/60 hover:border-white/20 border border-transparent transition-colors flex items-center gap-1">
            {f} <span className="text-white/20 ml-0.5">▾</span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10" style={{ background: '#000000' }}>
            <tr className="border-b border-white/[0.08]">
              <th className="px-4 py-3 text-left w-8">
                <button
                  onClick={toggleAll}
                  className="w-3.5 h-3.5 border border-white/20 flex items-center justify-center transition-colors hover:border-white/50"
                  style={{ background: selected.size === visible.length && visible.length > 0 ? 'rgba(255,255,255,0.9)' : 'transparent' }}
                >
                  {selected.size === visible.length && visible.length > 0 && <Check size={8} className="text-black" />}
                </button>
              </th>
              {['NAME', 'STATUS', 'GROUP', 'REGION', 'MODEL', 'OS', 'BATTERY', 'PROXY', 'JOB', ''].map(h => (
                <th key={h} className="px-3 py-3 text-left mono text-[9px] font-medium text-white/25 uppercase tracking-[0.1em] whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((d) => {
              const meta   = STATUS[d.status]
              const isSel  = selected.has(d.id)
              const job    = d.jobId ? snapshot.jobs.find(j => j.id === d.jobId) : null
              const dotColor = STATUS_COLORS[d.status] ?? meta?.color ?? 'rgba(255,255,255,0.3)'
              return (
                <tr
                  key={d.id}
                  onClick={() => toggle(d.id)}
                  className="border-b border-white/[0.04] cursor-pointer transition-all duration-100"
                  style={{
                    borderLeft: isSel ? '2px solid var(--accent-blue)' : '2px solid transparent',
                    background: isSel ? 'rgba(79,195,247,0.04)' : 'transparent',
                  }}
                  onMouseEnter={e => {
                    if (!isSel) (e.currentTarget as HTMLElement).style.borderLeftColor = 'rgba(79,195,247,0.4)'
                    ;(e.currentTarget as HTMLElement).style.background = isSel ? 'rgba(79,195,247,0.04)' : 'rgba(255,255,255,0.02)'
                  }}
                  onMouseLeave={e => {
                    if (!isSel) (e.currentTarget as HTMLElement).style.borderLeftColor = 'transparent'
                    ;(e.currentTarget as HTMLElement).style.background = isSel ? 'rgba(79,195,247,0.04)' : 'transparent'
                  }}
                >
                  <td className="px-4 py-3">
                    <div
                      className="w-3.5 h-3.5 border border-white/15 flex items-center justify-center transition-colors"
                      style={{ background: isSel ? 'rgba(255,255,255,0.9)' : 'transparent' }}
                    >
                      {isSel && <Check size={8} className="text-black" />}
                    </div>
                  </td>
                  <td className="px-3 py-3 mono text-white/70 text-[11px] whitespace-nowrap">{d.name}</td>
                  <td className="px-3 py-3">
                    <span className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dotColor }} />
                      <span className="mono text-[10px] uppercase tracking-wider" style={{ color: dotColor }}>{meta?.label ?? d.status}</span>
                    </span>
                  </td>
                  <td className="px-3 py-3 mono text-white/45 text-[11px]">{d.group}</td>
                  <td className="px-3 py-3 mono text-white/35 text-[11px]">{d.region}</td>
                  <td className="px-3 py-3 mono text-white/35 text-[11px]">{d.model}</td>
                  <td className="px-3 py-3 mono text-white/35 text-[11px]">{d.osVersion}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      <div className="w-10 h-0.5 rounded-none overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                        <div
                          className="h-full"
                          style={{
                            width: d.battery + '%',
                            background: d.battery > 30 ? 'var(--accent-green)' : 'var(--accent-red)',
                          }}
                        />
                      </div>
                      <span className="mono text-[10px] text-white/30">{d.battery}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 mono text-white/30 text-[10px]">{d.proxy.split(':')[0]}</td>
                  <td className="px-3 py-3 mono text-white/30 text-[10px]">{job ? job.type : '—'}</td>
                  <td className="px-3 py-3">
                    <button
                      onClick={e => { e.stopPropagation(); openPhoneControl(d.id) }}
                      className="mono px-2.5 py-1 text-[9px] uppercase tracking-widest text-white/30 border border-white/[0.12] hover:border-white/60 hover:text-white/80 transition-colors"
                    >
                      CONTROL →
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Floating bulk action bar */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30"
          >
            <div className="flex items-center gap-2 px-4 py-2.5 border border-white/[0.15] bg-black shadow-2xl">
              <span className="mono text-[9px] text-white/40 mr-1 whitespace-nowrap uppercase tracking-widest">{selected.size} SELECTED</span>
              <div className="w-px h-4 bg-white/[0.08]" />
              {[
                { icon: <Briefcase size={11} />, label: 'RUN JOB', run: () => { selected.forEach(id => void client.runTask(id, { type: 'upload', label: 'Manual upload' })); setSelected(new Set()) } },
                { icon: <Camera size={11} />,    label: 'CAPTURE', run: undefined },
                { icon: <RotateCcw size={11} />, label: 'REBOOT',  run: undefined },
                { icon: <RefreshCw size={11} />, label: 'PROXY',   run: () => selected.forEach(id => void client.rotateProxy(id)) },
                { icon: <UserPlus size={11} />,  label: 'GROUP',   run: undefined },
                { icon: <Download size={11} />,  label: 'EXPORT',  run: undefined },
              ].map(({ icon, label, run }) => (
                <button key={label} type="button" onClick={run} disabled={!run} className="mono flex items-center gap-1.5 px-3 py-1.5 text-[9px] uppercase tracking-widest text-white/50 hover:text-white/90 hover:bg-white/[0.06] transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-white/50">
                  {icon} {label}
                </button>
              ))}
              <div className="w-px h-4 bg-white/[0.08]" />
              <button
                onClick={() => setSelected(new Set())}
                className="flex items-center justify-center w-6 h-6 text-white/30 hover:text-white/70 hover:bg-white/[0.08] transition-colors"
              >
                <X size={12} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

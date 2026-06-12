import { useState, useMemo, useEffect } from 'react'
import { Search, Upload, Plus, Check, Briefcase, Camera, RotateCcw, RefreshCw, UserPlus, Download, X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { useFleet } from '@/hooks/use-fleet'
import { STATUS } from '@/lib/status'
import { useUIStore } from '@/state/ui-store'

const FILTERS = ['Status', 'Group', 'Region', 'Proxy Status']

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
  return <span className={['text-2xl font-bold tabular-nums', color].join(' ')}>{value}</span>
}

export function PhonesView() {
  const snapshot           = useFleet()
  const [search, setSearch]   = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const openDrawer            = useUIStore((s) => s.openDrawer)

  const devices = snapshot.devices

  const visible = useMemo(
    () => devices.filter(d =>
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.group.toLowerCase().includes(search.toLowerCase()) ||
      d.region.toLowerCase().includes(search.toLowerCase())
    ),
    [devices, search]
  )

  const kpis = [
    { label: 'Total',   value: devices.length,                                                       color: 'text-white/70' },
    { label: 'Online',  value: devices.filter(d => d.status === 'online' || d.status === 'busy' || d.status === 'warming').length, color: 'text-emerald-400' },
    { label: 'Warning', value: devices.filter(d => d.status === 'error').length,                     color: 'text-amber-400' },
    { label: 'Offline', value: devices.filter(d => d.status === 'offline').length,                   color: 'text-red-400' },
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
    <div className="flex flex-col h-full relative">
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

      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-3 px-6 py-4 border-b border-white/[0.04]">
        {kpis.map(({ label, value, color }) => (
          <div key={label} className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4 flex flex-col gap-1">
            <span className="text-[10px] text-white/30 uppercase tracking-wider">{label}</span>
            <AnimatedCounter target={value} color={color} />
          </div>
        ))}
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
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-[#0a0a0f] z-10">
            <tr className="border-b border-white/[0.06]">
              <th className="px-4 py-3 text-left w-8">
                <button
                  onClick={toggleAll}
                  className={[
                    'w-4 h-4 rounded border flex items-center justify-center transition-colors',
                    selected.size === visible.length && visible.length > 0
                      ? 'bg-indigo-500 border-indigo-500'
                      : 'border-white/20 hover:border-white/40',
                  ].join(' ')}
                >
                  {selected.size === visible.length && visible.length > 0 && <Check size={10} className="text-white" />}
                </button>
              </th>
              {['Name', 'Status', 'Group', 'Region', 'Model', 'OS', 'Battery', 'Proxy', 'Job', ''].map(h => (
                <th key={h} className="px-3 py-3 text-left text-[10px] font-medium text-white/25 uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((d) => {
              const meta = STATUS[d.status]
              const isSel = selected.has(d.id)
              const job = d.jobId ? snapshot.jobs.find(j => j.id === d.jobId) : null
              return (
                <tr
                  key={d.id}
                  onClick={() => toggle(d.id)}
                  className={['border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors cursor-pointer', isSel ? 'bg-indigo-500/5' : ''].join(' ')}
                >
                  <td className="px-4 py-3">
                    <div className={['w-4 h-4 rounded border flex items-center justify-center transition-colors', isSel ? 'bg-indigo-500 border-indigo-500' : 'border-white/15'].join(' ')}>
                      {isSel && <Check size={10} className="text-white" />}
                    </div>
                  </td>
                  <td className="px-3 py-3 font-mono text-white/70 whitespace-nowrap">{d.name}</td>
                  <td className="px-3 py-3">
                    <span className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: meta.color }} />
                      <span style={{ color: meta.color }}>{meta.label}</span>
                    </span>
                  </td>
                  <td className="px-3 py-3 text-white/50">{d.group}</td>
                  <td className="px-3 py-3 text-white/40">{d.region}</td>
                  <td className="px-3 py-3 text-white/40">{d.model}</td>
                  <td className="px-3 py-3 text-white/40">{d.osVersion}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      <div className="w-12 h-1 rounded-full bg-white/[0.06] overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: d.battery + '%', background: d.battery > 30 ? '#22c55e' : '#ef4444' }}
                        />
                      </div>
                      <span className="text-white/35">{d.battery}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 font-mono text-white/40 text-[10px]">{d.proxy.split(':')[0]}</td>
                  <td className="px-3 py-3 text-white/35 font-mono">{job ? job.type : '—'}</td>
                  <td className="px-3 py-3">
                    <button
                      onClick={e => { e.stopPropagation(); openDrawer(d.id) }}
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
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-black/70 backdrop-blur-xl border border-white/[0.10] shadow-2xl">
              <span className="text-xs text-white/50 mr-1 whitespace-nowrap">{selected.size} selected</span>
              <div className="w-px h-4 bg-white/[0.08]" />
              {[
                { icon: <Briefcase size={12} />, label: 'Run Job' },
                { icon: <Camera size={12} />,    label: 'Screenshot' },
                { icon: <RotateCcw size={12} />, label: 'Reboot' },
                { icon: <RefreshCw size={12} />, label: 'Assign Proxy' },
                { icon: <UserPlus size={12} />,  label: 'Add to Group' },
                { icon: <Download size={12} />,  label: 'Export' },
              ].map(({ icon, label }) => (
                <button key={label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-white/60 hover:text-white/90 hover:bg-white/[0.08] transition-colors">
                  {icon} {label}
                </button>
              ))}
              <div className="w-px h-4 bg-white/[0.08]" />
              <button
                onClick={() => setSelected(new Set())}
                className="flex items-center justify-center w-6 h-6 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/[0.08] transition-colors"
              >
                <X size={13} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

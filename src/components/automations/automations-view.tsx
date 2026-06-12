import { useState } from 'react'
import { motion } from 'framer-motion'
import { Play, Pause, Plus, ChevronRight } from 'lucide-react'
import { useAutomationsData } from '@/lib/fleet-adapter'
import { useUIStore } from '@/state/ui-store'
import { fadeRise, staggerContainer } from '@/lib/motion'

const FLOW_STEPS = [
  { label: 'Start',      color: '#22c55e' },
  { label: 'Open App',   color: '#818cf8' },
  { label: 'Wait',       color: '#f59e0b' },
  { label: 'Tap',        color: '#818cf8' },
  { label: 'Type',       color: '#818cf8' },
  { label: 'Screenshot', color: '#38bdf8' },
  { label: 'End',        color: '#ef4444' },
]

export function AutomationsView() {
  const automations = useAutomationsData()
  const openSubmit = useUIStore(s => s.openSubmit)
  const [search, setSearch] = useState('')

  const visible = automations.filter(a =>
    search === '' ||
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.tags.some(t => t.includes(search.toLowerCase()))
  )

  const active = automations.filter(a => a.status === 'active').length
  const paused = automations.filter(a => a.status === 'paused').length
  const totalRuns = automations.reduce((s, a) => s + a.totalRuns, 0)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/30 mb-0.5">Fleet</p>
          <h1 className="text-lg font-semibold text-white/90">Automations</h1>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors">
          <Plus size={15} /> New Automation
        </button>
      </div>

      {/* KPI */}
      <div className="flex gap-3 px-6 py-3 border-b border-white/[0.04]">
        {[
          { label: 'Total',      value: automations.length, color: 'text-white/80' },
          { label: 'Active',     value: active,             color: 'text-emerald-400' },
          { label: 'Paused',     value: paused,             color: 'text-yellow-400' },
          { label: 'Total Runs', value: totalRuns,          color: 'text-indigo-400' },
        ].map(k => (
          <div key={k.label} className="flex flex-col px-4 py-2 rounded-xl bg-white/[0.03] border border-white/[0.05]">
            <span className="text-[10px] text-white/30 uppercase tracking-wider">{k.label}</span>
            <span className={['text-xl font-semibold mt-0.5', k.color].join(' ')}>{k.value.toLocaleString()}</span>
          </div>
        ))}
        <div className="ml-auto flex items-center">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search automations..."
            className="h-8 px-3 rounded-lg bg-white/[0.04] border border-white/[0.06] text-xs text-white/80 placeholder-white/25 outline-none focus:border-white/20 w-52"
          />
        </div>
      </div>

      {/* Cards grid */}
      <div className="flex-1 overflow-auto p-6 flex flex-col gap-6">
        <motion.div variants={staggerContainer} initial="hidden" animate="show" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map(a => (
            <motion.div key={a.id} variants={fadeRise} whileHover={{ y: -2 }} className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-5 flex flex-col gap-3 hover:border-white/[0.1] transition-colors">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-white/90">{a.name}</h2>
                  <p className="text-[11px] text-white/35 mt-0.5 line-clamp-2">{a.description}</p>
                </div>
                <span className={[
                  'text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ml-2',
                  a.status === 'active' ? 'bg-emerald-400/10 text-emerald-400' : 'bg-yellow-400/10 text-yellow-400',
                ].join(' ')}>
                  {a.status}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-white/[0.03] py-2">
                  <div className="text-sm font-semibold text-white/80">{a.successRate}%</div>
                  <div className="text-[9px] text-white/25">Success</div>
                </div>
                <div className="rounded-lg bg-white/[0.03] py-2">
                  <div className="text-sm font-semibold text-white/80">{a.totalRuns.toLocaleString()}</div>
                  <div className="text-[9px] text-white/25">Runs</div>
                </div>
                <div className="rounded-lg bg-white/[0.03] py-2">
                  <div className="text-sm font-semibold text-white/50">{a.lastRun}</div>
                  <div className="text-[9px] text-white/25">Last run</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-1">
                {a.tags.map(t => (
                  <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400/70">{t}</span>
                ))}
              </div>

              <div className="flex gap-2 pt-1 border-t border-white/[0.04]">
                <button className={[
                  'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] transition-colors',
                  a.status === 'active'
                    ? 'bg-yellow-400/10 text-yellow-400 hover:bg-yellow-400/20'
                    : 'bg-emerald-400/10 text-emerald-400 hover:bg-emerald-400/20',
                ].join(' ')}>
                  {a.status === 'active' ? <><Pause size={10} />Pause</> : <><Play size={10} />Resume</>}
                </button>
                <button type="button" onClick={() => openSubmit(a.id)} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 text-[10px] transition-colors">
                  <Play size={10} />Run Now
                </button>
              </div>
            </motion.div>
          ))}
        </motion.div>
        {visible.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center text-sm text-white/40">
            No automations match "{search}"
          </div>
        )}

        {/* Builder preview */}
        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.05] p-6">
          <h3 className="text-xs font-semibold text-white/60 uppercase tracking-widest mb-4">Automation Builder Preview</h3>
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {FLOW_STEPS.map((step, i) => (
              <div key={step.label} className="flex items-center gap-2 shrink-0">
                <div className="flex flex-col items-center">
                  <div
                    className="w-16 h-12 rounded-xl flex items-center justify-center text-[11px] font-semibold border"
                    style={{ borderColor: step.color + '40', background: step.color + '15', color: step.color }}
                  >
                    {step.label}
                  </div>
                </div>
                {i < FLOW_STEPS.length - 1 && (
                  <ChevronRight size={14} className="text-white/20 shrink-0" />
                )}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-white/20 mt-3">Click any step to configure · Drag to reorder · + Add step</p>
        </div>
      </div>
    </div>
  )
}

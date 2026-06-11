import { useState } from 'react'
import { Play, Pause, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { automations } from '@/lib/fleet-data'

export function AutomationsView() {
  const [running, setRunning] = useState<Set<string>>(new Set())

  function triggerRun(id: string) {
    setRunning(prev => new Set(prev).add(id))
    setTimeout(() => setRunning(prev => { const n = new Set(prev); n.delete(id); return n }), 3500)
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-white/30 mb-0.5">Workflows</p>
          <h1 className="text-lg font-semibold text-white/90">Automations</h1>
        </div>
        <Button size="sm" className="h-8 gap-1.5 bg-white/[0.06] hover:bg-white/[0.1] text-white/70 border-0 text-xs">
          <Plus size={13} /> New Automation
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {automations.map(a => {
          const isRunning = running.has(a.id)
          const statusColor = isRunning
            ? 'text-indigo-400 bg-indigo-400/10'
            : a.status === 'active'
              ? 'text-emerald-400 bg-emerald-400/10'
              : 'text-yellow-400 bg-yellow-400/10'
          const statusLabel = isRunning ? 'Running' : a.status === 'active' ? 'Active' : 'Paused'
          return (
            <div key={a.id} className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-white/85">{a.name}</h3>
                <span className={['text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0', statusColor].join(' ')}>
                  {statusLabel}
                </span>
              </div>
              <p className="text-xs text-white/35 leading-relaxed">{a.description}</p>
              <div className="flex gap-1.5 flex-wrap">
                {a.tags.map(t => (
                  <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-white/[0.05] text-white/25 font-mono">{t}</span>
                ))}
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-[10px] text-white/25">
                  <span>Success rate</span><span>{a.successRate}%</span>
                </div>
                <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: a.successRate + '%' }} />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-white/20">{a.totalRuns.toLocaleString()} runs · last {a.lastRun}</span>
                <Button
                  size="sm"
                  disabled={isRunning}
                  onClick={() => triggerRun(a.id)}
                  className="h-7 text-[11px] px-3 gap-1 bg-white/[0.06] hover:bg-white/[0.1] text-white/60 border-0"
                >
                  {isRunning ? (
                    <><Pause size={10} /> Running…</>
                  ) : (
                    <><Play size={10} /> Run</>
                  )}
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

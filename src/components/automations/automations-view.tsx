import { useState } from 'react'
import {
  Download, Play, RefreshCw, ShieldCheck, Zap, Eye, MessageCircle,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

type AutoStatus = 'Active' | 'Paused' | 'Running'

interface Automation {
  id: string
  name: string
  description: string
  icon: LucideIcon
  status: AutoStatus
  lastRun: string
  successRate: number
  totalRuns: number
}

const AUTOMATIONS: Automation[] = [
  { id: '1', name: 'Instagram Warmup', description: 'Scroll, like, and follow to warm up new accounts', icon: Zap, status: 'Active', lastRun: '2m ago', successRate: 94, totalRuns: 1240 },
  { id: '2', name: 'Account Check', description: 'Verify account health, login status and reach', icon: ShieldCheck, status: 'Active', lastRun: '5m ago', successRate: 99, totalRuns: 3892 },
  { id: '3', name: 'TikTok Warmup', description: 'Watch videos, follow creators, engage with feed', icon: Play, status: 'Paused', lastRun: '1h ago', successRate: 88, totalRuns: 567 },
  { id: '4', name: 'App Install Flow', description: 'Install and configure apps on new devices', icon: Download, status: 'Active', lastRun: '30m ago', successRate: 97, totalRuns: 204 },
  { id: '5', name: 'Story View', description: 'View stories from followed accounts naturally', icon: Eye, status: 'Active', lastRun: '8m ago', successRate: 96, totalRuns: 2110 },
  { id: '6', name: 'DM Sequence', description: 'Send scheduled DM sequences to target lists', icon: MessageCircle, status: 'Paused', lastRun: '3h ago', successRate: 81, totalRuns: 389 },
  { id: '7', name: 'Refresh Session', description: 'Re-authenticate and refresh account sessions', icon: RefreshCw, status: 'Active', lastRun: '15m ago', successRate: 93, totalRuns: 778 },
]

const statusColor: Record<AutoStatus, string> = {
  Active: 'text-emerald-400 bg-emerald-400/10',
  Paused: 'text-yellow-400 bg-yellow-400/10',
  Running: 'text-indigo-400 bg-indigo-400/10',
}

export function AutomationsView() {
  const [running, setRunning] = useState<Set<string>>(new Set())

  function triggerRun(id: string) {
    setRunning(prev => new Set(prev).add(id))
    setTimeout(() => setRunning(prev => { const n = new Set(prev); n.delete(id); return n; }), 3000)
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white/90">Automations</h2>
        <span className="text-xs text-white/40">{AUTOMATIONS.length} workflows</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {AUTOMATIONS.map(a => {
          const Icon = a.icon
          const isRunning = running.has(a.id)
          return (
            <Card key={a.id} className="bg-white/[0.03] border-white/[0.06] p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-md bg-white/[0.06]">
                    <Icon size={14} className="text-white/60" />
                  </div>
                  <span className="text-sm font-medium text-white/85">{a.name}</span>
                </div>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${statusColor[isRunning ? 'Running' : a.status]}`}>
                  {isRunning ? 'Running' : a.status}
                </span>
              </div>
              <p className="text-xs text-white/40 leading-relaxed">{a.description}</p>
              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-[10px] text-white/30">
                  <span>Success rate</span>
                  <span>{a.successRate}%</span>
                </div>
                <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${a.successRate}%` }} />
                </div>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] text-white/25">{a.totalRuns} runs · last {a.lastRun}</span>
                <Button
                  size="sm"
                  disabled={isRunning}
                  onClick={() => triggerRun(a.id)}
                  className="h-6 text-[11px] px-3 bg-white/[0.06] hover:bg-white/[0.1] text-white/70 border-0"
                >
                  {isRunning ? 'Running…' : 'Run'}
                </Button>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

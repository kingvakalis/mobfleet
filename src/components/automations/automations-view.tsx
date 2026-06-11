import { Download, Play, RefreshCw, ShieldCheck, Upload, Zap, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { AUTOMATIONS, type Automation } from '@/data/automations'
import { useFleetStats } from '@/hooks/use-fleet'
import { useUIStore } from '@/state/ui-store'

const ICONS: Record<string, LucideIcon> = {
  'ig-warmup': Zap,
  'tiktok-warmup': Zap,
  'content-upload': Upload,
  'account-check': ShieldCheck,
  'app-install': Download,
  'proxy-rotation': RefreshCw,
}

function AutomationCard({ a }: { a: Automation }) {
  const openSubmit = useUIStore((s) => s.openSubmit)
  const Icon = ICONS[a.id] ?? Zap
  return (
    <Card ticks className="flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-control border border-accent/30 bg-accent/10">
            <Icon size={16} className="text-accent" />
          </div>
          <div>
            <div className="text-sm font-medium text-fg">{a.name}</div>
            <div className="label mt-0.5 text-fg-muted">{a.taskType}</div>
          </div>
        </div>
        <Button variant="primary" size="sm" onClick={() => openSubmit(a.id)}>
          <Play size={13} /> Run
        </Button>
      </div>

      <p className="text-sm leading-relaxed text-fg-secondary">{a.description}</p>

      <div className="grid grid-cols-3 gap-3 border-t border-line pt-4">
        <Stat label="Success" value={a.runs === 0 ? '—' : `${a.successRate}%`} />
        <Stat label="Runs" value={a.runs.toLocaleString()} />
        <Stat label="Last Run" value={a.lastRun} />
      </div>
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label text-fg-muted">{label}</div>
      <div className="mono mt-1 text-sm text-fg">{value}</div>
    </div>
  )
}

export function AutomationsView() {
  const stats = useFleetStats()
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-6 py-4">
        <div>
          <Label className="text-fg">Automations</Label>
          <div className="mono mt-1 text-[11px] text-fg-muted">
            {AUTOMATIONS.length} FLOWS · {stats.idle} DEVICES IDLE
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {AUTOMATIONS.map((a) => (
            <AutomationCard key={a.id} a={a} />
          ))}
        </div>
      </div>
    </div>
  )
}

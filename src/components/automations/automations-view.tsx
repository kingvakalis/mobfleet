import React, { useState } from 'react'
import {
  Download, Play, RefreshCw, ShieldCheck, Upload, Zap, Heart, Eye, MessageCircle,
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
  successRate: number
  totalRuns: number
  lastRun: string
}

const AUTOMATIONS: Automation[] = [
  {
    id: 'ig-warmup',
    name: 'Instagram Warmup',
    description: 'Gradually increases activity on fresh IG accounts — likes, follows, story views — to build trust score.',
    icon: Zap,
    status: 'Active',
    successRate: 94,
    totalRuns: 2_840,
    lastRun: '3 min ago',
  },
  {
    id: 'account-check',
    name: 'Account Check',
    description: 'Verifies account health, login state, and flags any shadow-bans or action blocks.',
    icon: ShieldCheck,
    status: 'Active',
    successRate: 99,
    totalRuns: 5_102,
    lastRun: '8 min ago',
  },
  {
    id: 'tiktok-warmup',
    name: 'TikTok Warmup',
    description: 'Simulates organic browsing and engagement patterns on new TikTok accounts.',
    icon: Zap,
    status: 'Active',
    successRate: 88,
    totalRuns: 1_330,
    lastRun: '12 min ago',
  },
  {
    id: 'app-install',
    name: 'App Install Flow',
    description: 'Automates app store search, install, launch, and initial onboarding taps.',
    icon: Download,
    status: 'Paused',
    successRate: 76,
    totalRuns: 440,
    lastRun: '2 hr ago',
  },
  {
    id: 'follow-unfollow',
    name: 'Follow / Unfollow',
    description: 'Targeted follow/unfollow sequences with configurable delays and safe daily limits.',
    icon: RefreshCw,
    status: 'Active',
    successRate: 91,
    totalRuns: 3_715,
    lastRun: '1 min ago',
  },
  {
    id: 'story-view',
    name: 'Story View',
    description: 'Views stories from target lists with realistic dwell times and occasional reactions.',
    icon: Eye,
    status: 'Active',
    successRate: 97,
    totalRuns: 6_880,
    lastRun: 'just now',
  },
  {
    id: 'dm-sequence',
    name: 'DM Sequence',
    description: 'Sends personalised DM sequences from a template library with rate limiting per account.',
    icon: MessageCircle,
    status: 'Paused',
    successRate: 82,
    totalRuns: 920,
    lastRun: '4 hr ago',
  },
]

const STATUS_BADGE: Record<AutoStatus, string> = {
  Active:  'bg-green-500/15 text-green-400',
  Paused:  'bg-zinc-500/15 text-zinc-400',
  Running: 'bg-blue-500/15 text-blue-400',
}

function AutomationCard({ auto }: { auto: Automation }) {
  const [running, setRunning] = useState(false)
  const Icon = auto.icon

  function handleRun() {
    setRunning(true)
    setTimeout(() => setRunning(false), 3000)
  }

  const currentStatus: AutoStatus = running ? 'Running' : auto.status

  return (
    <Card ticks className="flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-accent/30 bg-accent/10">
            <Icon size={16} className="text-accent" />
          </div>
          <div>
            <div className="text-sm font-medium text-fg">{auto.name}</div>
            <span className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[currentStatus]}`}>
              {currentStatus}
            </span>
          </div>
        </div>
        <Button variant="primary" size="sm" onClick={handleRun} disabled={running}>
          <Play size={13} /> {running ? 'Running…' : 'Run'}
        </Button>
      </div>

      <p className="text-sm leading-relaxed text-fg-secondary">{auto.description}</p>

      {/* Success rate bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-[10px]">
          <span className="mono text-fg-muted uppercase tracking-wide">Success Rate</span>
          <span className="mono text-fg">{auto.successRate}%</span>
        </div>
        <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${auto.successRate}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-line pt-4">
        <div>
          <div className="label text-fg-muted">Total Runs</div>
          <div className="mono mt-1 text-sm text-fg">{auto.totalRuns.toLocaleString()}</div>
        </div>
        <div>
          <div className="label text-fg-muted">Last Run</div>
          <div className="mono mt-1 text-sm text-fg">{auto.lastRun}</div>
        </div>
      </div>
    </Card>
  )
}

export function AutomationsView() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-6 py-4">
        <div>
          <div className="text-sm font-medium text-white/90">Automations</div>
          <div className="mono mt-0.5 text-[11px] text-white/40 uppercase tracking-wide">
            {AUTOMATIONS.length} FLOWS · {AUTOMATIONS.filter(a => a.status === 'Active').length} ACTIVE
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {AUTOMATIONS.map(a => (
            <AutomationCard key={a.id} auto={a} />
          ))}
        </div>
      </div>
    </div>
  )
}

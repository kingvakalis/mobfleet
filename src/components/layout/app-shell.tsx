import { type ReactNode, useState, useEffect } from 'react'
import {
  Network, Smartphone, Layers, Shield, Zap,
  Briefcase, Terminal, Database, Settings, Grid2x2,
  type LucideIcon,
} from 'lucide-react'
import { VIEWS, type ViewId } from '@/lib/views'
import { useUIStore } from '@/state/ui-store'
import { useFleetStats } from '@/hooks/use-fleet'

const ICON_MAP: Record<string, LucideIcon> = {
  network:    Network,
  smartphone: Smartphone,
  layers:     Layers,
  shield:     Shield,
  zap:        Zap,
  briefcase:  Briefcase,
  terminal:   Terminal,
  database:   Database,
  settings:   Settings,
}

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const view    = useUIStore((s) => s.view)
  const setView = useUIStore((s) => s.setView)
  const stats   = useFleetStats()
  const [time, setTime] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const online = stats.idle + stats.busy
  const hasError = false

  return (
    <div className="flex h-full">
      <aside className="flex w-[210px] shrink-0 flex-col bg-black border-r border-white/[0.08] relative">
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-white/[0.08]">
          <div className="flex items-center justify-center w-7 h-7 border border-white/20">
            <Grid2x2 size={12} className="text-white/70" />
          </div>
          <div className="flex flex-col">
            <span className="mono text-[13px] font-bold tracking-widest text-white leading-tight">PFA</span>
            <span className="mono text-[8px] text-white/30 tracking-wider uppercase">MISSION CONTROL v2.1</span>
          </div>
        </div>

        {/* Clock */}
        <div className="px-4 py-2 border-b border-white/[0.06]">
          <span className="mono text-[10px] text-white/25 tracking-widest">
            {time.toLocaleTimeString('en-US', { hour12: false })} UTC
          </span>
        </div>

        {/* Nav */}
        <nav className="flex flex-1 flex-col gap-0 overflow-y-auto py-2">
          {VIEWS.map((v) => {
            const Icon    = ICON_MAP[v.icon] ?? Network
            const isActive = view === v.id
            return (
              <button
                key={v.id}
                onClick={() => setView(v.id as ViewId)}
                className="group relative flex w-full items-center gap-3 px-4 py-2.5 text-left text-xs transition-all duration-150"
                style={{
                  color: isActive ? '#ffffff' : 'rgba(255,255,255,0.35)',
                  borderLeft: isActive ? '2px solid rgba(255,255,255,0.8)' : '2px solid transparent',
                  background: isActive ? 'rgba(255,255,255,0.03)' : 'transparent',
                }}
              >
                <Icon
                  size={13}
                  className="shrink-0 transition-colors"
                  style={{ color: isActive ? '#ffffff' : 'rgba(255,255,255,0.25)' }}
                />
                <span className="mono tracking-wider uppercase text-[10px] truncate relative z-10">{v.label}</span>
              </button>
            )
          })}
        </nav>

        {/* System status */}
        <div className="border-t border-white/[0.08] p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <span
              className="w-1.5 h-1.5 rounded-full status-dot-pulse shrink-0"
              style={{ background: hasError ? '#ff3b3b' : '#00ff88' }}
            />
            <span
              className="mono text-[9px] uppercase tracking-widest"
              style={{ color: hasError ? '#ff3b3b' : '#00ff88' }}
            >
              {hasError ? 'FAULT DETECTED' : 'SYSTEMS NOMINAL'}
            </span>
          </div>
          <div className="mono text-[8px] text-white/15 uppercase tracking-wider">
            {stats.total} DEVICES · {online} ONLINE
          </div>
        </div>
      </aside>

      <main className="relative flex-1 overflow-hidden bg-black">
        {children}
      </main>
    </div>
  )
}

import React, { useState } from 'react'
import {
  Network, Smartphone, Layers, Shield, Zap,
  Briefcase, SlidersHorizontal, Terminal,
  type LucideIcon,
} from 'lucide-react'
import { type ViewId, VIEWS } from '@/lib/views'

const ICON_MAP: Record<string, LucideIcon> = {
  network:    Network,
  smartphone: Smartphone,
  layers:     Layers,
  shield:     Shield,
  zap:        Zap,
  briefcase:  Briefcase,
  sliders:    SlidersHorizontal,
  terminal:   Terminal,
}

interface AppShellProps {
  children: (activeView: ViewId, setView: (v: ViewId) => void) => React.ReactNode
  defaultView?: ViewId
}

/** The frame: fixed left sidebar + full-bleed view stage. */
export function AppShell({ children, defaultView = 'fleet' }: AppShellProps) {
  const [active, setActive] = useState<ViewId>(defaultView)

  return (
    <div className="flex h-full bg-[#0a0a0f]">
      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside className="flex w-[200px] shrink-0 flex-col border-r border-white/5 bg-[#0a0a0f]">
        {/* Header */}
        <div className="flex items-center gap-2.5 border-b border-white/5 px-4 py-4">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
          </span>
          <span className="mono text-[11px] font-semibold uppercase tracking-widest text-white/80">
            UPPED FARM
          </span>
        </div>

        {/* Nav */}
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {VIEWS.map((v) => {
            const Icon = ICON_MAP[v.icon] ?? Network
            const isActive = active === v.id
            return (
              <button
                key={v.id}
                onClick={() => setActive(v.id)}
                className={[
                  'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                  isActive
                    ? 'bg-white/[0.08] text-white'
                    : 'text-white/40 hover:text-white/70 hover:bg-white/[0.04]',
                ].join(' ')}
              >
                <Icon size={15} className="shrink-0" />
                <span>{v.label}</span>
              </button>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-white/5 px-4 py-3">
          <div className="mono text-[10px] text-white/25 uppercase tracking-wider">v2-merged</div>
        </div>
      </aside>

      {/* ── Main stage ──────────────────────────────────────── */}
      <main className="relative flex-1 overflow-hidden">
        {children(active, setActive)}
      </main>
    </div>
  )
}

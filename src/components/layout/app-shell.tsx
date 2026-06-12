import { type ReactNode } from 'react'
import {
  Network, Smartphone, Layers, Shield, Zap,
  Briefcase, Terminal, Database, Settings,
  type LucideIcon,
} from 'lucide-react'
import { VIEWS, type ViewId } from '@/lib/views'
import { useUIStore } from '@/state/ui-store'

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

  return (
    <div className="flex h-full">
      <aside className="flex w-[200px] shrink-0 flex-col border-r border-white/[0.05] bg-black/40 backdrop-blur-md relative overflow-hidden">
        {/* Top gradient line */}
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-indigo-500/60 to-transparent" />
        {/* Logo */}
        <div className="flex items-center gap-2.5 border-b border-white/[0.05] px-4 py-4">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <span className="mono text-[11px] font-semibold uppercase tracking-widest text-white/80">
            UPPED FARM
          </span>
        </div>

        {/* Nav */}
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {VIEWS.map((v) => {
            const Icon    = ICON_MAP[v.icon] ?? Network
            const isActive = view === v.id
            return (
              <button
                key={v.id}
                onClick={() => setView(v.id as ViewId)}
                className={[
                  'group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-all duration-200 overflow-hidden',
                  isActive
                    ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/20 shadow-[0_0_12px_rgba(99,102,241,0.15)]'
                    : 'text-white/35 hover:text-white/70 hover:bg-white/[0.05] border border-transparent',
                ].join(' ')}
              >
                {/* Active left border indicator */}
                {isActive && (
                  <span className="absolute left-0 top-1 bottom-1 w-[2px] rounded-r-full bg-gradient-to-b from-indigo-400 to-indigo-600" />
                )}
                {/* Hover slide-in bg */}
                {!isActive && (
                  <span className="absolute inset-0 -translate-x-full group-hover:translate-x-0 bg-gradient-to-r from-indigo-500/[0.06] to-transparent transition-transform duration-300" />
                )}
                <Icon
                  size={15}
                  className={['shrink-0 transition-all', isActive ? 'text-indigo-400' : 'text-white/25 group-hover:text-white/50'].join(' ')}
                  style={isActive ? { filter: 'drop-shadow(0 0 6px rgba(99,102,241,0.7))' } : {}}
                />
                <span className="truncate relative z-10">{v.label}</span>
                {isActive && <span className="ml-auto w-1 h-1 rounded-full bg-indigo-400 shrink-0" />}
              </button>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-white/[0.05] p-3 flex flex-col gap-2">
          <div className="flex items-center gap-2 px-1">
            <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-[10px] text-white font-semibold shrink-0">D</div>
            <div className="flex flex-col min-w-0">
              <span className="text-[11px] text-white/70 font-medium truncate">Dimitris</span>
              <span className="text-[9px] text-white/25">Admin</span>
            </div>
          </div>
          <div className="mono text-[9px] text-white/15 uppercase tracking-wider px-1">UPPED · v2.0</div>
        </div>
      </aside>

      <main className="relative flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  )
}

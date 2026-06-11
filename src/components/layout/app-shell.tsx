import { type ReactNode, useState } from 'react'
import {
  Network, Smartphone, Layers, Shield, Zap,
  Briefcase, Terminal, Database, Settings, Moon, Sun,
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
  const view = useUIStore((s) => s.view)
  const setView = useUIStore((s) => s.setView)
  const [dark, setDark] = useState(true)

  return (
    <div className="flex h-full bg-[#0a0a0f]">
      <aside className="flex w-[200px] shrink-0 flex-col border-r border-white/5 bg-[#0a0a0f]">
        <div className="flex items-center gap-2.5 border-b border-white/5 px-4 py-4">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
          </span>
          <span className="mono text-[11px] font-semibold uppercase tracking-widest text-white/80">
            UPPED FARM
          </span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {VIEWS.map((v) => {
            const Icon = ICON_MAP[v.icon] ?? Network
            const isActive = view === v.id
            return (
              <button
                key={v.id}
                onClick={() => setView(v.id as ViewId)}
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
        <div className="border-t border-white/5 px-4 py-3 flex items-center justify-between">
          <div className="mono text-[10px] text-white/25 uppercase tracking-wider">UPPED · v2</div>
          <button
            onClick={() => setDark(d => !d)}
            className="p-1 rounded-md text-white/25 hover:text-white/60 hover:bg-white/[0.06] transition-colors"
            title="Toggle theme"
          >
            {dark ? <Moon size={13} /> : <Sun size={13} />}
          </button>
        </div>
      </aside>
      <main className="relative flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  )
}

import { type ReactNode, useState, useEffect, useCallback, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Network, Smartphone, Layers, Users, Zap,
  Briefcase, Terminal, Database, Settings, Grid2x2,
  PanelLeftClose, PanelLeftOpen, Menu,
  type LucideIcon,
} from 'lucide-react'
import { VIEWS, type ViewId } from '@/lib/views'
import { EXPO_OUT } from '@/lib/motion'
import { useUIStore } from '@/state/ui-store'
import { useSettings, type SidebarMode } from '@/state/settings-store'
import { useFleetStats } from '@/hooks/use-fleet'

const ICON_MAP: Record<string, LucideIcon> = {
  network:    Network,
  smartphone: Smartphone,
  layers:     Layers,
  users:      Users,
  zap:        Zap,
  briefcase:  Briefcase,
  terminal:   Terminal,
  database:   Database,
  settings:   Settings,
}

const EXPANDED_W = 210
const RAIL_W = 56

function SidebarContent({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const view    = useUIStore((s) => s.view)
  const setView = useUIStore((s) => s.setView)
  const stats   = useFleetStats()
  const workspaceName = useSettings((s) => s.workspaceName)
  const [time, setTime] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const online = stats.idle + stats.busy

  return (
    <>
      {/* Logo */}
      <div className={`flex items-center gap-3 border-b border-line py-5 ${collapsed ? 'justify-center px-0' : 'px-4'}`}>
        <div className="flex h-7 w-7 shrink-0 items-center justify-center border border-white/20">
          <Grid2x2 size={12} className="text-white/70" />
        </div>
        {!collapsed && (
          <div className="flex min-w-0 flex-col">
            <span className="mono truncate text-[13px] font-bold leading-tight tracking-widest text-white">{workspaceName.toUpperCase()}</span>
            <span className="mono text-[8px] uppercase tracking-wider text-white/30">CONTROL PLANE V2.1</span>
          </div>
        )}
      </div>

      {/* Clock */}
      {!collapsed && (
        <div className="border-b border-white/[0.06] px-4 py-2">
          <span className="mono text-[10px] tracking-widest text-white/25">
            {time.toLocaleTimeString('en-US', { hour12: false })} UTC
          </span>
        </div>
      )}

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-0 overflow-y-auto py-2" aria-label="Primary">
        {VIEWS.map((v) => {
          const Icon    = ICON_MAP[v.icon] ?? Network
          const isActive = view === v.id
          return (
            <button
              key={v.id}
              onClick={() => { setView(v.id as ViewId); onNavigate?.() }}
              title={collapsed ? v.label : undefined}
              aria-label={v.label}
              aria-current={isActive ? 'page' : undefined}
              className={`group relative flex w-full items-center gap-3 py-2.5 text-left text-xs transition-all duration-150 ${collapsed ? 'justify-center px-0' : 'px-4'}`}
              style={{
                color: isActive ? '#ffffff' : 'rgba(255,255,255,0.35)',
                borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                background: isActive ? 'var(--accent-soft)' : 'transparent',
              }}
            >
              <Icon
                size={collapsed ? 15 : 13}
                className="shrink-0 transition-colors"
                style={{ color: isActive ? 'var(--accent-text)' : 'rgba(255,255,255,0.25)' }}
              />
              {!collapsed && <span className="mono relative z-10 truncate text-[10px] uppercase tracking-wider">{v.label}</span>}
            </button>
          )
        })}
      </nav>

      {/* System status */}
      <div className={`flex flex-col gap-3 border-t border-line p-4 ${collapsed ? 'items-center px-0' : ''}`}>
        <div className="flex items-center gap-2.5">
          <span className="status-dot-pulse h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: '#34d399' }} />
          {!collapsed && (
            <span className="mono text-[9px] uppercase tracking-widest" style={{ color: '#34d399' }}>
              SYSTEMS NOMINAL
            </span>
          )}
        </div>
        {!collapsed && (
          <div className="mono text-[8px] uppercase tracking-wider text-white/15">
            {stats.total} DEVICES · {online} ONLINE
          </div>
        )}
      </div>
    </>
  )
}

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const sidebarMode = useSettings((s) => s.sidebarMode)
  const update = useSettings((s) => s.update)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)

  const setMode = useCallback((m: SidebarMode) => {
    update({ sidebarMode: m })
    if (m !== 'autohide') setOverlayOpen(false)
  }, [update])

  // Ctrl/Cmd+B toggles expanded ↔ collapsed (or opens the auto-hidden overlay).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        const mode = useSettings.getState().sidebarMode
        if (mode === 'autohide') setOverlayOpen((o) => !o)
        else setMode(mode === 'expanded' ? 'collapsed' : 'expanded')
      }
      if (e.key === 'Escape' && useSettings.getState().sidebarMode === 'autohide') {
        setOverlayOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setMode])

  // Auto-hide: keep open while pointer or keyboard focus is inside.
  const closeOverlaySoon = () => {
    setTimeout(() => {
      const el = overlayRef.current
      if (el && (el.matches(':hover') || el.contains(document.activeElement))) return
      setOverlayOpen(false)
    }, 250)
  }

  const collapsed = sidebarMode === 'collapsed'
  const autohide = sidebarMode === 'autohide'

  return (
    <div className="flex h-full">
      {/* Docked sidebar (expanded / collapsed rail) */}
      {!autohide && (
        <motion.aside
          initial={false}
          animate={{ width: collapsed ? RAIL_W : EXPANDED_W }}
          transition={{ duration: 0.2, ease: EXPO_OUT }}
          className="relative flex shrink-0 flex-col overflow-hidden border-r border-line bg-black"
        >
          <SidebarContent collapsed={collapsed} />
          {/* Mode controls */}
          <div className={`flex border-t border-line ${collapsed ? 'flex-col items-center gap-1 py-2' : 'items-center justify-between px-3 py-2'}`}>
            <button
              type="button"
              onClick={() => setMode(collapsed ? 'expanded' : 'collapsed')}
              title={`${collapsed ? 'Expand' : 'Collapse'} sidebar (Ctrl+B)`}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="flex h-7 w-7 items-center justify-center rounded-control text-white/30 transition-colors hover:bg-hover hover:text-white/70"
            >
              {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
            </button>
            <button
              type="button"
              onClick={() => setMode('autohide')}
              title="Auto-hide sidebar"
              aria-label="Auto-hide sidebar"
              className="mono flex h-7 items-center justify-center rounded-control px-1.5 text-[8px] uppercase tracking-wider text-white/25 transition-colors hover:bg-hover hover:text-white/60"
            >
              {collapsed ? <Menu size={12} /> : 'Auto-hide'}
            </button>
          </div>
        </motion.aside>
      )}

      {/* Auto-hide: edge trigger + floating menu button + overlay drawer */}
      {autohide && (
        <>
          <div
            className="fixed left-0 top-0 z-40 h-full w-1.5"
            onPointerEnter={() => setOverlayOpen(true)}
            aria-hidden
          />
          <button
            type="button"
            onClick={() => setOverlayOpen(true)}
            title="Open menu (Ctrl+B)"
            aria-label="Open navigation menu"
            className="fixed left-3 top-3 z-40 flex h-8 w-8 items-center justify-center rounded-control border border-line bg-black/70 text-white/50 backdrop-blur-sm transition-colors hover:text-white"
          >
            <Menu size={14} />
          </button>
          <AnimatePresence>
            {overlayOpen && (
              <>
                <motion.div
                  className="fixed inset-0 z-40 bg-black/40"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => setOverlayOpen(false)}
                />
                <motion.aside
                  ref={overlayRef}
                  initial={{ x: -EXPANDED_W }}
                  animate={{ x: 0 }}
                  exit={{ x: -EXPANDED_W }}
                  transition={{ duration: 0.2, ease: EXPO_OUT }}
                  className="fixed left-0 top-0 z-50 flex h-full flex-col border-r border-line bg-black shadow-2xl"
                  style={{ width: EXPANDED_W }}
                  onPointerLeave={closeOverlaySoon}
                  onBlur={closeOverlaySoon}
                >
                  <SidebarContent collapsed={false} onNavigate={() => setOverlayOpen(false)} />
                  <div className="flex items-center justify-between border-t border-line px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setMode('expanded')}
                      title="Pin sidebar open"
                      aria-label="Pin sidebar open"
                      className="mono flex h-7 items-center rounded-control px-1.5 text-[8px] uppercase tracking-wider text-white/25 transition-colors hover:bg-hover hover:text-white/60"
                    >
                      Pin expanded
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('collapsed')}
                      title="Pin as icon rail"
                      aria-label="Pin sidebar as icon rail"
                      className="mono flex h-7 items-center rounded-control px-1.5 text-[8px] uppercase tracking-wider text-white/25 transition-colors hover:bg-hover hover:text-white/60"
                    >
                      Pin rail
                    </button>
                  </div>
                </motion.aside>
              </>
            )}
          </AnimatePresence>
        </>
      )}

      <main className="relative flex-1 overflow-hidden">
        <div className="app-bg-grid pointer-events-none absolute inset-0 opacity-70" aria-hidden />
        <div className="relative h-full">{children}</div>
      </main>
    </div>
  )
}

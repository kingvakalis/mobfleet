import { type ReactNode, useState, useEffect, useCallback, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Network, Smartphone, Layers, Users, Zap,
  Briefcase, Terminal, Database, Settings,
  Globe, Gauge,
  PanelLeftClose, PanelLeftOpen,
  type LucideIcon,
} from 'lucide-react'
import { BrandLogo } from '@/components/brand/brand-logo'
import { VIEWS, type ViewId } from '@/lib/views'
import { EXPO_OUT } from '@/lib/motion'
import { useUIStore } from '@/state/ui-store'
import { useSettings } from '@/state/settings-store'
import { useFleetStats } from '@/hooks/use-fleet'
import { useActingMember } from '@/lib/authorization/use-access'
import { canAny } from '@/lib/authorization/effective-access'
import { TeamSwitcher } from '@/components/team/team-switcher'
import { SupabaseTeamSwitcher } from '@/components/team/supabase-team-switcher'
import { AUTH_SOURCE } from '@/auth/auth-source'
import { isSupabaseConfigured } from '@/lib/supabase'

// In supabase-mode (the real customer build), pages flagged hideInSupabaseMode are
// dropped from the nav — they are mock/demo or backed by a backend the customer's
// Supabase JWT can't reach. Demo/standalone builds (Supabase not configured) keep them.
const SUPABASE_MODE = AUTH_SOURCE === 'supabase' && isSupabaseConfigured

const ICON_MAP: Record<string, LucideIcon> = {
  network:    Network,
  smartphone: Smartphone,
  globe:      Globe,
  gauge:      Gauge,
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
  const member  = useActingMember()
  const [time, setTime] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const online = stats.idle + stats.busy
  // Permission-aware nav: only sections the acting user may open — and, in
  // supabase-mode, excluding pages gated as hideInSupabaseMode (mock/unreachable).
  const visibleViews = VIEWS.filter((v) => canAny(member, v.requiredAny) && !(SUPABASE_MODE && v.hideInSupabaseMode))

  return (
    <>
      {/* Logo */}
      <div className={`flex items-center gap-3 border-b border-line py-5 ${collapsed ? 'justify-center px-0' : 'px-4'}`}>
        <BrandLogo className="h-7 w-7 shrink-0" />
        {!collapsed && (
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] font-bold leading-tight tracking-widest text-white" style={{ fontFamily: 'Arimo, "Helvetica Neue", Helvetica, Arial, sans-serif' }}>{workspaceName.toUpperCase()}</span>
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

      {/* Workspace switcher — me-mode (/v1/me) and supabase-mode (team_members);
          each renders only in its own mode + when the user has 2+ active teams. */}
      <TeamSwitcher collapsed={collapsed} />
      <SupabaseTeamSwitcher collapsed={collapsed} />

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-0 overflow-y-auto py-2" aria-label="Primary">
        {visibleViews.map((v) => {
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
                // Inactive labels at 0.55 (not 0.35) so the 10px nav text clears
                // WCAG AA 4.5:1 on the dark rail, while staying clearly dimmer
                // than the bright-white active item.
                color: isActive ? '#ffffff' : 'rgba(255,255,255,0.55)',
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
  const sidebarModeRaw = useSettings((s) => s.sidebarMode)
  // Older persisted values ('autohide') coerce to the rail.
  const sidebarMode = sidebarModeRaw === 'expanded' ? 'expanded' : 'collapsed'
  const update = useSettings((s) => s.update)
  // Rail hover-expand: the docked rail keeps the layout, a full-width overlay
  // slides over it while the pointer (or keyboard focus) is on the sidebar.
  const [hoverExpand, setHoverExpand] = useState(false)
  const hoverCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  const setMode = useCallback((m: 'expanded' | 'collapsed') => {
    update({ sidebarMode: m })
    setHoverExpand(false)
  }, [update])

  // Ctrl/Cmd+B toggles expanded ↔ rail.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        const mode = useSettings.getState().sidebarMode
        setMode(mode === 'expanded' ? 'collapsed' : 'expanded')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setMode])

  const collapsed = sidebarMode === 'collapsed'

  const openHover = () => {
    if (hoverCloseTimer.current) clearTimeout(hoverCloseTimer.current)
    setHoverExpand(true)
  }
  const closeHoverSoon = () => {
    if (hoverCloseTimer.current) clearTimeout(hoverCloseTimer.current)
    hoverCloseTimer.current = setTimeout(() => {
      const el = overlayRef.current
      if (el && el.contains(document.activeElement)) return
      setHoverExpand(false)
    }, 180)
  }

  return (
    <div className="flex h-full">
      {/* Docked sidebar — full width or icon rail */}
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? RAIL_W : EXPANDED_W }}
        transition={{ duration: 0.2, ease: EXPO_OUT }}
        className="relative flex shrink-0 flex-col overflow-hidden border-r border-line bg-black"
        onPointerEnter={collapsed ? openHover : undefined}
      >
        <SidebarContent collapsed={collapsed} />
        {/* Mode toggle */}
        <div className={`flex border-t border-line ${collapsed ? 'justify-center py-2' : 'items-center px-3 py-2'}`}>
          <button
            type="button"
            onClick={() => setMode(collapsed ? 'expanded' : 'collapsed')}
            title={`${collapsed ? 'Expand' : 'Collapse'} sidebar (Ctrl+B)`}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex h-7 w-7 items-center justify-center rounded-control text-white/30 transition-colors hover:bg-hover hover:text-white/70"
          >
            {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
          </button>
        </div>
      </motion.aside>

      {/* Rail hover overlay — fully expanded sidebar above the content */}
      <AnimatePresence>
        {collapsed && hoverExpand && (
          <motion.div
            ref={overlayRef}
            initial={{ x: -(EXPANDED_W - RAIL_W), opacity: 0.6 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -(EXPANDED_W - RAIL_W), opacity: 0 }}
            transition={{ duration: 0.18, ease: EXPO_OUT }}
            className="fixed left-0 top-0 z-50 flex h-full flex-col border-r border-line bg-black shadow-[24px_0_60px_-30px_rgba(0,0,0,0.8)]"
            style={{ width: EXPANDED_W }}
            onPointerEnter={openHover}
            onPointerLeave={closeHoverSoon}
            onBlur={closeHoverSoon}
          >
            <SidebarContent collapsed={false} onNavigate={() => setHoverExpand(false)} />
            <div className="flex items-center px-3 py-2 border-t border-line">
              <button
                type="button"
                onClick={() => setMode('expanded')}
                title="Pin sidebar open (Ctrl+B)"
                aria-label="Pin sidebar open"
                className="flex h-7 w-7 items-center justify-center rounded-control text-white/30 transition-colors hover:bg-hover hover:text-white/70"
              >
                <PanelLeftOpen size={14} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="relative flex-1 overflow-hidden">
        <div className="app-bg-grid pointer-events-none absolute inset-0 opacity-70" aria-hidden />
        <div className="relative h-full">{children}</div>
      </main>
    </div>
  )
}

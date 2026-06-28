import { type ReactNode, type FocusEvent, useState, useEffect, useCallback, useRef } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import {
  Network, Smartphone, Layers, Users, Zap,
  Briefcase, Terminal, Database, Settings,
  Globe, Gauge,
  PanelLeftClose, PanelLeftOpen,
  type LucideIcon,
} from 'lucide-react'
import { BrandLogo } from '@/components/brand/brand-logo'
import { SignOutButton } from '@/components/auth/sign-out-button'
import { useAuth } from '@/contexts/AuthContext'
import { VIEWS, type ViewId } from '@/lib/views'
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
// Hover INTENT: the rail must not pop open on a quick fly-by — only after the pointer
// dwells on it. Open after a dwell; close after a short grace (cancels flicker); both
// cancel each other. Keyboard focus still expands instantly (no dwell — accessibility).
const HOVER_OPEN_DELAY_MS = 200   // dwell before expanding; a fly-by leaves first and never opens
const HOVER_CLOSE_DELAY_MS = 150  // grace before collapsing; re-entering cancels it (no flicker)
// Calm, intentional expand/collapse — a gentle ease-in-out, NOT a snappy expo pop.
const RAIL_ANIM_DURATION = 0.35
const RAIL_EASE: [number, number, number, number] = [0.4, 0, 0.2, 1]

function SidebarContent({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const view    = useUIStore((s) => s.view)
  const setView = useUIStore((s) => s.setView)
  const stats   = useFleetStats()
  const workspaceName = useSettings((s) => s.workspaceName)
  const member  = useActingMember()
  const { enabled: authEnabled } = useAuth()
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
            <span className="text-[8px] uppercase tracking-wider text-white/30">CONTROL PLANE V2.1</span>
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
              {!collapsed && <span className="relative z-10 truncate text-[10px] uppercase tracking-wider">{v.label}</span>}
            </button>
          )
        })}
      </nav>

      {/* System status */}
      <div className={`flex flex-col gap-3 border-t border-line p-4 ${collapsed ? 'items-center px-0' : ''}`}>
        <div className="flex items-center gap-2.5">
          <span className="status-dot-pulse h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: '#34d399' }} />
          {!collapsed && (
            <span className="text-[9px] uppercase tracking-wide" style={{ color: '#34d399' }}>
              SYSTEMS NOMINAL
            </span>
          )}
        </div>
        {!collapsed && (
          <div className="text-[8px] uppercase tracking-wide text-white/15">
            {stats.total} DEVICES · {online} ONLINE
          </div>
        )}
        {/* Sign Out — only with real auth (mock/demo build has no session to end). */}
        {authEnabled && <SignOutButton variant="sidebar" collapsed={collapsed} />}
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
  const view = useUIStore((s) => s.view)
  const reduceMotion = useReducedMotion() ?? false

  // Deterministic expand model. The rail is expanded when intentionally PINNED, or
  // transiently while the pointer HOVERS it, or while keyboard FOCUS is inside it.
  // These three are INDEPENDENT: closing one never depends on (or is blocked by)
  // another — conflating hover with focus is what previously left it stuck open
  // (a focused nav button kept pointer-leave from ever collapsing the peek).
  //   isExpanded = isPinned || isHovered || isFocusWithin
  // The rail is a normal flex child, so its width drives the layout and
  // pushes/compresses the content beside it — it never overlays the page.
  const isPinned = sidebarMode === 'expanded'
  const [isHovered, setIsHovered] = useState(false)
  const [isFocusWithin, setIsFocusWithin] = useState(false)
  const isExpanded = isPinned || isHovered || isFocusWithin

  const asideRef = useRef<HTMLElement>(null)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearOpenTimer = useCallback(() => {
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null }
  }, [])
  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
  }, [])

  // Drop BOTH transient peeks and release any focus lingering inside the rail, so it
  // collapses cleanly and can't immediately re-expand from a stale focus. Used on
  // route change and on a pointer-down in the main content.
  const resetPeek = useCallback(() => {
    clearOpenTimer()
    clearCloseTimer()
    setIsHovered(false)
    setIsFocusWithin(false)
    const el = asideRef.current
    if (el && document.activeElement instanceof HTMLElement && el.contains(document.activeElement)) {
      document.activeElement.blur()
    }
  }, [clearOpenTimer, clearCloseTimer])

  const setMode = useCallback((m: 'expanded' | 'collapsed') => {
    update({ sidebarMode: m })
    clearOpenTimer()
    clearCloseTimer()
    setIsHovered(false)
    setIsFocusWithin(false)
  }, [update, clearOpenTimer, clearCloseTimer])

  // Ctrl/Cmd+B toggles pinned-open ↔ rail.
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

  // Route/view change always collapses the peek (it must never survive navigation),
  // including programmatic view changes the rail's own handlers can't observe.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: drop the transient peek on navigation
    resetPeek()
  }, [view, resetPeek])
  // Drop pending timers on unmount (no setState after teardown).
  useEffect(() => () => { clearOpenTimer(); clearCloseTimer() }, [clearOpenTimer, clearCloseTimer])

  // Hover (pointer): open only after a DWELL (hover intent) so a quick fly-by never
  // pops the rail; close after a short grace so a slight leave/re-enter doesn't
  // flicker. Each timer cancels the other.
  const onPointerEnter = useCallback(() => {
    clearCloseTimer()                              // cancel a pending collapse
    if (isHovered || openTimer.current) return     // already open, or an open is already pending
    openTimer.current = setTimeout(() => { openTimer.current = null; setIsHovered(true) }, HOVER_OPEN_DELAY_MS)
  }, [clearCloseTimer, isHovered])
  const onPointerLeave = useCallback(() => {
    clearOpenTimer()                               // left before the dwell finished → never opens (fly-by)
    clearCloseTimer()
    closeTimer.current = setTimeout(() => { closeTimer.current = null; setIsHovered(false) }, HOVER_CLOSE_DELAY_MS)
  }, [clearOpenTimer, clearCloseTimer])
  // Focus-within: bubbling focus/blur. Stay open while focus moves BETWEEN rail
  // items; collapse only when focus leaves the rail entirely (relatedTarget outside
  // or null). Independent of hover, so it never blocks the pointer-leave collapse.
  const onFocus = useCallback(() => setIsFocusWithin(true), [])
  const onBlur = useCallback((e: FocusEvent<HTMLElement>) => {
    const next = e.relatedTarget as Node | null
    if (!asideRef.current || !next || !asideRef.current.contains(next)) setIsFocusWithin(false)
  }, [])

  const collapsed = !isPinned // rail (vs pinned-open) — drives the toggle icon/label
  const showLabels = isExpanded
  const railWidth = showLabels ? EXPANDED_W : RAIL_W

  return (
    <div className="flex h-full">
      {/* Docked sidebar — a real flex child: expanding (pinned OR the rail hover/
          focus peek) RESIZES the layout and reflows the content beside it; never an
          overlay. The <aside> is the single width authority. */}
      <motion.aside
        ref={asideRef}
        initial={false}
        animate={{ width: railWidth }}
        transition={reduceMotion ? { duration: 0 } : { duration: RAIL_ANIM_DURATION, ease: RAIL_EASE }}
        className="relative flex shrink-0 flex-col overflow-hidden border-r border-line bg-black"
        onPointerEnter={isPinned ? undefined : onPointerEnter}
        onPointerLeave={isPinned ? undefined : onPointerLeave}
        onFocus={isPinned ? undefined : onFocus}
        onBlur={isPinned ? undefined : onBlur}
      >
        <SidebarContent collapsed={!showLabels} onNavigate={isPinned ? undefined : resetPeek} />
        {/* Mode toggle (pin open ↔ collapse to rail) */}
        <div className={`flex border-t border-line ${showLabels ? 'items-center px-3 py-2' : 'justify-center py-2'}`}>
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

      {/* min-w-0 lets the content compress as the rail widens; a pointer-down here
          collapses an unpinned hover/focus peek. */}
      <main
        className="relative min-w-0 flex-1 overflow-hidden"
        onPointerDown={isPinned ? undefined : resetPeek}
      >
        <div className="app-bg-grid pointer-events-none absolute inset-0 opacity-70" aria-hidden />
        <div className="relative h-full">{children}</div>
      </main>
    </div>
  )
}

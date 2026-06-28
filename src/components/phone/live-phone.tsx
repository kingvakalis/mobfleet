import {
  forwardRef, useImperativeHandle, useState, useEffect, useMemo, useCallback, useRef,
} from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Power, TriangleAlert, Lock as LockIcon, Camera } from 'lucide-react'
import { STATUS } from '@/lib/status'
import type { Device, Job } from '@/lib/provider/types'
import type { LogLevel } from '@/hooks/use-device-log'
import { EXPO_OUT } from '@/lib/motion'

import { GRID_APPS, DOCK_APPS, ALL_APPS, type AppDef } from './app-catalog'
import { clampSwipeSeg } from './swipe-safety'

// ─── Imperative control surface ──────────────────────────────────────────────

export type SwipeDir = 'up' | 'down' | 'left' | 'right'

export interface LivePhoneHandle {
  home: () => void
  back: () => void
  lock: () => void
  screenshot: () => void
  switcher: () => void
  launchApp: (name: string) => void
  swipe: (dir: SwipeDir) => void
  tapCenter: () => void
}

interface Ripple { x: number; y: number; id: number }
interface SwipeViz { dir: SwipeDir; id: number }

/** A REAL captured device frame (supabase-mode). `src` is a data: URL (png/jpeg/webp);
 *  `width`/`height` are the device LOGICAL size (points) used to map a pointer gesture on
 *  the displayed frame to device coordinates. Absent (`undefined`) → legacy simulated screen. */
export interface LiveFrame { src: string; capturedAt: number; width: number | null; height: number | null }

/** A pointer gesture on the REAL device screen, in device LOGICAL points. */
export type PhoneGesture =
  | { type: 'tap'; x: number; y: number }
  | { type: 'swipe'; x1: number; y1: number; x2: number; y2: number; dir: SwipeDir; durationMs: number }
  | { type: 'scroll'; x1: number; y1: number; x2: number; y2: number; dir: SwipeDir; durationMs: number }
  | { type: 'long_press'; x: number; y: number; durationMs: number }

// Pointer-gesture thresholds (glass px / ms).
const TAP_MOVE_PX = 10
const LONG_PRESS_MS = 500

/** Linear map of a glass point to device LOGICAL points. The glass is sized to the frame's
 *  aspect ratio (object-fit: cover with matched aspect → no letterbox, no crop), so this is
 *  exact. Clamped to device bounds. */
function mapPointToDevice(x: number, y: number, glassW: number, glassH: number, devW: number, devH: number): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(devW, Math.round((x / glassW) * devW))),
    y: Math.max(0, Math.min(devH, Math.round((y / glassH) * devH))),
  }
}

/** Dominant 4-way direction of a drag delta (device points). */
function dragDir(dx: number, dy: number): SwipeDir {
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'down' : 'up')
}

function useClock(): string {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(now.getHours())}:${p(now.getMinutes())}`
}

function uploadStep(p: number): string {
  if (p < 0.12) return 'PREPARING'
  if (p < 0.5)  return 'ENCODING'
  if (p < 0.9)  return 'UPLOADING'
  return 'PUBLISHING'
}

// ─── Screen chrome ───────────────────────────────────────────────────────────

function IOSStatusBar({ f, clock, battery }: { f: number; clock: string; battery: number }) {
  const batColor = battery > 40 ? '#ffffff' : battery > 15 ? '#ffb300' : '#ff3b3b'
  return (
    <div className="flex items-center justify-between" style={{ padding: `${10 * f}px ${18 * f}px ${2 * f}px` }}>
      <span className="mono font-semibold text-white" style={{ fontSize: 11 * f }}>{clock}</span>
      <div className="flex items-center" style={{ gap: 5 * f }}>
        <div className="flex items-end" style={{ gap: 1.5 * f }}>
          {[3, 5, 7, 9].map((h, i) => (
            <div
              key={h}
              style={{
                width: 2.5 * f,
                height: h * f,
                borderRadius: 1,
                background: i < 3 ? '#fff' : 'rgba(255,255,255,0.35)',
              }}
            />
          ))}
        </div>
        <div
          className="flex items-center rounded-sm border border-white/60"
          style={{ width: 19 * f, height: 9.5 * f, padding: 1.5 * f }}
        >
          <div className="h-full rounded-[1px]" style={{ width: `${battery}%`, background: batColor }} />
        </div>
      </div>
    </div>
  )
}

function AppIcon({ app, f, size = 46, onLaunch }: {
  app: AppDef; f: number; size?: number; onLaunch?: (name: string) => void
}) {
  return (
    <button
      type="button"
      onClick={onLaunch ? (e) => { e.stopPropagation(); onLaunch(app.name) } : undefined}
      className="flex flex-col items-center"
      style={{ gap: 3 * f }}
      tabIndex={-1}
    >
      <motion.div
        whileHover={{ scale: 1.12 }}
        whileTap={{ scale: 0.9 }}
        className="flex items-center justify-center font-bold"
        style={{
          width: size * f,
          height: size * f,
          borderRadius: 12 * f,
          background: app.bg,
          border: app.border ? `1.5px solid ${app.border}` : 'none',
          color: app.textColor ?? '#fff',
          fontSize: 10 * f,
        }}
      >
        {app.abbr}
      </motion.div>
      <span className="truncate text-center text-white/50" style={{ fontSize: 7.5 * f, maxWidth: size * f + 8 }}>
        {app.name}
      </span>
    </button>
  )
}

// ─── Screens ─────────────────────────────────────────────────────────────────

function Springboard({ f, clock, battery, job, onLaunch }: {
  f: number; clock: string; battery: number; job?: Job | null
  onLaunch: (name: string) => void
}) {
  return (
    <div className="flex h-full flex-col">
      <IOSStatusBar f={f} clock={clock} battery={battery} />
      {/* dynamic island */}
      <div className="flex justify-center" style={{ marginBottom: 6 * f }}>
        <div className="rounded-full bg-black" style={{ width: 76 * f, height: 22 * f }} />
      </div>
      {/* running job pill */}
      {job && (
        <div className="flex justify-center" style={{ marginBottom: 4 * f }}>
          <div
            className="mono flex items-center rounded-full border border-[#4fc3f7]/40 bg-[#4fc3f7]/10 text-[#7dd3fc]"
            style={{ gap: 4 * f, padding: `${2 * f}px ${8 * f}px`, fontSize: 7.5 * f }}
          >
            <span className="rounded-full bg-[#4fc3f7] status-dot-pulse" style={{ width: 4 * f, height: 4 * f }} />
            {job.type.toUpperCase()} {Math.round(job.progress * 100)}%
          </div>
        </div>
      )}
      {/* app grid */}
      <div className="grid grid-cols-4" style={{ rowGap: 8 * f, columnGap: 4 * f, padding: `0 ${12 * f}px` }}>
        {GRID_APPS.map(app => <AppIcon key={app.name} app={app} f={f} onLaunch={onLaunch} />)}
      </div>
      {/* dock */}
      <div
        className="mt-auto flex items-center justify-around"
        style={{
          margin: `0 ${12 * f}px ${10 * f}px`,
          padding: `${6 * f}px ${8 * f}px`,
          borderRadius: 16 * f,
          background: 'rgba(255,255,255,0.07)',
          border: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        {DOCK_APPS.map(app => (
          <motion.button
            key={app.name}
            type="button"
            whileTap={{ scale: 0.88 }}
            onClick={(e) => { e.stopPropagation(); onLaunch(app.name) }}
            className="flex items-center justify-center font-bold text-white"
            style={{ width: 42 * f, height: 42 * f, borderRadius: 11 * f, background: app.bg, fontSize: 10 * f }}
            tabIndex={-1}
          >
            {app.abbr}
          </motion.button>
        ))}
      </div>
    </div>
  )
}

function AppScreen({ f, clock, battery, app }: {
  f: number; clock: string; battery: number; app: AppDef
}) {
  return (
    <motion.div
      className="flex h-full flex-col"
      initial={{ scale: 0.85, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.9, opacity: 0 }}
      transition={{ duration: 0.28, ease: EXPO_OUT }}
    >
      <IOSStatusBar f={f} clock={clock} battery={battery} />
      <div className="flex items-center" style={{ gap: 6 * f, padding: `${6 * f}px ${12 * f}px` }}>
        <div
          className="flex items-center justify-center font-bold"
          style={{
            width: 22 * f, height: 22 * f, borderRadius: 6 * f,
            background: app.bg, border: app.border ? `1px solid ${app.border}` : 'none',
            color: app.textColor ?? '#fff', fontSize: 8 * f,
          }}
        >
          {app.abbr}
        </div>
        <span className="font-semibold text-white" style={{ fontSize: 10 * f }}>{app.name}</span>
        <span className="ml-auto text-[#00ff88]" style={{ fontSize: 7 * f }}>ACTIVE</span>
      </div>
      {/* skeleton feed */}
      <div className="flex flex-1 flex-col" style={{ gap: 6 * f, padding: `${4 * f}px ${12 * f}px` }}>
        <div className="shimmer w-full rounded-md" style={{ height: '38%' }} />
        <div className="rounded-full bg-white/10" style={{ height: 4 * f, width: '72%' }} />
        <div className="rounded-full bg-white/[0.07]" style={{ height: 4 * f, width: '48%' }} />
        <div className="shimmer w-full rounded-md" style={{ height: '24%' }} />
        <div className="rounded-full bg-white/[0.07]" style={{ height: 4 * f, width: '60%' }} />
      </div>
    </motion.div>
  )
}

function JobScreen({ f, clock, device, job }: {
  f: number; clock: string; device: Device; job: Job
}) {
  const color = STATUS[device.status].color
  const pct = Math.round(job.progress * 100)
  return (
    <div className="flex h-full flex-col">
      <IOSStatusBar f={f} clock={clock} battery={device.battery} />
      <div className="flex items-center" style={{ gap: 6 * f, padding: `${8 * f}px ${14 * f}px 0` }}>
        <span className="rounded-full" style={{ width: 6 * f, height: 6 * f, background: color, boxShadow: `0 0 6px ${color}` }} />
        <span className="label text-fg" style={{ fontSize: 8.5 * f }}>{job.type}</span>
        <span className="label ml-auto text-fg-muted" style={{ fontSize: 7.5 * f }}>{uploadStep(job.progress)}</span>
      </div>
      <div className="overflow-hidden border border-line" style={{ margin: `${10 * f}px ${14 * f}px 0`, borderRadius: 8 * f, aspectRatio: '4/5' }}>
        <div className="shimmer h-full w-full bg-gradient-to-br from-[#1a1a1f] via-[#101015] to-[#0a0a0a]" />
      </div>
      <div style={{ margin: `${10 * f}px ${14 * f}px 0`, display: 'flex', flexDirection: 'column', gap: 5 * f }}>
        <div className="rounded-full bg-white/10" style={{ height: 4 * f, width: '75%' }} />
        <div className="rounded-full bg-white/[0.07]" style={{ height: 4 * f, width: '50%' }} />
      </div>
      <div className="mt-auto" style={{ padding: `0 ${14 * f}px ${16 * f}px` }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 5 * f }}>
          <span className="text-fg-muted" style={{ fontSize: 8 * f }}>{job.id}</span>
          <span className="mono text-fg" style={{ fontSize: 9 * f }}>{pct}%</span>
        </div>
        <div className="overflow-hidden rounded-full bg-white/10" style={{ height: 5 * f }}>
          <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: color }} />
        </div>
      </div>
    </div>
  )
}

/**
 * Neutral, dimension-faithful loading skeleton for the REAL device glass — shown while the FIRST
 * latest-frame read is still in flight (`resolving`). It fills the glass (h-full/w-full) and echoes
 * the phone chrome (status bar + dynamic island) so the first visible state is a polished placeholder
 * instead of the honest-but-premature "Waiting for frame" / "hardware control pending" text.
 */
function ScreenSkeleton({ f }: { f: number }) {
  return (
    <div className="flex h-full w-full flex-col bg-[#050507]" aria-hidden>
      <div className="flex items-center justify-between" style={{ padding: `${10 * f}px ${18 * f}px ${2 * f}px` }}>
        <div className="shimmer rounded" style={{ width: 28 * f, height: 9 * f }} />
        <div className="shimmer rounded" style={{ width: 26 * f, height: 9 * f }} />
      </div>
      <div className="flex justify-center" style={{ marginBottom: 8 * f }}>
        <div className="rounded-full bg-black" style={{ width: 76 * f, height: 22 * f }} />
      </div>
      <div className="shimmer flex-1" style={{ margin: `0 ${10 * f}px ${12 * f}px`, borderRadius: 14 * f }} />
    </div>
  )
}

function CenterScreen({ icon, label, sub, color }: {
  icon: React.ReactNode; label: string; sub?: string; color?: string
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 bg-black">
      {icon}
      <span className="label" style={color ? { color } : undefined}>{label}</span>
      {sub && <span className="text-[9px] text-fg-muted">{sub}</span>}
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

/**
 * A fully interactive, status-driven iPhone. Tap the screen (gesture ripples),
 * launch apps from the springboard, lock/wake, screenshot flash — all
 * controllable from outside through the imperative handle so control panels
 * can drive the same phone the pointer does.
 */
export const LivePhone = forwardRef<LivePhoneHandle, {
  device: Device
  job?: Job | null
  width?: number
  gesture?: string
  /** When true, direct screen interaction is disabled (no control permission). */
  readOnly?: boolean
  onLog: (level: LogLevel, text: string) => void
  /** Reports a screen tap at (x, y) so the PARENT can send the control command —
   *  this component stays visual-only (single send owner). In real-frame mode (x, y)
   *  are device LOGICAL points; otherwise they are CSS pixels in the glass. */
  onTap?: (x: number, y: number) => void
  /** REAL-FRAME MODE (supabase-mode). `undefined` → legacy simulated screen (mock /
   *  demo / me-mode, unchanged). `null` → real device, no frame captured yet (honest
   *  placeholder). A value → render the actual device screenshot. */
  frame?: LiveFrame | null
  /** REAL-FRAME pointer gestures (tap / swipe / scroll / long_press) in device LOGICAL
   *  points — the parent maps them to control commands. Only fired in real-frame mode. */
  onGesture?: (g: PhoneGesture) => void
  /** REAL-FRAME mode only: the FIRST latest-frame read for this device is still in flight. While
   *  true (and there is no frame yet on an online device) the glass shows a neutral skeleton instead
   *  of the resolved "Waiting for frame" placeholder, so we never flash a premature empty state. */
  resolving?: boolean
  /** STAGE 2A live MJPEG. When set (and a `frame` already provides device LOGICAL dims), the glass
   *  renders this multipart/x-mixed-replace stream INSTEAD of the base64 screenshot — a true live
   *  video, decoded natively by the browser. Pointer→device mapping is UNCHANGED (it uses the glass
   *  rect + frame.width/height, not the pixels). Null/undefined → the base64 screenshot path. */
  streamUrl?: string | null
  /** Fired when the MJPEG stream produces its first frame (alive) — the parent stops the screenshot
   *  loop. */
  onStreamLoad?: () => void
  /** Fired when the MJPEG stream fails to load — the parent falls back to the screenshot path. */
  onStreamError?: () => void
  /** True once the stream is actually producing frames. While false (connecting / no publisher yet) the
   *  base64 screenshot stays visible UNDERNEATH the (loading) stream <img>, so GO LIVE never shows a
   *  blank — it shows the screenshot and seamlessly upgrades to the live stream when frames arrive. */
  streamLive?: boolean
}>(function LivePhone({ device, job, width = 260, gesture = 'tap', readOnly = false, onLog, onTap, frame, onGesture, resolving = false, streamUrl = null, onStreamLoad, onStreamError, streamLive = false }, ref) {
  const f = width / 260
  // REAL-frame mode: size the glass to the captured frame's aspect ratio so object-fit: cover
  // fills it with NO black side bars, and pointer→device mapping stays a clean linear scale.
  // Falls back to the classic 1.95 phone ratio for the mock/legacy screen.
  const frameAspect = frame && frame.width && frame.height ? frame.height / frame.width : 1.95
  const screenH = Math.round(width * frameAspect)
  const clock = useClock()
  // When `frame` is provided at all (null or a value) we are driving a REAL device:
  // show the captured screenshot (never the simulated springboard) and suppress the
  // optimistic mock narrations/state — the page logs the real command lifecycle.
  const realMode = frame !== undefined

  const [awake, setAwake] = useState(true)
  const [activeApp, setActiveApp] = useState<string | null>(null)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [recents, setRecents] = useState<string[]>([])
  const [flash, setFlash] = useState(false)
  const [ripple, setRipple] = useState<Ripple | null>(null)
  const [swipeViz, setSwipeViz] = useState<SwipeViz | null>(null)
  // Real-screen pointer-gesture tracking (down → move → up): start point (glass + device),
  // start time, and whether it crossed the move threshold (tap vs drag).
  const ptrRef = useRef<{ gx: number; gy: number; dx: number; dy: number; t: number; moved: boolean; dw: number; dh: number; sh: number } | null>(null)

  const statusColor = STATUS[device.status].color
  // In real mode the device's awake/lock state lives on the physical phone (shown in the
  // captured frame), not in our simulated `awake`, so interactivity tracks device status.
  const interactive = realMode
    ? (device.status === 'online' || device.status === 'busy')
    : awake && (device.status === 'online' || device.status === 'busy')

  // In real-frame mode the mock springboard isn't shown, so the screen-state mutators
  // are no-ops (the real captured frame is the truth) — this also avoids emitting
  // optimistic "launched X"/"home" narrations that would race the real lifecycle log.
  const launchApp = useCallback((name: string) => {
    if (realMode) return
    const app = ALL_APPS.find(a => a.name === name)
    if (!app) return
    setActiveApp(name)
    setSwitcherOpen(false)
    setRecents(r => [name, ...r.filter(n => n !== name)].slice(0, 4))
    onLog('info', `launched ${name}`)
  }, [onLog, realMode])

  const home = useCallback(() => {
    if (realMode) return
    setActiveApp(null)
    setSwitcherOpen(false)
    onLog('info', 'home')
  }, [onLog, realMode])

  const back = useCallback(() => {
    if (realMode) return
    if (switcherOpen) setSwitcherOpen(false)
    else if (activeApp) setActiveApp(null)
    onLog('info', 'back')
  }, [activeApp, switcherOpen, onLog, realMode])

  const lock = useCallback(() => {
    if (realMode) return
    setAwake(a => {
      onLog(a ? 'warn' : 'ok', a ? 'screen locked' : 'screen woke')
      return !a
    })
  }, [onLog, realMode])

  const screenshot = useCallback(() => {
    // The flash is real visual feedback that a capture was requested; keep it in both
    // modes, but don't narrate a fake "captured" in real mode (the real frame arrives async).
    setFlash(true)
    setTimeout(() => setFlash(false), 220)
    if (!realMode) onLog('ok', 'screenshot captured')
  }, [onLog, realMode])

  const switcher = useCallback(() => {
    if (realMode) return
    setSwitcherOpen(s => !s)
    onLog('info', 'app switcher')
  }, [onLog, realMode])

  const swipe = useCallback((dir: SwipeDir) => {
    if (!realMode && !awake) return
    setSwipeViz({ dir, id: Date.now() })
    if (!realMode) onLog('info', `swipe ${dir}`)
  }, [awake, onLog, realMode])

  const tapCenter = useCallback(() => {
    // Mirror the direct-tap guard: tapCenter also sends (via onTap), so it must
    // respect read-only access (defense-in-depth — the button is disabled when
    // read-only and the server enforces phones.control).
    if (readOnly) { onLog('warn', 'control denied — view-only access'); return }
    if (!realMode) {
      if (!awake) { lock(); return }
      const cx = Math.round(width / 2)
      const cy = Math.round(screenH / 2)
      setRipple({ x: cx, y: cy, id: Date.now() })
      onLog('info', 'tap (center)')
      onTap?.(cx, cy)
      return
    }
    // real mode: need the device's logical size to send an accurate center tap.
    if (!frame || !frame.width || !frame.height) { onLog('warn', 'tap ignored — device screen size unknown'); return }
    setRipple({ x: Math.round(width / 2), y: Math.round(screenH / 2), id: Date.now() })
    const cx = Math.round(frame.width / 2), cy = Math.round(frame.height / 2)
    if (onGesture) onGesture({ type: 'tap', x: cx, y: cy }); else onTap?.(cx, cy)
  }, [readOnly, realMode, awake, lock, onLog, width, screenH, onTap, onGesture, frame])

  useImperativeHandle(ref, () => ({ home, back, lock, screenshot, switcher, launchApp, swipe, tapCenter }),
    [home, back, lock, screenshot, switcher, launchApp, swipe, tapCenter])

  // ── REAL-screen pointer gestures (supabase-mode): tap / long-press / swipe / scroll ──
  // Driven by pointer events so a drag (down → move → up) becomes a real swipe/scroll with
  // start/end device coordinates, and a hold becomes a long-press. Device LOGICAL points are
  // emitted via onGesture; the parent owns sending the command (we stay visual-only).
  const onScreenPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!realMode || !interactive) return // no gestures on an offline/error device (screen shows it's dead)
    if (readOnly) { onLog('warn', 'control denied — view-only access'); return }
    if (!frame || !frame.width || !frame.height) { onLog('warn', 'gesture ignored — device screen size unknown'); return }
    const r = e.currentTarget.getBoundingClientRect()
    const gx = e.clientX - r.left, gy = e.clientY - r.top
    const dev = mapPointToDevice(gx, gy, width, screenH, frame.width, frame.height)
    // Snapshot the frame's logical dims + glass height at down-time so a frame arriving mid-drag (GO LIVE)
    // can't remap the gesture across two coordinate scales.
    ptrRef.current = { gx, gy, dx: dev.x, dy: dev.y, t: Date.now(), moved: false, dw: frame.width, dh: frame.height, sh: screenH }
    setRipple({ x: gx, y: gy, id: Date.now() })
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* capture is best-effort */ }
  }
  const onScreenPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = ptrRef.current
    if (!realMode || !p) return
    const r = e.currentTarget.getBoundingClientRect()
    if (!p.moved && Math.hypot((e.clientX - r.left) - p.gx, (e.clientY - r.top) - p.gy) > TAP_MOVE_PX) p.moved = true
  }
  const onScreenPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = ptrRef.current
    ptrRef.current = null
    if (!realMode || !p) return
    const r = e.currentTarget.getBoundingClientRect()
    const end = mapPointToDevice(e.clientX - r.left, e.clientY - r.top, width, p.sh, p.dw, p.dh)
    const dur = Date.now() - p.t
    if (!p.moved) {
      if (dur >= LONG_PRESS_MS) onGesture?.({ type: 'long_press', x: p.dx, y: p.dy, durationMs: dur })
      else onGesture?.({ type: 'tap', x: p.dx, y: p.dy })
      return
    }
    // Direction from the RAW delta (preserves the user's intent). Then clamp the start/end OFF the
    // iOS system-gesture edges — esp. the bottom home-indicator zone — so an up-swipe begun near the
    // bottom (y≈824 on an 844pt screen) isn't hijacked by iOS and actually scrolls the app. Taps
    // (handled above) are NEVER clamped, so bottom dock/app icons stay tappable.
    const dir = dragDir(end.x - p.dx, end.y - p.dy)
    const safe = clampSwipeSeg({ x1: p.dx, y1: p.dy, x2: end.x, y2: end.y }, p.dw, p.dh)
    onGesture?.({ type: gesture === 'scroll' ? 'scroll' : 'swipe', x1: safe.x1, y1: safe.y1, x2: safe.x2, y2: safe.y2, dir, durationMs: dur })
  }
  const onScreenPointerCancel = () => { ptrRef.current = null }

  // Mock/legacy screen tap (onClick). Real-frame mode is handled by the pointer gestures above.
  const tap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (realMode) return
    if (readOnly) { onLog('warn', 'control denied — view-only access'); return }
    const r = e.currentTarget.getBoundingClientRect()
    const x = Math.round(e.clientX - r.left)
    const y = Math.round(e.clientY - r.top)
    if (!awake) { lock(); return }
    setRipple({ x, y, id: Date.now() })
    onLog('info', `${gesture} (${x}, ${y})`)
    onTap?.(x, y) // parent sends the tap control command (we stay visual-only)
  }

  const activeAppDef = useMemo(
    () => (activeApp ? ALL_APPS.find(a => a.name === activeApp) ?? null : null),
    [activeApp],
  )

  // What the glass shows
  let screen: React.ReactNode
  if (realMode) {
    // REAL device: show the captured frame, or an HONEST status placeholder — never a
    // simulated springboard. The lock/app state is whatever the screenshot shows.
    if (device.status === 'offline') {
      screen = <CenterScreen icon={<Power size={18 * f} className="text-fg-muted" />} label="Powered Off" />
    } else if (device.status === 'error') {
      screen = (
        <div className="flex h-full flex-col items-center justify-center gap-2" style={{ background: 'rgba(255,59,59,0.06)' }}>
          <TriangleAlert size={20 * f} style={{ color: statusColor }} />
          <span className="label" style={{ color: statusColor }}>Agent Unreachable</span>
          <span className="text-fg-muted" style={{ fontSize: 8 * f }}>retrying connection…</span>
        </div>
      )
    } else if (device.status === 'warming') {
      screen = (
        <div className="flex h-full flex-col items-center justify-center" style={{ gap: 14 * f }}>
          <div className="rounded-full border border-fg/30 spin-slow" style={{ width: 30 * f, height: 30 * f, borderTopColor: 'rgba(255,255,255,0.7)' }} />
          <span className="label text-fg-secondary">Booting</span>
          <span className="text-fg-muted" style={{ fontSize: 8 * f }}>{device.osVersion}</span>
        </div>
      )
    } else if (frame) {
      // STAGE 2A: the base64 screenshot is the base layer; the live MJPEG stream (browser-native
      // multipart/x-mixed-replace) overlays it and is only made VISIBLE once it is producing frames
      // (`streamLive`). So a connecting / no-publisher stream shows the SCREENSHOT (never blank) and
      // upgrades to live the instant frames arrive — and onError falls the parent back to screenshots.
      // frame.width/height still drive the glass aspect + tap mapping, so gestures are identical.
      screen = (
        <>
          <img
            src={frame.src}
            alt={`${device.name} live screen`}
            draggable={false}
            className="pointer-events-none absolute inset-0 h-full w-full select-none transition-opacity duration-300"
            style={{ objectFit: 'cover', display: 'block', opacity: streamLive ? 0 : 1 }}
          />
          {streamUrl && (
            <img
              src={streamUrl}
              alt={`${device.name} live stream`}
              draggable={false}
              onLoad={onStreamLoad}
              onError={onStreamError}
              className="pointer-events-none absolute inset-0 h-full w-full select-none transition-opacity duration-300"
              style={{ objectFit: 'cover', display: 'block', opacity: streamLive ? 1 : 0 }}
            />
          )}
        </>
      )
    } else if (resolving) {
      // Online device, latest-frame read still in flight → polished skeleton (same glass dimensions),
      // NOT the resolved "Waiting for frame" — that would be a premature empty state.
      screen = <ScreenSkeleton f={f} />
    } else {
      screen = <CenterScreen icon={<Camera size={18 * f} className="text-fg-muted" />} label="Waiting for frame" sub="Press Screenshot to capture" />
    }
  } else if (!awake) {
    screen = <CenterScreen icon={<LockIcon size={18 * f} className="text-fg-muted" />} label="Locked" sub={clock} />
  } else if (device.status === 'offline') {
    screen = <CenterScreen icon={<Power size={18 * f} className="text-fg-muted" />} label="Powered Off" />
  } else if (device.status === 'error') {
    screen = (
      <div className="flex h-full flex-col items-center justify-center gap-2" style={{ background: 'rgba(255,59,59,0.06)' }}>
        <TriangleAlert size={20 * f} style={{ color: statusColor }} />
        <span className="label" style={{ color: statusColor }}>Agent Unreachable</span>
        <span className="text-fg-muted" style={{ fontSize: 8 * f }}>retrying connection…</span>
      </div>
    )
  } else if (device.status === 'warming') {
    screen = (
      <div className="flex h-full flex-col items-center justify-center" style={{ gap: 14 * f }}>
        <div className="rounded-full border border-fg/30 spin-slow" style={{ width: 30 * f, height: 30 * f, borderTopColor: 'rgba(255,255,255,0.7)' }} />
        <span className="label text-fg-secondary">Booting</span>
        <span className="text-fg-muted" style={{ fontSize: 8 * f }}>{device.osVersion}</span>
      </div>
    )
  } else if (activeAppDef) {
    screen = <AppScreen f={f} clock={clock} battery={device.battery} app={activeAppDef} />
  } else if (device.status === 'busy' && job) {
    screen = <JobScreen f={f} clock={clock} device={device} job={job} />
  } else {
    screen = <Springboard f={f} clock={clock} battery={device.battery} job={job} onLaunch={launchApp} />
  }

  return (
    <div className="relative" style={{ width: width + 14 }}>
      {/* status-colored ambient glow */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 rounded-[40px] transition-shadow duration-700"
        style={{ boxShadow: `0 0 70px ${statusColor}1f, 0 0 140px ${statusColor}0d` }}
      />
      {/* frame */}
      <div
        className="relative"
        style={{
          padding: 6,
          background: 'linear-gradient(150deg, #3a3a40 0%, #17171b 30%, #0b0b0e 65%, #28282d 100%)',
          borderRadius: 34 * f + 6,
          boxShadow: '0 24px 70px rgba(0,0,0,0.75), inset 0 0 0 1px rgba(255,255,255,0.08)',
        }}
      >
        {/* side buttons */}
        <div className="absolute rounded-l bg-[#222227]" style={{ left: -2.5, top: 70 * f, width: 2.5, height: 26 * f }} />
        <div className="absolute rounded-l bg-[#222227]" style={{ left: -2.5, top: 104 * f, width: 2.5, height: 26 * f }} />
        <div className="absolute rounded-r bg-[#222227]" style={{ right: -2.5, top: 86 * f, width: 2.5, height: 42 * f }} />

        {/* glass — a real frame renders CLEAN (no scanline/reflection overlay) so the
            screenshot is bright + pixel-faithful; the mock screen keeps its CRT styling. */}
        <div
          className={`relative select-none overflow-hidden bg-[#050507] ${frame ? '' : 'scanlines'} ${interactive ? 'cursor-pointer' : ''}`}
          // touch-action:none + user-select:none → a drag (esp. VERTICAL) is a pointer gesture, never a
          // text-selection / scroll the browser steals from us (which silently killed up/down swipes on the
          // scrollable page). transformStyle:flat keeps the frame clipped under the stage's 3D tilt.
          style={{ width, height: screenH, borderRadius: 30 * f, touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none', transformStyle: 'flat' }}
          onClick={tap}
          onPointerDown={onScreenPointerDown}
          onPointerMove={onScreenPointerMove}
          onPointerUp={onScreenPointerUp}
          onPointerCancel={onScreenPointerCancel}
          role="button"
          aria-label={`${device.name} screen`}
        >
          {realMode ? (
            // REAL frame: ONE statically-positioned image layer (no crossfade/exit → no previous-frame
            // ghost) inside an overflow-hidden, flattened viewport, so the screenshot is ALWAYS clipped to
            // the glass and never dissociates/offsets outside the shell during a drag.
            <div className="absolute inset-0 overflow-hidden" style={{ borderRadius: 30 * f, transform: 'translateZ(0)', transformStyle: 'flat' }}>
              {screen}
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={`${awake}-${device.status}-${activeApp ?? (device.status === 'busy' && job ? 'job' : 'board')}`}
                className="absolute inset-0"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                {screen}
              </motion.div>
            </AnimatePresence>
          )}

          {/* app switcher overlay (mock only — never over a real device frame) */}
          <AnimatePresence>
            {switcherOpen && interactive && !realMode && (
              <motion.div
                className="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-black/70 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                onClick={(e) => { e.stopPropagation(); setSwitcherOpen(false) }}
              >
                {(recents.length ? recents : ['Safari']).slice(0, 3).map((name, i) => {
                  const app = ALL_APPS.find(a => a.name === name)
                  if (!app) return null
                  return (
                    <motion.button
                      key={name}
                      type="button"
                      initial={{ y: 16, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ delay: i * 0.05, duration: 0.25, ease: EXPO_OUT }}
                      whileHover={{ scale: 1.06 }}
                      onClick={(e) => { e.stopPropagation(); launchApp(name) }}
                      className="flex flex-col items-center overflow-hidden border border-white/15 bg-[#0c0c12]"
                      style={{ width: width * 0.26, height: screenH * 0.4, borderRadius: 10 * f, gap: 6 * f, paddingTop: 12 * f }}
                      tabIndex={-1}
                    >
                      <div
                        className="flex items-center justify-center font-bold"
                        style={{
                          width: 26 * f, height: 26 * f, borderRadius: 7 * f,
                          background: app.bg, color: app.textColor ?? '#fff', fontSize: 9 * f,
                        }}
                      >
                        {app.abbr}
                      </div>
                      <span className="text-white/50" style={{ fontSize: 7 * f }}>{app.name}</span>
                    </motion.button>
                  )
                })}
              </motion.div>
            )}
          </AnimatePresence>

          {/* glass reflection (mock screen only — never tint a real captured frame) */}
          {!frame && (
            <div
              className="pointer-events-none absolute inset-0 z-20"
              style={{
                borderRadius: 30 * f,
                background: 'linear-gradient(118deg, rgba(255,255,255,0.055) 0%, rgba(255,255,255,0.015) 28%, transparent 44%)',
              }}
            />
          )}

          {/* tap ripple */}
          <AnimatePresence>
            {ripple && (
              <motion.span
                key={ripple.id}
                className="pointer-events-none absolute z-30 rounded-full border border-[#4fc3f7]/70"
                style={{ left: ripple.x, top: ripple.y, boxShadow: '0 0 12px rgba(79,195,247,0.35)' }}
                initial={{ width: 0, height: 0, x: 0, y: 0, opacity: 0.9 }}
                animate={{ width: 48, height: 48, x: -24, y: -24, opacity: 0 }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                onAnimationComplete={() => setRipple(null)}
              />
            )}
          </AnimatePresence>

          {/* directional swipe trail — mock/no-frame only (never an animated overlay over a real frame) */}
          {!realMode && (
          <AnimatePresence>
            {swipeViz && (() => {
              const dist = Math.min(width, screenH) * 0.34
              const vec = {
                up:    { x: 0, y: -dist }, down: { x: 0, y: dist },
                left:  { x: -dist, y: 0 }, right: { x: dist, y: 0 },
              }[swipeViz.dir]
              return (
                <motion.span
                  key={swipeViz.id}
                  className="pointer-events-none absolute left-1/2 top-1/2 z-30 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{ background: 'rgba(79,195,247,0.9)', boxShadow: '0 0 14px 3px rgba(79,195,247,0.45)' }}
                  initial={{ x: -vec.x * 0.5, y: -vec.y * 0.5, opacity: 0, scale: 0.6 }}
                  animate={{ x: vec.x * 0.5, y: vec.y * 0.5, opacity: [0, 1, 1, 0], scale: 1 }}
                  transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
                  onAnimationComplete={() => setSwipeViz(null)}
                />
              )
            })()}
          </AnimatePresence>
          )}

          {/* screenshot flash */}
          <AnimatePresence>
            {flash && (
              <motion.div
                className="pointer-events-none absolute inset-0 z-40 bg-white"
                initial={{ opacity: 0.9 }}
                animate={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              />
            )}
          </AnimatePresence>

          {/* home indicator — interactive in mock; in REAL mode it's DECORATIVE + pointer-events-none so it
              never swallows a bottom-origin swipe (an upward swipe starts here). home() is a no-op in real
              mode anyway — the page's Home quick-control drives the real device. */}
          {interactive && (realMode ? (
            <div className="pointer-events-none absolute bottom-0 left-1/2 z-30 -translate-x-1/2 px-4 py-1.5">
              <div className="rounded-full bg-white/30" style={{ width: 84 * f, height: 4 }} />
            </div>
          ) : (
            <button
              type="button"
              aria-label="Home"
              onClick={(e) => { e.stopPropagation(); home() }}
              onPointerDown={(e) => e.stopPropagation()}
              className="absolute bottom-0 left-1/2 z-30 -translate-x-1/2 px-4 py-1.5"
              tabIndex={-1}
            >
              <div className="rounded-full bg-white/30 transition-colors hover:bg-white/60" style={{ width: 84 * f, height: 4 }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
})

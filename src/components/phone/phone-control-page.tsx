import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, useMotionValue, useSpring, useReducedMotion } from 'framer-motion'
import {
  ChevronLeft, ChevronRight, AlertTriangle,
  Lock, Home, CornerDownLeft, Grid2x2,
  Camera, RefreshCw, Power,
  Send, Copy, X, Rocket, FileText,
  Video, Zap, Shield, BatteryMedium, Gauge, Anchor, Radio,
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Crosshair,
} from 'lucide-react'
import type { AppDef } from '@/components/phone/app-catalog'
import { LivePhone, type LivePhoneHandle, type LiveFrame, type PhoneGesture } from '@/components/phone/live-phone'
import type { LogLevel } from '@/hooks/use-device-log'
import { useFleet } from '@/hooks/use-fleet'
import { STATUS } from '@/lib/status'
import { useUIStore } from '@/state/ui-store'
import { useSettings } from '@/state/settings-store'
import { useActingEmployee, useScopedDevices } from '@/lib/authorization/use-access'
import { canActOnPhone, can } from '@/lib/authorization'
import { AccessDenied } from '@/components/access/Can'
import { logAudit } from '@/services/audit'
import { client } from '@/lib/provider'
import { AUTH_SOURCE } from '@/auth/auth-source'
import { isSupabaseConfigured } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useTeamContext } from '@/contexts/TeamContext'
import { controlCommandToWire } from '@/shared/control-command'
import { enqueueCommand, watchCommand, getLatestScreenshot, subscribeDeviceScreenshots, type DeviceScreenshot } from '@/services/device-commands'
import type { AgentCommandAction } from '@/shared/types'
import type { ControlCommand, DeviceSessionRecord } from '@/shared/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 9) }
// Module-scope so the impure clock read is never analyzed as a render-phase call
// (mirrors uid()); these timings are only taken at event time (enqueue / ack).
function nowMs() { return Date.now() }
// Client-driven GO LIVE pacing (conservative — ~1 frame / 1.5s, well under any Supabase limit).
// The capture loop enqueues AT MOST one screenshot command per LIVE_CAPTURE_INTERVAL_MS (sequential,
// never overlapping); the display refreshes from the latest frame every LIVE_POLL_INTERVAL_MS as a
// fallback for when Realtime is delayed/unavailable.
const LIVE_CAPTURE_INTERVAL_MS = 1500
const LIVE_POLL_INTERVAL_MS = 1200
// Hard floor between screenshot enqueues — bounds the capture rate even if the capture-loop effect
// re-runs (e.g. a transient device online↔busy status flip) and calls captureOnce back-to-back.
const LIVE_MIN_CAPTURE_GAP_MS = 1200
function fmt(d: Date) {
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

interface LogEntry {
  id: string; ts: Date; type: 'command'|'gesture'|'screenshot'|'error'|'system'; text: string
}

// ─── App icon definitions ─────────────────────────────────────────────────────
const INSTALLED_APPS: AppDef[] = [
  { name: 'Instagram', abbr: 'In', bg: 'linear-gradient(135deg,#833ab4,#fd1d1d,#fcb045)' },
  { name: 'TikTok',    abbr: 'Ti', bg: '#000', border: '#ff0050' },
  { name: 'Telegram',  abbr: 'Te', bg: '#2aabee' },
  { name: 'WhatsApp',  abbr: 'Wh', bg: '#25d366' },
  { name: 'Facebook',  abbr: 'Fb', bg: '#1877f2' },
  { name: 'Safari',    abbr: 'Sa', bg: '#0a84ff' },
  { name: 'Settings',  abbr: 'Se', bg: '#636366' },
  { name: 'Photos',    abbr: 'Ph', bg: 'linear-gradient(135deg,#ff9500,#ff2d55,#af52de)' },
]

// ─── Slider component ─────────────────────────────────────────────────────────
function TealSlider({ value, min, max, onChange }: {
  value: number; min: number; max: number; onChange: (v: number) => void
}) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="relative mt-2">
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full appearance-none h-1 rounded-full outline-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, #2dd4bf 0%, #2dd4bf ${pct}%, rgba(255,255,255,0.12) ${pct}%, rgba(255,255,255,0.12) 100%)`,
        }}
      />
      <style>{`
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 14px; height: 14px;
          border-radius: 50%;
          background: #2dd4bf;
          cursor: pointer;
          box-shadow: 0 0 6px rgba(45,212,191,0.6);
        }
        input[type=range]::-moz-range-thumb {
          width: 14px; height: 14px;
          border-radius: 50%;
          background: #2dd4bf;
          border: none;
          cursor: pointer;
        }
      `}</style>
    </div>
  )
}

// ─── D-pad button ─────────────────────────────────────────────────────────────
function DPadButton({ icon, label, onClick, className = '', center, disabled }: {
  icon: React.ReactNode; label: string; onClick: () => void; className?: string; center?: boolean; disabled?: boolean
}) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={disabled ? 'Control permission required' : label}
      whileTap={disabled ? undefined : { scale: 0.9 }}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-10 w-10 items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${className}`}
      style={
        center
          ? { background: 'rgba(45,212,191,0.12)', borderColor: 'rgba(45,212,191,0.4)', color: '#7ce8da' }
          : { background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }
      }
      onMouseEnter={(e) => {
        if (center || disabled) return
        const el = e.currentTarget
        el.style.background = 'rgba(255,255,255,0.08)'
        el.style.borderColor = 'rgba(255,255,255,0.25)'
        el.style.color = '#fff'
      }}
      onMouseLeave={(e) => {
        if (center) return
        const el = e.currentTarget
        el.style.background = 'rgba(255,255,255,0.04)'
        el.style.borderColor = 'rgba(255,255,255,0.1)'
        el.style.color = 'rgba(255,255,255,0.7)'
      }}
    >
      {icon}
    </motion.button>
  )
}

// ─── Card wrapper ─────────────────────────────────────────────────────────────
function Card({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-white/[0.08] bg-[#111318] ${className}`}>
      {title && (
        <div className="px-4 py-3 border-b border-white/[0.06]">
          <span className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.45)' }}>{title}</span>
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  )
}

// ─── Phone stage — soft glow + cursor-reactive perspective tilt ───────────────
// `stabilized` stops all decorative body motion and smoothly returns the phone
// to neutral. Screen gestures are untouched — only the stage transform changes.
function PhoneStage({ statusColor, stabilized, children }: {
  statusColor: string; stabilized: boolean; children: React.ReactNode
}) {
  const reduced = useReducedMotion()
  const frozen = stabilized || reduced
  const rx = useMotionValue(0)
  const ry = useMotionValue(0)
  const srx = useSpring(rx, { stiffness: 120, damping: 18 })
  const sry = useSpring(ry, { stiffness: 120, damping: 18 })

  useEffect(() => {
    if (frozen) { rx.set(0); ry.set(0) }
  }, [frozen, rx, ry])

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (frozen) return
    const r = e.currentTarget.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width - 0.5
    const py = (e.clientY - r.top) / r.height - 0.5
    ry.set(px * 7)
    rx.set(-py * 5)
  }
  const onLeave = () => { rx.set(0); ry.set(0) }

  return (
    <div className="relative" style={{ perspective: 1100 }} onPointerMove={onMove} onPointerLeave={onLeave}>
      {/* centered ambient glow behind the device */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-[-80px] -z-10 transition-colors duration-700"
        style={{ background: `radial-gradient(ellipse 60% 50% at 50% 45%, ${statusColor}14, transparent 70%)` }}
      />
      <motion.div style={{ rotateX: srx, rotateY: sry, transformStyle: 'preserve-3d' }}>
        {children}
      </motion.div>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────
export function PhoneControlPage() {
  const { jobs } = useFleet()
  const devices = useScopedDevices()
  const { employee, member } = useActingEmployee()
  const { user } = useAuth()
  const teamCtx = useTeamContext()
  // supabase-mode (production): commands go through Supabase RLS, not /v1/agent/command.
  const useSupabaseCommands = AUTH_SOURCE === 'supabase' && isSupabaseConfigured
  const phoneControlDeviceId = useUIStore(s => s.phoneControlDeviceId)
  const closePhoneControl    = useUIStore(s => s.closePhoneControl)

  // Device navigation
  const initialIndex = Math.max(0, devices.findIndex(d => d.id === phoneControlDeviceId))
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const device = devices[currentIndex] ?? devices[0] ?? null
  const job = device?.jobId ? jobs.find(j => j.id === device.jobId) ?? null : null

  // ── Authorization (permission + per-phone scope) ──────────────────────────
  const canView       = can(member, 'phones.view')
  const canControl    = device ? canActOnPhone(member, 'phones.control', device) : false
  const canReboot     = device ? canActOnPhone(member, 'phones.reboot', device) : false
  const canScreenshot = device ? canActOnPhone(member, 'phones.screenshot', device) : false
  const readOnly      = !canControl

  // UI state — stream defaults come from workspace settings
  const defaultQuality = useSettings(s => s.defaultStreamQuality)
  const defaultFps     = useSettings(s => s.defaultStreamFps)
  const confirmDestructive = useSettings(s => s.confirmDestructive)
  const stabilizePhone = useSettings(s => s.stabilizePhone)
  const updateSettings = useSettings(s => s.update)
  // Live (supabase-mode) phone control defaults to STABILIZED — most accurate tap/drag coords — regardless
  // of the persisted global setting; the header button toggles it (two-way) for this session. Non-supabase
  // (demo/mock) keeps the global `stabilizePhone` workspace setting (also editable in Settings).
  const [liveStabilized, setLiveStabilized] = useState(true)
  const stabilized = useSupabaseCommands ? liveStabilized : stabilizePhone
  const [quality, setQuality]       = useState(defaultQuality)
  const [fps, setFps]               = useState(defaultFps)
  const [confirmingReboot, setConfirmingReboot] = useState(false)
  const [gesture, setGesture]       = useState('tap')
  const [sendText, setSendText]     = useState('')
  const [notes, setNotes]           = useState('')
  const [activeTab, setActiveTab]   = useState<'apps'|'automations'|'sessions'|'logs'>('apps')
  const [logs, setLogs]             = useState<LogEntry[]>([])
  const [sessions, setSessions]     = useState<DeviceSessionRecord[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [sessionsError, setSessionsError]     = useState<string | null>(null)
  // In-flight command guard (double-send prevention for discrete actions). State
  // (not a ref) so disabled buttons re-render and reading it during render is safe.
  const [inFlight, setInFlight] = useState<Set<string>>(() => new Set())

  // Live telemetry
  const [latency, setLatency] = useState(41)
  const [liveFps, setLiveFps] = useState(18)
  const logRef = useRef<HTMLDivElement>(null)
  const phoneRef = useRef<LivePhoneHandle>(null)

  // Real device screen (supabase-mode): the latest REAL captured frame + a measured
  // refresh round-trip + opt-in auto-refresh ("Live"). `frame === null` → no frame yet
  // (honest placeholder); we pass `undefined` to LivePhone outside supabase-mode so the
  // legacy simulated screen is unchanged (mock/demo/me-mode + device-drawer).
  const [frame, setFrame] = useState<LiveFrame | null>(null)
  const [frameLatency, setFrameLatency] = useState<number | null>(null)
  const [liveView, setLiveView] = useState(false)
  const deviceIdRef = useRef<string | undefined>(undefined)
  // Live command-status watchers (watchCommand cancels). Tracked so they can be torn
  // down on device-switch/unmount — otherwise an orphaned poller would keep writing a
  // previous device's lifecycle logs/latency into the current view (and keep polling).
  const watchersRef = useRef<Set<() => void>>(new Set())
  // GO LIVE in-flight guard: only ONE screenshot capture is ever in flight, even if the capture-loop
  // effect re-runs (e.g. a device online↔busy status flip) mid-capture. `liveCaptureFinishRef` lets the
  // effect cleanup STOP the in-flight capture (cancel its watcher) the instant GO LIVE ends.
  const captureBusyRef = useRef(false)
  const lastCaptureAtRef = useRef(0)
  const liveCaptureFinishRef = useRef<() => void>(() => {})
  // Last time a Realtime frame arrived — lets the fallback poll skip a tick when Realtime is healthy.
  const lastRealtimeFrameRef = useRef(0)
  // Debounce timer for the post-command "refresh the screen" follow-up capture (coalesces rapid gestures).
  const frameRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // A forced post-command refresh that was dropped because a capture was already in flight — re-fired
  // ONCE when that capture finishes, so the displayed frame can't get stuck one step behind the device.
  const pendingRefreshRef = useRef(false)
  // Latest scheduleFrameRefresh + liveView, read from inside captureOnce's finish() (which closes over
  // neither): the trailing re-fire only runs with GO LIVE off (when on, the loop already keeps it fresh).
  // Kept current via a post-commit effect (below) so the values are always the committed ones.
  const scheduleFrameRefreshRef = useRef<() => void>(() => {})
  const liveViewRef = useRef(liveView)

  const addLog = useCallback((text: string, type: LogEntry['type'] = 'command') => {
    setLogs(l => [...l, { id: uid(), ts: new Date(), type, text }].slice(-500))
  }, [])

  // Adapter: LivePhone emits LogLevel, the page log uses its own categories.
  const phoneLog = useCallback((level: LogLevel, text: string) => {
    const type: LogEntry['type'] =
      level === 'error' ? 'error' : level === 'ok' ? 'screenshot' : level === 'warn' ? 'gesture' : 'command'
    addLog(text, type)
  }, [addLog])

  useEffect(() => {
    // supabase-mode surfaces REAL refresh metrics (frameLatency/frame), so the simulated
    // latency/FPS jitter only runs in mock/demo/me-mode — never presented as real telemetry.
    if (useSupabaseCommands) return
    const id1 = setInterval(() => setLatency(v => Math.min(80, Math.max(20, v + (Math.random() - 0.5) * 14))), 1200)
    const id2 = setInterval(() => setLiveFps(v => Math.min(32, Math.max(15, v + (Math.random() - 0.5) * 3 | 0))), 2000)
    return () => { clearInterval(id1); clearInterval(id2) }
  }, [useSupabaseCommands])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs, activeTab])

  const deviceId = device?.id
  // Real command-log stream: subscribe to THIS device's logs over the provider's
  // existing socket (server `command_log` broadcast / mock echo). Clears and
  // resubscribes on device change; unsubscribes on unmount. No mock logs.
  useEffect(() => {
    if (!deviceId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLogs([])
    // supabase-mode: skip the me-mode Railway log socket; the supabase command lifecycle
    // (enqueue → watchCommand) populates this log instead.
    if (useSupabaseCommands) return
    const unsub = client.subscribeDeviceLogs(deviceId, (entry) => {
      const next: LogEntry = {
        id: uid(),
        ts: new Date(entry.ts),
        type: entry.success === false ? 'error' : entry.commandType === 'screenshot' ? 'screenshot' : 'command',
        text: entry.text,
      }
      setLogs(l => [...l, next].slice(-500))
    })
    return unsub
  }, [deviceId, useSupabaseCommands])

  // Real session history (GET /v1/devices/:id/sessions). Empty for the simulated
  // provider — no mock fallback; never crashes the page on error.
  useEffect(() => {
    if (!deviceId) return
    // supabase-mode: do NOT call the me-mode Railway endpoint (GET /v1/devices/:id/sessions) —
    // it 401s with a Supabase JWT. Show a truthful "hardware control pending" state instead.
    if (useSupabaseCommands) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSessions([]); setSessionsError(null); setSessionsLoading(false)
      return
    }
    let cancelled = false
    setSessionsLoading(true); setSessionsError(null); setSessions([])
    client.listDeviceSessions(deviceId)
      .then(s => { if (!cancelled) setSessions(s) })
      .catch(() => { if (!cancelled) setSessionsError('Could not load sessions for this device.') })
      .finally(() => { if (!cancelled) setSessionsLoading(false) })
    return () => { cancelled = true }
  }, [deviceId, useSupabaseCommands])

  // ── Real device screen (supabase-mode): the captured frame travels device_screenshots ──
  // Cancel every tracked command watcher (on device-switch / unmount).
  const cancelAllWatchers = useCallback(() => {
    for (const cancel of watchersRef.current) cancel()
    watchersRef.current.clear()
  }, [])

  // Loads a data: URL from the latest REAL frame the agent uploaded for this device, and records
  // the read round-trip as the truthful REFRESH metric (a real network read, not a fabricated ping).
  const refreshFrame = useCallback(async (id: string) => {
    const t0 = nowMs()
    try {
      const s = await getLatestScreenshot(id)
      if (id !== deviceIdRef.current) return // device switched mid-request
      if (!s) return // no frame captured yet — keep the placeholder
      const ts = Date.parse(s.capturedAt)
      // Allow-list the MIME at the sink too (defense in depth): never interpolate an
      // untrusted value into the data: URL even if the DB row somehow carried one.
      const fmt = s.format === 'jpeg' || s.format === 'webp' ? s.format : 'png'
      setFrame({
        src: `data:image/${fmt};base64,${s.imageBase64}`,
        capturedAt: Number.isFinite(ts) ? ts : nowMs(),
        width: s.width,
        height: s.height,
      })
      setFrameLatency(nowMs() - t0)
    } catch { /* keep the prior frame; never crash the page */ }
  }, [])

  // One live capture: enqueue ONE real screenshot command and, on its ACK, read+display the captured
  // frame (works whether or not GO LIVE is on). The shared `captureBusyRef` guard makes this strictly
  // SEQUENTIAL — there is NEVER more than one screenshot in flight. `force` bypasses the min-gap for a
  // deliberate post-command refresh (the min-gap only paces the continuous GO LIVE loop) but still
  // respects the busy guard. `liveCaptureFinishRef` exposes finish() so the loop's cleanup can stop this
  // capture the instant GO LIVE ends.
  const captureOnce = useCallback((force = false) => new Promise<void>((resolve) => {
    const teamId = teamCtx.team?.id, userId = user?.id, id = deviceIdRef.current
    const now = nowMs()
    if (!teamId || !userId || !id) { resolve(); return }
    // Strictly one capture in flight. A FORCED (post-command) refresh that loses to an in-flight capture
    // is remembered so finish() re-fires it ONCE — otherwise the last gesture's frame is never read and
    // the screen sticks one step behind. The min-gap only paces the continuous GO LIVE loop (force skips it).
    if (captureBusyRef.current) { if (force) pendingRefreshRef.current = true; resolve(); return }
    if (!force && now - lastCaptureAtRef.current < LIVE_MIN_CAPTURE_GAP_MS) { resolve(); return }
    captureBusyRef.current = true
    lastCaptureAtRef.current = now
    let settled = false
    let cancel: () => void = () => {}
    let safety: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      if (settled) return
      settled = true
      captureBusyRef.current = false
      liveCaptureFinishRef.current = () => {}
      if (safety) clearTimeout(safety) // don't leave the 13s fallback ticking after an early finish
      cancel(); watchersRef.current.delete(cancel)
      resolve()
      // Trailing-edge: a gesture that arrived while this capture ran needs the device's FINAL frame. Only
      // with GO LIVE off — when on, the loop + Realtime already keep the screen fresh (no timer ping-pong).
      if (pendingRefreshRef.current && !liveViewRef.current) { pendingRefreshRef.current = false; scheduleFrameRefreshRef.current() }
    }
    liveCaptureFinishRef.current = finish
    enqueueCommand({ teamId, deviceId: id, action: 'screenshot', userId })
      .then(({ id: cmdId }) => {
        if (settled) return // stopped (GO LIVE off / device change) before the row landed
        cancel = watchCommand(cmdId, (status) => {
          if (id !== deviceIdRef.current) { finish(); return } // device switched — stop + drop
          if (status === 'acked') void refreshFrame(id) // read + display the freshly-captured frame
          if (status === 'acked' || status === 'failed' || status === 'expired') finish()
        }, { intervalMs: 1000, timeoutMs: 12000 })
        watchersRef.current.add(cancel)
        safety = setTimeout(finish, 13000) // resolve even if the watch never sees a terminal status
      })
      .catch(() => finish())
  }), [teamCtx.team?.id, user?.id, refreshFrame])

  // After a state-changing command, capture ONE fresh frame so the UI reflects the device's new screen.
  // Debounced → a rapid gesture burst coalesces into a SINGLE follow-up capture (no storm); forced → the
  // min-gap can't drop it; the busy guard still prevents overlap. With GO LIVE off this is the ONLY thing
  // that refreshes the screen after a command; with GO LIVE on it just makes the post-gesture update snappier.
  const scheduleFrameRefresh = useCallback(() => {
    if (frameRefreshTimerRef.current) clearTimeout(frameRefreshTimerRef.current)
    frameRefreshTimerRef.current = setTimeout(() => { frameRefreshTimerRef.current = null; void captureOnce(true) }, 350)
  }, [captureOnce])

  // Keep the refs captureOnce's finish() reads (it closes over neither) pointed at the latest COMMITTED
  // scheduleFrameRefresh + liveView, so a trailing post-command refresh re-fires correctly and only when off.
  useEffect(() => { scheduleFrameRefreshRef.current = scheduleFrameRefresh; liveViewRef.current = liveView })

  // Reset + load the latest existing frame when the device changes (no new capture).
  useEffect(() => {
    cancelAllWatchers() // tear down the previous device's in-flight command watchers
    pendingRefreshRef.current = false // drop a queued trailing refresh BEFORE releasing the capture (no re-fire for the old device)
    liveCaptureFinishRef.current() // release any in-flight forced/gesture capture, else captureBusyRef stays stuck → new device's captures all drop
    if (frameRefreshTimerRef.current) { clearTimeout(frameRefreshTimerRef.current); frameRefreshTimerRef.current = null } // drop a pending refresh for the old device
    deviceIdRef.current = deviceId
    if (!useSupabaseCommands || !deviceId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFrame(null); setFrameLatency(null)
    void refreshFrame(deviceId)
  }, [deviceId, useSupabaseCommands, refreshFrame, cancelAllWatchers])

  // Stop every in-flight watcher when the page unmounts (no detached polling / state writes). Null the
  // device ref so any in-flight refreshFrame short-circuits (no setState after unmount).
  useEffect(() => () => { cancelAllWatchers(); pendingRefreshRef.current = false; liveCaptureFinishRef.current(); deviceIdRef.current = undefined; if (frameRefreshTimerRef.current) clearTimeout(frameRefreshTimerRef.current) }, [cancelAllWatchers])

  // GO LIVE — capture loop: client-driven, strictly SEQUENTIAL. Enqueue one screenshot, await its
  // terminal state, then pace to ~LIVE_CAPTURE_INTERVAL_MS before the next. Never overlapping; never
  // hammers Supabase. Stops the instant GO LIVE is off / device changes / device offline / unmount.
  useEffect(() => {
    const online = device?.status === 'online' || device?.status === 'busy'
    if (!liveView || !useSupabaseCommands || !canScreenshot || !deviceId || !online) return
    let active = true
    const run = async () => {
      while (active) {
        const t0 = nowMs()
        await captureOnce()
        if (!active) break
        await new Promise<void>((r) => setTimeout(r, Math.max(300, LIVE_CAPTURE_INTERVAL_MS - (nowMs() - t0))))
      }
    }
    void run()
    // Cleanup STOPS immediately: break the loop AND finish the in-flight capture (cancel its watcher),
    // so nothing keeps polling / writes a frame after GO LIVE off / device change / offline / unmount.
    return () => { active = false; liveCaptureFinishRef.current() }
  }, [liveView, useSupabaseCommands, canScreenshot, deviceId, device?.status, captureOnce])

  // GO LIVE — display refresh: show the latest frame as soon as the agent uploads it. Supabase
  // Realtime (instant) on device_screenshots PLUS a fallback poll every LIVE_POLL_INTERVAL_MS that
  // SKIPS a tick whenever Realtime delivered a frame recently (no redundant full-image read when the
  // websocket is healthy; the poll carries the load only when Realtime is delayed/unavailable). Only
  // runs while GO LIVE — no constant frame reads when off.
  useEffect(() => {
    const online = device?.status === 'online' || device?.status === 'busy'
    if (!liveView || !useSupabaseCommands || !deviceId || !online) return
    const apply = (sc: DeviceScreenshot) => {
      if (deviceIdRef.current !== deviceId) return
      lastRealtimeFrameRef.current = nowMs()
      const ts = Date.parse(sc.capturedAt)
      const fmt = sc.format === 'jpeg' || sc.format === 'webp' ? sc.format : 'png'
      setFrame({ src: `data:image/${fmt};base64,${sc.imageBase64}`, capturedAt: Number.isFinite(ts) ? ts : nowMs(), width: sc.width, height: sc.height })
    }
    const unsub = subscribeDeviceScreenshots(deviceId, apply)
    const poll = setInterval(() => {
      if (nowMs() - lastRealtimeFrameRef.current < LIVE_POLL_INTERVAL_MS) return // Realtime is fresh — skip the read
      void refreshFrame(deviceId)
    }, LIVE_POLL_INTERVAL_MS)
    return () => { unsub(); clearInterval(poll) }
  }, [liveView, useSupabaseCommands, deviceId, device?.status, refreshFrame])

  // If the device becomes unreachable while GO LIVE, turn GO LIVE OFF so the STREAM badge is truthful
  // (the loops already stop via their `online` guard; this keeps liveView state in sync, not 'Live').
  useEffect(() => {
    const st = device?.status
    if (liveView && st && st !== 'online' && st !== 'busy') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLiveView(false)
    }
  }, [liveView, device?.status])

  if (!canView) return (
    <AccessDenied
      onBack={closePhoneControl}
      message="You do not have permission to view or control phones in this workspace."
    />
  )

  if (!device) return (
    <div className="flex h-full items-center justify-center bg-[#0a0b0e]">
      <span className="mono text-[11px] text-white/20 uppercase tracking-widest">NO DEVICE IN YOUR SCOPE</span>
    </div>
  )

  const GESTURES = ['Tap','Precise Tap','Double Tap','Long Press','Swipe','Scroll','Pinch / Rotate']
  const latColor = latency < 50 ? '#4ade80' : latency < 70 ? '#fbbf24' : '#f87171'
  // supabase-mode: the REAL screenshot round-trip (capture → ack), seconds-scale not a ping.
  const refreshColor = frameLatency == null ? '#6b7280' : frameLatency < 2500 ? '#4ade80' : frameLatency < 6000 ? '#fbbf24' : '#f87171'
  const meta = STATUS[device.status]

  const quickControls = [
    { key: 'lock',       label: 'Lock',       icon: <Lock size={18} /> },
    { key: 'home',       label: 'Home',       icon: <Home size={18} /> },
    { key: 'back',       label: 'Back',       icon: <CornerDownLeft size={18} /> },
    { key: 'switcher',   label: 'Switcher',   icon: <Grid2x2 size={18} /> },
    { key: 'screenshot', label: 'Screenshot', icon: <Camera size={18} /> },
    { key: 'restart',    label: 'Restart',    icon: <RefreshCw size={18} /> },
    { key: 'reboot',     label: 'Reboot',     icon: <Power size={18} />, danger: true },
  ]

  // Stream-local lifecycle (for actions with no agent counterpart, e.g. restart stream).
  const dispatchCommand = (label: string, ack: string) => {
    addLog(`→ ${label} dispatched`)
    setTimeout(() => addLog(`✓ ${ack}`, 'screenshot'), 450)
  }

  // In-flight guard: ignore a repeat of the SAME keyed action while one is still
  // pending, and disable that control meanwhile. Gesture taps/swipes pass no key
  // (each is a distinct event). The ref is authoritative; bumpInFlight re-renders.
  const isBusy = (key: string) => inFlight.has(key)
  const guard = (key: string | undefined, run: () => Promise<unknown>) => {
    if (key && inFlight.has(key)) return // already pending — ignore the duplicate
    if (key) setInFlight(prev => (prev.has(key) ? prev : new Set(prev).add(key)))
    void run().finally(() => {
      if (key) setInFlight(prev => {
        if (!prev.has(key)) return prev
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    })
  }

  // Send a strict, typed control command through the SAME durable queue
  // (POST /v1/agent/command via the provider). The on-screen LivePhone animation
  // fires separately for instant feedback; the authoritative log entry arrives
  // over the device-log subscription (server/mock `command_log`), so we surface
  // only FAILURES here — never a fake "executed" success.
  // supabase-mode: enqueue through Supabase (RLS) + report the REAL lifecycle (queued →
  // running → done/failed) via watchCommand. No fake success; a queue failure is surfaced too.
  const enqueueSupabase = async (wire: { deviceId: string; action: AgentCommandAction; payload?: Record<string, unknown> }, label: string) => {
    const teamId = teamCtx.team?.id, userId = user?.id
    if (!teamId || !userId) { addLog(`✗ ${label} failed: no active workspace`, 'error'); return }
    try {
      const { id } = await enqueueCommand({ teamId, deviceId: wire.deviceId, action: wire.action, payload: wire.payload, userId })
      if (wire.deviceId !== deviceIdRef.current) return // device switched before the row landed
      addLog(`⏳ ${label} — queued`, 'command')
      let cancel: () => void = () => {}
      const stop = () => { cancel(); watchersRef.current.delete(cancel) }
      cancel = watchCommand(id, (status, error) => {
        // Drop a lingering watcher whose device is no longer in view — never let a
        // previous device's lifecycle lines/latency land in the current view.
        if (wire.deviceId !== deviceIdRef.current) { stop(); return }
        if (status === 'running') addLog(`▶ ${label} — running`, 'command')
        else if (status === 'acked') {
          addLog(`✓ ${label} — done`, 'command')
          // Reflect the device's new screen: a screenshot reads its own uploaded frame; any OTHER
          // state-changing command (tap/swipe/home/back/switcher/launch/type/lock/unlock) schedules ONE
          // debounced follow-up capture so the browser updates within ~1–2s. reboot/install are skipped.
          if (wire.action === 'screenshot') void refreshFrame(wire.deviceId)
          else if (wire.action !== 'reboot' && wire.action !== 'install') scheduleFrameRefresh()
        }
        else if (status === 'failed') addLog(`✗ ${label} — failed${error ? ': ' + error : ''}`, 'error')
        if (status === 'acked' || status === 'failed' || status === 'expired') stop()
      })
      watchersRef.current.add(cancel)
      setTimeout(stop, 31000) // deregister even if the watch times out (30s) without a terminal status
    } catch (e) {
      addLog(`✗ ${label} failed: ${e instanceof Error ? e.message : 'error'}`, 'error')
    }
  }

  const sendControl = (command: ControlCommand, gateKey?: string, label?: string) =>
    guard(gateKey, async () => {
      if (useSupabaseCommands) { await enqueueSupabase(controlCommandToWire(command), label ?? command.type); return }
      await client.sendControlCommand(command).catch((e) =>
        addLog(`✗ ${label ?? command.type} failed: ${e instanceof Error ? e.message : 'error'}`, 'error'))
    })

  // Reboot has no ControlCommand counterpart — it stays on the generic queue call.
  const sendReboot = () =>
    guard('reboot', async () => {
      if (useSupabaseCommands) { await enqueueSupabase({ deviceId: device.id, action: 'reboot' }, 'Device reboot'); return }
      await client.sendCommand(device.id, { action: 'reboot' }).catch((e) =>
        addLog(`✗ Device reboot failed: ${e instanceof Error ? e.message : 'error'}`, 'error'))
    })

  const launchAppCmd = (name: string) => {
    if (!canControl) { denyAction('phone control'); return }
    phoneRef.current?.launchApp(name) // visual
    sendControl({ type: 'launch_app', deviceId: device.id, appName: name }, `launch:${name}`, `Launch ${name}`)
  }

  const denyAction = (need: string) => {
    addLog(`✗ Action blocked — requires ${need} permission`, 'error')
    logAudit({ actor: employee.name, action: 'phone.command', target: device.name, detail: `denied: ${need}`, result: 'denied' })
  }

  const runQuick = (key: string) => {
    const p = phoneRef.current
    switch (key) {
      case 'lock':
        if (!canControl) { denyAction('phone control'); return }
        p?.lock(); sendControl({ type: 'key', deviceId: device.id, key: 'lock' }, 'lock', 'Lock')
        break
      case 'home':
        if (!canControl) { denyAction('phone control'); return }
        p?.home(); sendControl({ type: 'key', deviceId: device.id, key: 'home' }, 'home', 'Home')
        break
      case 'back':
        if (!canControl) { denyAction('phone control'); return }
        p?.back(); sendControl({ type: 'key', deviceId: device.id, key: 'back' }, 'back', 'Back')
        break
      case 'switcher':
        if (!canControl) { denyAction('phone control'); return }
        p?.switcher(); sendControl({ type: 'key', deviceId: device.id, key: 'switcher' }, 'switcher', 'App switcher')
        break
      case 'restart':
        // Stream-local only — no agent counterpart.
        if (!canControl) { denyAction('phone control'); return }
        dispatchCommand('Restart stream', 'Stream re-established')
        break
      case 'screenshot':
        if (!canScreenshot) { denyAction('screenshot'); return }
        p?.screenshot(); sendControl({ type: 'screenshot', deviceId: device.id }, 'screenshot', 'Screenshot')
        break
      case 'reboot':
        if (!canReboot) { denyAction('reboot'); return }
        if (confirmDestructive && !confirmingReboot) {
          setConfirmingReboot(true)
          setTimeout(() => setConfirmingReboot(false), 3000)
          return
        }
        setConfirmingReboot(false)
        sendReboot()
        logAudit({ actor: employee.name, action: 'phone.rebooted', target: device.name, result: 'success' })
        break
    }
  }

  // Body-level handler so the JSX array below never reads phoneRef during render.
  const captureScreenshot = () => {
    if (!canScreenshot) { denyAction('screenshot'); return }
    phoneRef.current?.screenshot()
    sendControl({ type: 'screenshot', deviceId: device.id }, 'screenshot', 'Screenshot')
  }

  // Real-screen pointer gestures → real control commands. Truthful lifecycle (queued→running→
  // done/failed via watchCommand); no fake success. Swipe/scroll use the existing agent 'swipe'
  // action (directional) and carry the start/end LOGICAL coordinates; long-press has no agent
  // action yet → truthful log, no command sent.
  const handleGesture = (g: PhoneGesture) => {
    switch (g.type) {
      case 'tap':
        sendControl({ type: 'tap', deviceId: device.id, x: g.x, y: g.y }, undefined, `Tap (${g.x}, ${g.y})`)
        break
      case 'swipe':
        sendControl({ type: 'swipe', deviceId: device.id, dir: g.dir, x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, durationMs: g.durationMs }, undefined, `Swipe ${g.dir} (${g.x1},${g.y1} → ${g.x2},${g.y2})`)
        break
      case 'scroll':
        sendControl({ type: 'swipe', deviceId: device.id, dir: g.dir, x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, durationMs: g.durationMs, scroll: true }, undefined, `Scroll ${g.dir} (${g.x1},${g.y1} → ${g.x2},${g.y2})`)
        break
      case 'long_press':
        addLog(`Long-press (${g.durationMs}ms) at ${g.x}, ${g.y} — device agent has no long-press action yet; not sent`, 'gesture')
        break
    }
  }

  const avatarLetters = device.name.slice(0, 2).toUpperCase()

  return (
    <div className="flex flex-col h-full bg-[#0a0b0e] overflow-hidden">

      {/* ── HEADER BAR ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2.5 flex-shrink-0 border-b border-white/[0.07]" style={{ background: '#0d0f14' }}>
        {/* Left */}
        <div className="flex items-center gap-3">
          <button onClick={closePhoneControl} className="flex items-center gap-1.5 text-white/50 hover:text-white/80 transition-colors text-sm">
            <ChevronLeft size={16} />
            <span className="text-[13px]">Phones</span>
          </button>
          <div className="w-px h-5 bg-white/[0.08]" />
          {/* Avatar */}
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white"
            style={{ background: 'linear-gradient(135deg,#2dd4bf,#0891b2)' }}>
            {avatarLetters}
          </div>
          <div className="flex flex-col">
            <span className="text-[13px] font-bold text-white leading-tight">{device.name}</span>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full status-dot-pulse" style={{ background: meta.color, boxShadow: `0 0 4px ${meta.color}` }} />
                <span className="text-[10px]" style={{ color: meta.color }}>{meta.label}</span>
              </div>
              <span className="text-[10px] text-white/30">{device.id.slice(0, 10)}</span>
            </div>
          </div>
        </div>

        {/* Right */}
        <div className="flex items-center gap-3">
          {/* Nav arrows */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentIndex(i => Math.max(0, i - 1))}
              disabled={currentIndex === 0}
              className="p-1 rounded hover:bg-white/[0.08] disabled:opacity-25 transition-colors"
            >
              <ChevronLeft size={16} color="white" />
            </button>
            <span className="text-[12px] text-white/60 tabular-nums px-1">{currentIndex + 1}/{devices.length}</span>
            <button
              onClick={() => setCurrentIndex(i => Math.min(devices.length - 1, i + 1))}
              disabled={currentIndex >= devices.length - 1}
              className="p-1 rounded hover:bg-white/[0.08] disabled:opacity-25 transition-colors"
            >
              <ChevronRight size={16} color="white" />
            </button>
          </div>
          {/* Report button */}
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-amber-400 hover:bg-amber-400/10 transition-colors"
            style={{ border: '1px solid rgba(251,191,36,0.4)' }}>
            <AlertTriangle size={13} />
            Report Problem
          </button>
        </div>
      </div>

      {/* ── THREE-COLUMN BODY ───────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT COLUMN (280px) ───────────────────────────────────────────── */}
        <div className="w-[280px] shrink-0 flex flex-col gap-3 p-3 overflow-y-auto" style={{ borderRight: '1px solid rgba(255,255,255,0.06)' }}>

          {/* Device Info */}
          <Card title="Device Info">
            <div className="flex flex-col">
              {[
                { label: 'PHONE',    value: device.name },
                { label: 'MODEL',    value: device.model },
                { label: 'OS',       value: device.osVersion },
                { label: 'STATUS',   value: meta.label },
                { label: 'BATTERY',  value: `${device.battery}%` },
                { label: 'REGION',   value: device.region },
                { label: 'GROUP',    value: device.group },
                { label: 'ASSIGNED', value: device.assignedUser ?? 'M. Chen' },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between items-center py-1.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.35)' }}>{label}</span>
                  <span className="font-mono text-[11px] text-white/80">{value}</span>
                </div>
              ))}
              {/* Device ID - clickable to copy */}
              <div className="flex justify-between items-center py-1.5">
                <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.35)' }}>DEVICE ID</span>
                <button
                  className="font-mono text-[11px] text-[#2dd4bf] hover:text-[#5eead4] transition-colors"
                  onClick={() => { navigator.clipboard?.writeText(device.id); addLog(`Copied device ID: ${device.id}`) }}
                  title="Click to copy"
                >
                  {device.id.slice(0, 14)}
                </button>
              </div>
            </div>
          </Card>

          {/* Quality Settings */}
          <Card title="Quality Settings">
            <p className="text-[11px] text-white/35 mb-4 leading-relaxed">Higher quality and FPS improve visibility but may increase latency.</p>
            <div className="mb-4">
              <div className="flex justify-between items-center">
                <span className="font-mono text-[11px] text-white/50 uppercase tracking-wider">QUALITY</span>
                <span className="font-mono text-[13px] font-semibold text-white">{quality}</span>
              </div>
              <TealSlider value={quality} min={0} max={100} onChange={setQuality} />
            </div>
            <div>
              <div className="flex justify-between items-center">
                <span className="font-mono text-[11px] text-white/50 uppercase tracking-wider">FPS</span>
                <span className="font-mono text-[13px] font-semibold text-white">{fps}</span>
              </div>
              <TealSlider value={fps} min={5} max={60} onChange={setFps} />
            </div>
          </Card>

          {/* Gesture Controls */}
          <Card title="Gesture Controls">
            <div className="flex flex-wrap gap-2">
              {GESTURES.map(g => {
                const active = gesture === g.toLowerCase().replace(/\s+/g, '-').replace(/\//g, '')
                const key = g.toLowerCase().replace(/\s+/g, '-').replace(/\//g, '')
                return (
                  <button
                    key={g}
                    onClick={() => setGesture(key)}
                    className="px-3 py-1.5 rounded-full text-[11px] font-medium transition-all"
                    style={active
                      ? { background: '#2dd4bf', color: '#0d1117', border: '1px solid #2dd4bf' }
                      : { background: 'transparent', color: 'white', border: '1px solid rgba(255,255,255,0.2)' }
                    }
                  >
                    {g}
                  </button>
                )
              })}
            </div>
          </Card>

          {/* Directional Control — D-pad drives the live phone */}
          <Card title="Directional Control">
            <div className="mx-auto grid w-[132px] grid-cols-3 grid-rows-3 gap-1.5">
              <DPadButton disabled={readOnly} className="col-start-2" icon={<ArrowUp size={15} />} label="Swipe up" onClick={() => { phoneRef.current?.swipe('up'); sendControl({ type: 'swipe', deviceId: device.id, dir: 'up' }) }} />
              <DPadButton disabled={readOnly} className="col-start-1 row-start-2" icon={<ArrowLeft size={15} />} label="Swipe left" onClick={() => { phoneRef.current?.swipe('left'); sendControl({ type: 'swipe', deviceId: device.id, dir: 'left' }) }} />
              <DPadButton
                disabled={readOnly}
                className="col-start-2 row-start-2"
                icon={<Crosshair size={15} />}
                label="Tap center"
                center
                onClick={() => phoneRef.current?.tapCenter()}
              />
              <DPadButton disabled={readOnly} className="col-start-3 row-start-2" icon={<ArrowRight size={15} />} label="Swipe right" onClick={() => { phoneRef.current?.swipe('right'); sendControl({ type: 'swipe', deviceId: device.id, dir: 'right' }) }} />
              <DPadButton disabled={readOnly} className="col-start-2 row-start-3" icon={<ArrowDown size={15} />} label="Swipe down" onClick={() => { phoneRef.current?.swipe('down'); sendControl({ type: 'swipe', deviceId: device.id, dir: 'down' }) }} />
            </div>
            <p className="mt-2.5 text-center text-[10px] text-white/30">{readOnly ? 'Control permission required' : 'Arrows swipe · center taps'}</p>
          </Card>

          {/* Send Text */}
          <Card title="Send Text">
            <textarea
              value={sendText}
              onChange={e => setSendText(e.target.value)}
              placeholder="Type message here..."
              rows={3}
              className="w-full resize-none rounded-lg text-[12px] text-white/80 placeholder-white/25 bg-white/[0.04] border border-white/[0.08] p-2.5 outline-none focus:border-[#2dd4bf]/50 transition-colors"
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => { if (!canControl) { denyAction('phone control'); return } const t = sendText.trim(); if (!t) return; sendControl({ type: 'type_text', deviceId: device.id, text: t }, 'type', 'Send text'); setSendText('') }}
                disabled={!canControl || isBusy('type')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium text-[#0d1117] transition-colors enabled:hover:bg-[#5eead4] disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: '#2dd4bf' }}
              >
                <Send size={13} />Send
              </button>
              <button
                onClick={() => { navigator.clipboard?.writeText(sendText); addLog('Text copied') }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] text-white/60 border border-white/[0.12] hover:border-white/30 transition-colors"
              >
                <Copy size={13} />Copy
              </button>
              <button
                onClick={() => setSendText('')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] text-white/40 border border-white/[0.08] hover:border-white/20 transition-colors"
              >
                <X size={13} />
              </button>
            </div>
          </Card>
        </div>

        {/* ── CENTER COLUMN ───────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col items-center overflow-y-auto py-5 px-4">

          {/* Status bar */}
          <div className="flex items-center gap-5 mb-5 px-4 py-2.5 rounded-xl border border-white/[0.08] bg-[#111318]">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full status-dot-pulse" style={{ background: meta.color, boxShadow: `0 0 5px ${meta.color}` }} />
              <span className="text-[11px]" style={{ color: meta.color }}>{meta.label}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Zap size={11} className="text-white/35" />
              <span className="text-[11px] text-white/40 uppercase tracking-wider">{useSupabaseCommands ? 'REFRESH' : 'LATENCY'}</span>
              {useSupabaseCommands
                ? <span className="font-mono text-[12px] font-bold tabular-nums" style={{ color: refreshColor }}>{frameLatency == null ? '—' : `${Math.round(frameLatency)}ms`}</span>
                : <span className="font-mono text-[12px] font-bold tabular-nums" style={{ color: latColor }}>{Math.round(latency)}ms</span>}
            </div>
            <div className="flex items-center gap-1.5">
              <Gauge size={11} className="text-white/35" />
              <span className="text-[11px] text-white/40 uppercase tracking-wider">{useSupabaseCommands ? 'FRAME' : 'FPS'}</span>
              {useSupabaseCommands
                ? <span className="font-mono text-[12px] font-bold text-white tabular-nums">{frame ? fmt(new Date(frame.capturedAt)) : '—'}</span>
                : <span className="font-mono text-[12px] font-bold text-white tabular-nums">{liveFps}</span>}
            </div>
            <div className="flex items-center gap-1.5">
              <Shield size={11} className="text-white/35" />
              <span className="text-[11px] text-white/40 uppercase tracking-wider">STREAM</span>
              {useSupabaseCommands
                ? <span className="font-mono text-[12px]" style={{ color: liveView ? '#4ade80' : frame ? '#fbbf24' : '#6b7280' }}>{liveView ? 'Live' : frame ? 'Snapshot' : 'Idle'}</span>
                : <span className="font-mono text-[12px] text-green-400">Stable</span>}
            </div>
            <div className="flex items-center gap-1.5">
              <BatteryMedium size={11} className="text-white/35" />
              <span className="text-[11px] text-white/40 uppercase tracking-wider">BATTERY</span>
              <span className="font-mono text-[12px] text-white tabular-nums">{device.battery}%</span>
            </div>
            <div className="w-px h-4 bg-white/[0.08]" />
            {/* Stabilize: stops decorative body tilt — screen controls unaffected. Truthful + two-way: shows
                the EFFECTIVE state; in supabase-mode it toggles the session-local live default (stabilized),
                otherwise the persisted workspace setting. */}
            <button
              type="button"
              aria-pressed={stabilized}
              title={stabilized ? 'Phone motion is stabilized — click to enable tilt' : 'Stabilize phone (stop tilt motion)'}
              onClick={() => {
                const next = !stabilized
                if (useSupabaseCommands) setLiveStabilized(next)
                else updateSettings({ stabilizePhone: next })
                addLog(next ? 'Phone motion stabilized' : 'Phone motion enabled')
              }}
              className={[
                'flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] uppercase tracking-wider transition-colors',
                stabilized
                  ? 'bg-[var(--accent-soft)] text-[var(--accent-text)] border border-[var(--accent-border)]'
                  : 'text-white/40 border border-white/[0.08] hover:text-white/70',
              ].join(' ')}
            >
              <Anchor size={11} />
              {stabilized ? 'Stabilized' : 'Stabilize'}
            </button>
            {/* Live view: opt-in auto-refresh of the REAL device screenshot (supabase-mode). */}
            {useSupabaseCommands && canScreenshot && (
              <button
                type="button"
                aria-pressed={liveView}
                title={liveView ? 'Stop auto-refreshing the live screen' : 'Auto-refresh the live screen every few seconds'}
                disabled={device.status === 'offline' || device.status === 'error'}
                onClick={() => { const next = !liveView; setLiveView(next); addLog(next ? 'Live view on — auto-refreshing screen' : 'Live view off') }}
                className={[
                  'flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] uppercase tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                  liveView
                    ? 'bg-[var(--accent-soft)] text-[var(--accent-text)] border border-[var(--accent-border)]'
                    : 'text-white/40 border border-white/[0.08] hover:text-white/70',
                ].join(' ')}
              >
                <Radio size={11} />
                {liveView ? 'Live' : 'Go Live'}
              </button>
            )}
          </div>

          {/* Read-only banner — viewer/scoped user without control permission */}
          {readOnly && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2">
              <Lock size={13} className="text-amber-400" />
              <span className="text-[11px] text-amber-200/90">View only — you don’t have control permission for this phone.</span>
            </div>
          )}

          {/* Live interactive phone. The Stabilize toggle is AUTHORITATIVE and TRUTHFUL: `stabilized` is the
              effective value (supabase-mode defaults stabilized for accurate coords; the button enables/disables
              tilt). The frame clip that prevents the old ghost is held independently of the tilt
              (transformStyle:flat + the overflow-hidden frame viewport in live-phone), so the decorative cursor
              tilt can never push the frame outside the shell. Tilt adds a few logical points of
              getBoundingClientRect skew on tap/drag, hence stabilized-by-default for precise control. */}
          <PhoneStage statusColor={meta.color} stabilized={stabilized}>
            <div className="hud-corners p-5" style={{ ['--hud-c' as string]: `${meta.color}55`, ['--hud-len' as string]: '16px' }}>
              {/* supabase-mode: the "pending" banner is shown ONLY until a REAL frame
                  arrives — once LivePhone renders the captured device_screenshots frame,
                  a "hardware control pending" line above it would be untruthful, so it's
                  gated on `!frame` (the captured screen itself becomes the truthful state). */}
              {useSupabaseCommands && !frame && (
                <div className="mb-3 rounded-control border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-center">
                  <span className="mono text-[9px] uppercase tracking-wider text-amber-300/90">No live phone session yet · hardware control pending</span>
                </div>
              )}
              <LivePhone
                ref={phoneRef}
                device={device}
                job={job}
                width={330}
                gesture={gesture}
                readOnly={readOnly}
                onLog={phoneLog}
                onTap={(x, y) => sendControl({ type: 'tap', deviceId: device.id, x, y })}
                frame={useSupabaseCommands ? frame : undefined}
                onGesture={useSupabaseCommands ? handleGesture : undefined}
              />
            </div>
          </PhoneStage>

          {/* Bottom action bar */}
          <div className="flex gap-2 mt-5">
            <button
              onClick={() => launchAppCmd('Instagram')}
              disabled={!canControl || isBusy('launch:Instagram')}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[12px] font-medium text-[#0d1117] transition-colors enabled:hover:bg-[#5eead4] disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: '#2dd4bf' }}
            >
              <Rocket size={14} />Launch App
            </button>
            <button
              onClick={() => { if (!canScreenshot) { denyAction('screenshot'); return } captureScreenshot() }}
              disabled={!canScreenshot}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-[12px] text-white/70 border border-white/[0.12] transition-colors enabled:hover:border-white/30 enabled:hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Camera size={14} />Screenshot
            </button>
            <button
              onClick={() => { if (!canScreenshot) { denyAction('screenshot'); return } addLog('Recording started') }}
              disabled={!canScreenshot}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-[12px] text-white/70 border border-white/[0.12] transition-colors enabled:hover:border-white/30 enabled:hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Video size={14} />Record
            </button>
            <button
              onClick={() => setActiveTab('logs')}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-[12px] text-white/70 border border-white/[0.12] transition-colors hover:border-white/30 hover:text-white"
            >
              <FileText size={14} />Open Logs
            </button>
            <button
              onClick={() => { if (!canControl) { denyAction('phone control'); return } addLog('Stream restarted') }}
              disabled={!canControl}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-[12px] text-white/70 border border-white/[0.12] transition-colors enabled:hover:border-white/30 enabled:hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RefreshCw size={14} />Restart Stream
            </button>
          </div>
        </div>

        {/* ── RIGHT COLUMN (300px) ──────────────────────────────────────────── */}
        <div className="w-[300px] shrink-0 flex flex-col gap-3 p-3 overflow-y-auto" style={{ borderLeft: '1px solid rgba(255,255,255,0.06)' }}>

          {/* Quick Controls */}
          <Card title="Quick Controls">
            <div className="grid grid-cols-4 gap-2">
              {quickControls.map(({ key, label: rawLabel, icon, danger }) => {
                const label = key === 'reboot' && confirmingReboot ? 'Confirm?' : rawLabel
                const need = key === 'reboot' ? canReboot : key === 'screenshot' ? canScreenshot : canControl
                return (
                <button
                  key={key}
                  onClick={() => runQuick(key)}
                  disabled={!need || isBusy(key)}
                  title={!need ? 'You lack permission for this action' : label}
                  className="flex flex-col items-center gap-1.5 py-3 rounded-lg border transition-all disabled:cursor-not-allowed disabled:opacity-35"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    borderColor: danger ? 'rgba(248,113,113,0.25)' : 'rgba(255,255,255,0.08)',
                    color: danger ? '#f87171' : 'rgba(255,255,255,0.6)',
                  }}
                  onMouseEnter={e => {
                    if (!need) return
                    const el = e.currentTarget as HTMLElement
                    el.style.borderColor = danger ? 'rgba(248,113,113,0.6)' : 'rgba(255,255,255,0.25)'
                    el.style.background = danger ? 'rgba(248,113,113,0.08)' : 'rgba(255,255,255,0.07)'
                  }}
                  onMouseLeave={e => {
                    const el = e.currentTarget as HTMLElement
                    el.style.borderColor = danger ? 'rgba(248,113,113,0.25)' : 'rgba(255,255,255,0.08)'
                    el.style.background = 'rgba(255,255,255,0.03)'
                  }}
                >
                  {icon}
                  <span className="text-[10px] font-medium">{label}</span>
                </button>
                )
              })}
            </div>
          </Card>

          {/* Phone Notes */}
          <Card title="Phone Notes">
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Write notes about this device..."
              rows={3}
              className="w-full resize-none rounded-lg text-[12px] text-white/80 placeholder-white/25 bg-white/[0.04] border border-white/[0.08] p-2.5 outline-none focus:border-[#2dd4bf]/40 transition-colors"
            />
            <button
              onClick={() => addLog('Notes saved')}
              className="w-full mt-2 py-2 rounded-lg text-[12px] text-white/70 border border-white/[0.12] hover:border-white/25 hover:text-white transition-colors"
              style={{ background: 'rgba(255,255,255,0.03)' }}
            >
              Save Notes
            </button>
          </Card>

          {/* Tabs */}
          <div className="rounded-xl border border-white/[0.08] bg-[#111318] flex flex-col flex-1">
            {/* Tab bar */}
            <div className="flex border-b border-white/[0.06]">
              {(['apps','automations','sessions','logs'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className="relative flex-1 py-2.5 text-[11px] font-medium capitalize transition-colors"
                  style={{ color: activeTab === tab ? '#2dd4bf' : 'rgba(255,255,255,0.35)' }}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  {activeTab === tab && (
                    <motion.span
                      layoutId="pc-tab-underline"
                      className="absolute -bottom-px left-0 right-0 h-0.5"
                      style={{ background: '#2dd4bf' }}
                      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    />
                  )}
                </button>
              ))}
            </div>

            <div className="p-3 flex-1 overflow-y-auto">
              {/* Apps tab */}
              {activeTab === 'apps' && (
                <div className="grid grid-cols-2 gap-2">
                  {INSTALLED_APPS.map(app => (
                    <div key={app.name} className="flex items-center gap-2 p-2 rounded-lg border border-white/[0.06] hover:border-white/[0.12] transition-colors">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                        style={{ background: app.bg, border: app.border ? `1px solid ${app.border}` : 'none' }}>
                        {app.abbr}
                      </div>
                      <span className="text-[11px] text-white/70 truncate flex-1">{app.name}</span>
                      <button
                        onClick={() => launchAppCmd(app.name)}
                        disabled={!canControl || isBusy(`launch:${app.name}`)}
                        className="text-[10px] text-[#2dd4bf] shrink-0 transition-colors px-1 py-0.5 rounded enabled:hover:text-[#5eead4] enabled:hover:border enabled:hover:border-[#2dd4bf]/40 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Launch
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Automations tab */}
              {activeTab === 'automations' && (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <span className="text-[12px] text-white/30">No automations configured</span>
                  <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] text-[#2dd4bf] border border-[#2dd4bf]/30 hover:bg-[#2dd4bf]/10 transition-colors">
                    + Add Automation
                  </button>
                </div>
              )}

              {/* Sessions tab — real history (empty for the simulated provider) */}
              {activeTab === 'sessions' && (
                <div className="flex flex-col gap-2">
                  {sessionsLoading ? (
                    <span className="py-6 text-center text-[11px] text-white/30">Loading sessions…</span>
                  ) : sessionsError ? (
                    <span className="py-6 text-center text-[11px] text-amber-300/80">{sessionsError}</span>
                  ) : sessions.length === 0 ? (
                    <span className="py-6 text-center text-[11px] text-white/30">
                      {useSupabaseCommands
                        ? 'Hardware control pending — live sessions appear once a device agent connects.'
                        : 'No sessions recorded for this device yet.'}
                    </span>
                  ) : (
                    sessions.map((s) => (
                      <div key={s.id} className="p-2.5 rounded-lg border border-white/[0.06]">
                        <div className="flex justify-between items-center">
                          <span className="text-[11px] text-white/70">{new Date(s.startedAt).toLocaleString()}</span>
                          <span className="font-mono text-[10px] text-[#2dd4bf]">
                            {s.durationMs != null ? `${Math.max(1, Math.round(s.durationMs / 60000))}m` : '—'}
                          </span>
                        </div>
                        <span className="text-[10px] text-white/35">{s.userName ?? s.userId ?? 'Unknown operator'}</span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Logs tab */}
              {activeTab === 'logs' && (
                <div
                  ref={logRef}
                  className="flex flex-col gap-0.5 overflow-y-auto"
                  style={{ maxHeight: 260, fontFamily: 'ui-monospace, monospace' }}
                >
                  {logs.map(entry => (
                    <div key={entry.id} className="text-[10px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>
                      <span className="text-white/25">[{fmt(entry.ts)}]</span>{' '}
                      <span style={{
                        color: entry.type === 'error' ? '#f87171'
                          : entry.type === 'screenshot' ? '#4ade80'
                          : entry.type === 'gesture' ? '#fbbf24'
                          : 'rgba(255,255,255,0.55)'
                      }}>{entry.text}</span>
                    </div>
                  ))}
                  <div className="text-[10px] text-white/30">▋</div>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

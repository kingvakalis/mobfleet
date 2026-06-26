import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Check, Copy, Play, Send, Square, Trash2, X,
  Lock, Home, CornerDownLeft, Grid2x2, Camera,
  Cpu, ArrowUpRight, Pin, PinOff, Zap, Briefcase, UserPlus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { StatusDot } from '@/components/ui/status-dot'
import { GRID_APPS } from '@/components/phone/app-catalog'
import { useDeviceApps } from '@/hooks/useDeviceApps'
import { ManageAppsModal } from '@/components/phone/manage-apps-modal'
import { AppRow, AppRowsSkeleton } from '@/components/phone/app-row'
import { LivePhone, type LivePhoneHandle, type LiveFrame, type PhoneGesture } from '@/components/phone/live-phone'
import { useDeviceLog, type LogLevel, type LogLine } from '@/hooks/use-device-log'
import { useFleet } from '@/hooks/use-fleet'
import { useScopedDevices, useActingEmployee } from '@/lib/authorization/use-access'
import { canActOnPhone } from '@/lib/authorization'
import { useAuth } from '@/contexts/AuthContext'
import { useTeamContext } from '@/contexts/TeamContext'
import { useDeviceGroups } from '@/hooks/useDeviceGroups'
import { useDevices } from '@/hooks/useDevices'
import { enqueueCommand, watchCommand, getLatestScreenshot, getLatestSession, listCommands, subscribeDeviceScreenshots, type DeviceSessionInfo, type DeviceScreenshot } from '@/services/device-commands'
import { downloadScreenshot } from '@/lib/download-screenshot'
import { controlCommandToWire } from '@/shared/control-command'
import type { ControlCommand, AgentCommandAction } from '@/shared/types'
import { regionLabel } from '@/data/regions'
import { client, safe } from '@/lib/provider'
import { formatUptime } from '@/lib/format'
import { EXPO_OUT } from '@/lib/motion'
import { STATUS } from '@/lib/status'
import { useUIStore } from '@/state/ui-store'
import { useSettings } from '@/state/settings-store'
import { AUTH_SOURCE } from '@/auth/auth-source'
import { isSupabaseConfigured } from '@/lib/supabase'
import { isHeartbeatStale } from '@/shared/heartbeat'
import { useNow } from '@/hooks/use-now'
import type { Device, Job } from '@/lib/provider/types'
import { LogStream } from './log-stream'

function Cell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="py-1">
      <div className="label text-fg-muted">{label}</div>
      <div
        className="mono mt-1 truncate text-[12px] text-fg-secondary"
        style={color ? { color } : undefined}
        title={value}
      >
        {value}
      </div>
    </div>
  )
}

/** Live telemetry readout cell. */
function Tele({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-3 py-2">
      <span className="mono text-[12px] font-semibold tabular-nums" style={{ color: color ?? 'rgba(255,255,255,0.75)' }}>
        {value}
      </span>
      <span className="mono text-[8px] uppercase tracking-[0.18em] text-fg-muted">{label}</span>
    </div>
  )
}

/** Telemetry cell while its source read is still resolving — a neutral shimmer in place of the value
 *  (same wrapper/dimensions as Tele) so we never flash a premature "—" / "Idle" before data lands. */
function TeleLoading({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-3 py-2">
      <div className="shimmer rounded" style={{ width: 28, height: 12 }} />
      <span className="mono text-[8px] uppercase tracking-[0.18em] text-fg-muted">{label}</span>
    </div>
  )
}

const QUICK = [
  { key: 'lock',       label: 'Lock',     Icon: Lock },
  { key: 'home',       label: 'Home',     Icon: Home },
  { key: 'back',       label: 'Back',     Icon: CornerDownLeft },
  { key: 'switcher',   label: 'Switch',   Icon: Grid2x2 },
  { key: 'screenshot', label: 'Shot',     Icon: Camera },
] as const

/** Relative age of an epoch-ms timestamp against a live clock (null → never). */
function relAgo(ms: number | null | undefined, now: number): string {
  if (ms == null) return 'never'
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

// Module-scope so the impure clock read is never analyzed as a render-phase call
// (these timings are only taken at event time — command enqueue / ack / frame read).
function nowMs(): number { return Date.now() }

/** Monospace HH:MM:SS stamp for real log lines. */
function logClock(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/**
 * supabase-mode device body — the ORIGINAL rich drawer layout (metric strip, phone
 * preview, quick controls, launch apps, send text, group dropdown, status/details,
 * bottom actions, live log) wired to REAL Supabase services. No mock phone screen, no
 * fabricated metrics/logs, no Railway /v1/devices/*:
 *  • preview      → latest real device_screenshots frame, else an honest waiting state
 *  • controls     → enqueueCommand + watchCommand (real queued→running→done lifecycle),
 *                   RBAC-gated; unsupported actions are disabled with a truthful tooltip
 *  • group        → real device_groups (useDeviceGroups.assignDevices → devices.group_name)
 *  • metrics      → real command round-trip + real battery/uptime (device_sessions), else "—"
 *  • live log     → real recent agent_commands + live command lifecycle, never fake heartbeats
 *  • FULL CONTROL → the existing real Phone Control page (header button)
 */
function SupabaseDeviceBody({ device, job, onClose }: { device: Device; job: Job | null; onClose: () => void }) {
  const now = useNow()
  const { user } = useAuth()
  const teamCtx = useTeamContext()
  const { member } = useActingEmployee()
  const teamId = teamCtx.team?.id ?? null
  const openSubmit = useUIStore((s) => s.openSubmit)
  const setView = useUIStore((s) => s.setView)
  const confirmDestructive = useSettings((s) => s.confirmDestructive)
  const phoneRef = useRef<LivePhoneHandle>(null)

  // RBAC — the same per-phone checks the real Phone Control page uses.
  const canControl = canActOnPhone(member, 'phones.control', device)
  const canScreenshot = canActOnPhone(member, 'phones.screenshot', device)
  const canAssignGroup = canActOnPhone(member, 'phones.assign_group', device)
  const canRetire = canActOnPhone(member, 'phones.retire', device)
  const readOnly = !canControl

  const groupsApi = useDeviceGroups(teamId)
  const { deleteDevice } = useDevices(teamId)

  const meta = STATUS[device.status]
  const stale = isHeartbeatStale(device.lastHeartbeat, now)
  const addr = device.ipAddress ? `${device.ipAddress}${device.wdaPort ? `:${device.wdaPort}` : ''}` : '—'

  const [frame, setFrame] = useState<LiveFrame | null>(null)
  // First-read resolving gates: while true, the glass shows a skeleton and the frame/session-derived
  // metric cells shimmer instead of flashing a premature "Waiting for frame" / "Idle" / "—". The body
  // remounts per device (DrawerContent is keyed by deviceId), so these start fresh on every selection.
  const [frameResolving, setFrameResolving] = useState(true)
  const [sessionLoaded, setSessionLoaded] = useState(false)
  const [session, setSession] = useState<DeviceSessionInfo | null>(null)
  const [lastLatency, setLastLatency] = useState<number | null>(null)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [sendText, setSendText] = useState('')
  const [copied, setCopied] = useState(false)
  const logSeq = useRef(0)
  const watchersRef = useRef<Set<() => void>>(new Set())
  const mountedRef = useRef(true)
  const captureBusyRef = useRef(false)
  const captureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const addLog = useCallback((level: LogLevel, text: string) => {
    setLogs((ls) => [...ls, { id: logSeq.current++, t: logClock(), level, text }].slice(-120))
  }, [])

  // `downloadName` (device name) is set ONLY when the user pressed Screenshot — after the
  // real frame loads we save it to the user's PC. Auto/post-command refreshes pass nothing.
  const refreshFrame = useCallback(async (downloadName?: string) => {
    try {
      const s = await getLatestScreenshot(device.id)
      if (!mountedRef.current || !s) return
      const ts = Date.parse(s.capturedAt)
      const fmt = s.format === 'jpeg' || s.format === 'webp' ? s.format : 'png' // allow-list the MIME at the sink
      setFrame({ src: `data:image/${fmt};base64,${s.imageBase64}`, capturedAt: Number.isFinite(ts) ? ts : nowMs(), width: s.width, height: s.height })
      if (downloadName) downloadScreenshot(downloadName, s.imageBase64, s.format)
    } catch { /* keep the prior frame */ }
  }, [device.id])

  // Capture ONE fresh screenshot so the inline preview reflects the device's CURRENT screen.
  // A state-changing command (home/tap/launch/…) does NOT upload a frame by itself, so we
  // enqueue a real `screenshot` command and read the captured frame on its ACK. Strictly one
  // in flight (captureBusyRef) — rapid commands never storm the queue. Needs screenshot scope.
  const captureOnce = () => {
    if (captureBusyRef.current || !canScreenshot || !teamId || !user?.id) return
    captureBusyRef.current = true
    let settled = false
    let cancel: () => void = () => {}
    const finish = () => { if (settled) return; settled = true; captureBusyRef.current = false; cancel(); watchersRef.current.delete(cancel) }
    enqueueCommand({ teamId, deviceId: device.id, action: 'screenshot', userId: user.id })
      .then(({ id: cmdId }) => {
        if (!mountedRef.current) { finish(); return }
        cancel = watchCommand(cmdId, (status) => {
          if (!mountedRef.current) { finish(); return }
          if (status === 'acked') { void refreshFrame(); addLog('ok', '↻ preview refreshed') }
          if (status === 'acked' || status === 'failed' || status === 'expired') finish()
        }, { intervalMs: 1000, timeoutMs: 12000 })
        watchersRef.current.add(cancel)
        setTimeout(finish, 13000) // resolve even if the watch never sees a terminal status
      })
      .catch(() => finish())
  }

  // Debounce post-command captures so a rapid gesture burst coalesces into ONE screenshot.
  const scheduleCapture = () => {
    if (captureTimerRef.current) clearTimeout(captureTimerRef.current)
    captureTimerRef.current = setTimeout(() => { captureTimerRef.current = null; captureOnce() }, 500)
  }

  // Enqueue ONE real command and report its REAL lifecycle (queued → running → done/failed).
  // After a state-changing command acks, capture a fresh frame. (Event-time handler — not
  // memoized; the component remounts per device so identity churn is moot.)
  const enqueue = async (action: AgentCommandAction, payload: Record<string, unknown> | undefined, label: string, downloadName?: string, onSettled?: () => void) => {
    if (!teamId || !user?.id) { addLog('error', `${label} — no active workspace`); onSettled?.(); return }
    const t0 = nowMs()
    try {
      const { id } = await enqueueCommand({ teamId, deviceId: device.id, action, payload, userId: user.id })
      if (!mountedRef.current) { onSettled?.(); return }
      addLog('info', `⏳ ${label} — queued`)
      let cancel: () => void = () => {}
      const stop = () => { cancel(); watchersRef.current.delete(cancel) }
      cancel = watchCommand(id, (status, error) => {
        if (!mountedRef.current) { stop(); return }
        if (status === 'running') addLog('info', `▶ ${label} — running`)
        else if (status === 'acked') {
          addLog('ok', `✓ ${label} — done`)
          setLastLatency(nowMs() - t0)
          // A screenshot uploads its own frame → just read it. Any OTHER state-changing
          // command doesn't capture, so enqueue a debounced follow-up screenshot to reflect
          // the device's NEW screen. reboot/install are skipped.
          if (action === 'screenshot') void refreshFrame(downloadName)
          else if (action !== 'reboot' && action !== 'install') scheduleCapture()
        } else if (status === 'failed') addLog('error', `✗ ${label} — failed${error ? ': ' + error : ''}`)
        if (status === 'acked' || status === 'failed' || status === 'expired') { stop(); onSettled?.() }
      })
      watchersRef.current.add(cancel)
      setTimeout(() => { stop(); onSettled?.() }, 31000) // deregister + settle even if the watch never sees a terminal status
    } catch (e) {
      addLog('error', `✗ ${label} — ${e instanceof Error ? e.message : 'error'}`)
      onSettled?.()
    }
  }

  // Map a typed ControlCommand → its wire action/payload (single source of truth) and enqueue it.
  const send = (command: ControlCommand, label: string, downloadName?: string) => {
    const wire = controlCommandToWire(command)
    void enqueue(wire.action, wire.payload, label, downloadName)
  }

  const denied = (need: string) => addLog('error', `✗ blocked — requires ${need}`)

  const handleGesture = (g: PhoneGesture) => {
    if (!canControl) { denied('phones.control'); return }
    switch (g.type) {
      case 'tap': send({ type: 'tap', deviceId: device.id, x: g.x, y: g.y }, `Tap (${g.x}, ${g.y})`); break
      case 'swipe': send({ type: 'swipe', deviceId: device.id, dir: g.dir, x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, durationMs: g.durationMs }, `Swipe ${g.dir}`); break
      case 'scroll': send({ type: 'swipe', deviceId: device.id, dir: g.dir, x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, durationMs: g.durationMs, scroll: true }, `Scroll ${g.dir}`); break
      case 'long_press': addLog('warn', 'Long-press has no agent action yet — not sent'); break
    }
  }

  const quickAction = (key: (typeof QUICK)[number]['key']) => {
    switch (key) {
      case 'lock':       if (!canControl) return denied('phones.control'); send({ type: 'key', deviceId: device.id, key: 'lock' }, 'Lock'); break
      case 'home':       if (!canControl) return denied('phones.control'); send({ type: 'key', deviceId: device.id, key: 'home' }, 'Home'); break
      case 'back':       if (!canControl) return denied('phones.control'); send({ type: 'key', deviceId: device.id, key: 'back' }, 'Back'); break
      case 'switcher':   if (!canControl) return denied('phones.control'); send({ type: 'key', deviceId: device.id, key: 'switcher' }, 'App switcher'); break
      case 'screenshot': if (!canScreenshot) return denied('phones.screenshot'); send({ type: 'screenshot', deviceId: device.id }, 'Screenshot', device.name); break
    }
  }

  // Real installed-app inventory + this user's visibility prefs — the SAME source the Phone
  // Control Apps tab uses (no second fake list). Only apps the agent detected installed appear.
  const deviceApps = useDeviceApps(device.id, teamId, user?.id ?? null, true)
  const [manageAppsOpen, setManageAppsOpen] = useState(false)
  const [appBusy, setAppBusy] = useState<Set<string>>(new Set())
  const setBusy = (k: string, v: boolean) => { if (mountedRef.current) setAppBusy((s) => { const n = new Set(s); if (v) n.add(k); else n.delete(k); return n }) }
  // Launch/terminate by REAL bundle id; truthful lifecycle via enqueue, which also refreshes the preview.
  const launchByBundle = (bundleId: string, name: string) => {
    if (!canControl) return denied('phones.control')
    if (appBusy.has(`launch:${bundleId}`)) return
    setBusy(`launch:${bundleId}`, true)
    void enqueue('launch', { bundleId, name }, `Launch ${name}`, undefined, () => setBusy(`launch:${bundleId}`, false))
  }
  const stopByBundle = (bundleId: string, name: string) => {
    if (!canControl) return denied('phones.control')
    if (appBusy.has(`stop:${bundleId}`)) return
    setBusy(`stop:${bundleId}`, true)
    void enqueue('terminate', { bundleId, name }, `Stop ${name}`, undefined, () => setBusy(`stop:${bundleId}`, false))
  }
  // Ask the agent to re-detect the installed inventory. The shared hook owns the truthful lifecycle
  // (queued→running→done/failed + error, dedup, device-switch cancel) shown in the Manage Apps modal,
  // and reloads the inventory on success (Realtime + explicit refetch).
  const refreshDeviceApps = () => {
    if (!canControl) return denied('phones.control')
    deviceApps.refreshApps()
  }

  const submitText = () => {
    if (!canControl) return denied('phones.control')
    const t = sendText.trim(); if (!t) return
    send({ type: 'type_text', deviceId: device.id, text: t }, 'Send text'); setSendText('')
  }

  const changeGroup = (next: string) => {
    if (!canAssignGroup) return denied('phones.assign_group')
    if (next === device.group) return
    void groupsApi.assignDevices([device.id], next).then((r) =>
      addLog(r.error ? 'error' : 'ok', r.error ? `✗ group: ${r.error}` : `Group → ${next}`))
  }

  const retire = () => {
    if (!canRetire) return denied('phones.retire')
    if (confirmDestructive && !window.confirm(`Retire ${device.name}? This removes it from the pool.`)) return
    void deleteDevice(device.id).then((r) => { if (r.error) addLog('error', `✗ retire: ${r.error}`); else onClose() })
  }

  const copyId = async () => {
    try { await navigator.clipboard.writeText(device.id) } catch { /* ignore */ }
    setCopied(true); setTimeout(() => setCopied(false), 1200)
  }

  // On open: load the latest real frame + agent session, and seed the log with the
  // device's recent REAL agent_commands. On unmount: cancel in-flight watchers.
  useEffect(() => {
    mountedRef.current = true
    const watchers = watchersRef.current
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async reads; setState lands in their .then, not synchronously
    void refreshFrame().finally(() => { if (mountedRef.current) setFrameResolving(false) })
    getLatestSession(device.id)
      .then((s) => { if (mountedRef.current) setSession(s) })
      .catch(() => {})
      .finally(() => { if (mountedRef.current) setSessionLoaded(true) })
    listCommands(device.id, 6).then((rows) => {
      if (!mountedRef.current || rows.length === 0) return
      const seed = [...rows].reverse().map((r): LogLine => ({
        id: logSeq.current++, t: logClock(),
        level: r.status === 'failed' ? 'error' : r.status === 'acked' ? 'ok' : 'info',
        text: `${r.action} — ${r.status}`,
      }))
      setLogs((ls) => [...seed, ...ls].slice(-120))
    }).catch(() => {})
    // Realtime: reflect any newly-uploaded frame for THIS device while the drawer is open.
    // Graceful no-op if device_screenshots isn't in the realtime publication — the
    // post-command capture + open-time read still drive the preview.
    const unsub = subscribeDeviceScreenshots(device.id, (s: DeviceScreenshot) => {
      if (!mountedRef.current || !s.imageBase64) return
      const ts = Date.parse(s.capturedAt)
      const fmt = s.format === 'jpeg' || s.format === 'webp' ? s.format : 'png'
      setFrame({ src: `data:image/${fmt};base64,${s.imageBase64}`, capturedAt: Number.isFinite(ts) ? ts : nowMs(), width: s.width, height: s.height })
    })
    return () => {
      mountedRef.current = false
      for (const c of watchers) c(); watchers.clear()
      if (captureTimerRef.current) { clearTimeout(captureTimerRef.current); captureTimerRef.current = null }
      unsub()
    }
  }, [device.id, refreshFrame])

  // Metric-strip values: real, or an honest "—".
  const latColor = lastLatency == null ? undefined : lastLatency < 2500 ? 'var(--status-online)' : lastLatency < 6000 ? 'var(--status-warming)' : 'var(--status-error)'
  const battery = session?.battery ?? null
  const uptime = session && !session.endedAt ? formatUptime(now - Date.parse(session.startedAt)) : '—'
  const groupOptions = [...new Set([device.group, ...groupsApi.groups.map((g) => g.name)])].filter(Boolean).sort()
  const canStart = device.status === 'offline' || device.status === 'error'

  return (
    <>
      {/* metric strip — real command round-trip + real battery/uptime, else "—" (no fabrication). While
          the first session/frame reads are in flight the source-dependent cells shimmer instead of
          flashing a premature "—" / "Idle" that would only correct itself a moment later. */}
      <div className="flex items-center justify-around border-b border-line bg-black/40">
        <Tele label="Latency" value={lastLatency == null ? '—' : `${Math.round(lastLatency)}ms`} color={latColor} />
        <Tele label="FPS" value="—" />
        {sessionLoaded
          ? <Tele label="Battery" value={battery == null ? '—' : `${battery}%`} color={battery == null ? undefined : battery > 30 ? 'var(--status-online)' : 'var(--status-error)'} />
          : <TeleLoading label="Battery" />}
        {frameResolving
          ? <TeleLoading label="Stream" />
          : <Tele label="Stream" value={frame ? 'Snapshot' : 'Idle'} color={frame ? 'var(--status-online)' : undefined} />}
        {sessionLoaded ? <Tele label="Uptime" value={uptime} /> : <TeleLoading label="Uptime" />}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* phone preview (REAL frame or honest waiting) + controls */}
        <div className="flex gap-4 border-b border-line px-5 py-5">
          <div className="hud-corners shrink-0 p-3" style={{ ['--hud-c' as string]: `${meta.color}55` }}>
            <LivePhone ref={phoneRef} device={device} job={job} width={192} readOnly={readOnly} onLog={addLog} frame={frame} onGesture={handleGesture} resolving={frameResolving} />
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {/* quick controls — real commands, RBAC-gated */}
            <div>
              <Label className="text-fg-muted">Quick Controls</Label>
              <div className="mt-2 grid grid-cols-4 gap-1.5">
                {QUICK.map(({ key, label, Icon, ...rest }) => {
                  const danger = 'danger' in rest && rest.danger
                  const allowed = key === 'screenshot' ? canScreenshot : canControl
                  return (
                    <motion.button
                      key={key}
                      type="button"
                      whileTap={allowed ? { scale: 0.92 } : undefined}
                      disabled={!allowed}
                      title={allowed ? label : 'You lack permission for this action'}
                      onClick={() => quickAction(key)}
                      className={[
                        'flex flex-col items-center gap-1 border py-2 transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                        danger
                          ? 'border-status-error/25 text-status-error enabled:hover:border-status-error/60 enabled:hover:bg-status-error/10'
                          : 'border-line text-fg-muted enabled:hover:border-white/25 enabled:hover:bg-elevated enabled:hover:text-fg',
                      ].join(' ')}
                    >
                      <Icon size={13} />
                      <span className="mono text-[8px] uppercase tracking-wider">{label}</span>
                    </motion.button>
                  )
                })}
              </div>
            </div>

            {/* app launcher — REAL detected + visible inventory (no hardcoded apps). Same source as the
                Phone Control Apps tab (useDeviceApps): only apps the agent confirmed installed, minus the
                ones THIS user hid. Launch/Stop are real launch/terminate commands. */}
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-fg-muted">Launch App</Label>
                <button type="button" onClick={() => setManageAppsOpen(true)} className="flex items-center gap-1 text-[10px] text-[#2dd4bf] transition-colors hover:text-[#5eead4]">
                  <Grid2x2 size={11} /> Manage
                </button>
              </div>
              {!deviceApps.ready ? (
                // First inventory read still resolving → neutral skeleton (NOT "No apps"); same row height.
                <div className="mt-2"><AppRowsSkeleton rows={3} /></div>
              ) : deviceApps.visibleApps.length === 0 ? (
                <div className="mt-2 flex flex-col items-start gap-1.5">
                  <span className="mono text-[10px] text-fg-muted">No visible apps selected</span>
                  <button type="button" onClick={() => setManageAppsOpen(true)} className="border border-line px-2 py-1 text-[10px] text-fg-secondary transition-colors hover:border-white/25 hover:text-fg">Manage Apps</button>
                </div>
              ) : (
                // ONE app per row (shared AppRow) — identical to the Phone Control Apps tab.
                <div className="mt-2 flex flex-col">
                  {deviceApps.visibleApps.map((app) => (
                    <AppRow
                      key={app.bundleId}
                      app={app}
                      canControl={canControl}
                      launching={appBusy.has(`launch:${app.bundleId}`)}
                      stopping={appBusy.has(`stop:${app.bundleId}`)}
                      onLaunch={() => launchByBundle(app.bundleId, app.name)}
                      onStop={() => stopByBundle(app.bundleId, app.name)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* send text — real type command */}
            <div>
              <Label className="text-fg-muted">Send Text</Label>
              <div className="mt-2 flex gap-1.5">
                <input
                  value={sendText}
                  onChange={(e) => setSendText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitText() }}
                  disabled={!canControl}
                  placeholder={canControl ? 'Type to device…' : 'Requires phones.control'}
                  className="mono h-8 min-w-0 flex-1 border border-line bg-elevated px-2.5 text-[11px] text-fg-secondary placeholder-white/20 outline-none transition-colors focus:border-[var(--accent-border)] disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={submitText}
                  disabled={!canControl}
                  className="flex h-8 w-9 items-center justify-center border border-line text-fg-muted transition-colors enabled:hover:border-white/25 enabled:hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Send text"
                >
                  <Send size={13} />
                </button>
              </div>
            </div>

            {/* group reassignment — real device_groups */}
            <div>
              <Label className="text-fg-muted">Group</Label>
              <select
                value={device.group}
                onChange={(e) => changeGroup(e.target.value)}
                disabled={!canAssignGroup}
                aria-label="Device group"
                className="mono mt-2 h-8 w-full rounded-control border border-line bg-elevated px-2 text-[12px] text-fg-secondary outline-none focus:border-accent/40 disabled:opacity-50"
              >
                {groupOptions.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* status / details — real device row */}
        <div className="grid grid-cols-3 gap-x-4 border-b border-line px-5 py-3">
          <Cell label="Status" value={meta.label} color={meta.color} />
          <Cell label="Model" value={`${device.model} · ${device.osVersion || '—'}`} />
          <Cell label="Address" value={addr} />
          <Cell label="UDID" value={device.udid ?? '—'} />
          <Cell label="Heartbeat" value={relAgo(device.lastHeartbeat, now)} color={stale ? 'var(--status-error)' : 'var(--status-online)'} />
          <Cell label="Job" value={job ? `${job.type.toUpperCase()} · ${Math.round(job.progress * 100)}%` : '—'} />
        </div>

        {/* actions — real where a Supabase backing exists; otherwise disabled + truthful */}
        <div className="flex flex-wrap gap-2 border-b border-line px-5 py-3">
          <Button size="sm" variant="outline" disabled title="Device power state is managed by the on-device agent — no remote start/stop in supabase-mode">
            {canStart ? <><Play size={13} /> Start</> : <><Square size={12} /> Stop</>}
          </Button>
          <Button size="sm" variant="outline" disabled title="Assign an upload task from the Automations / Jobs pages">
            <Send size={13} /> Assign
          </Button>
          <Button size="sm" variant="outline" onClick={() => openSubmit()}>
            <Zap size={13} /> Run Automation
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!device.jobId}
            title={device.jobId ? 'Open the jobs pipeline' : 'No job running on this device'}
            onClick={() => { onClose(); setView('jobs') }}
          >
            <Briefcase size={13} /> View Job
          </Button>
          <Button size="sm" variant="outline" disabled title="Requires backend employee-assignment support">
            <UserPlus size={13} /> Assign Employee
          </Button>
          <Button size="sm" variant="outline" onClick={copyId}>
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy ID'}
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={!canRetire}
            title={canRetire ? 'Retire device (RLS: owner/admin)' : 'Requires phones.retire'}
            onClick={retire}
          >
            <Trash2 size={13} /> Retire
          </Button>
        </div>

        {/* live log — real recent agent_commands + live command lifecycle (no fake heartbeats) */}
        <div className="flex items-center justify-between border-b border-line px-5 py-2.5">
          <Label className="text-fg-secondary">Live Log</Label>
          <span className="mono text-[10px] text-fg-muted">{logs.length} LINES</span>
        </div>
        <div className="h-56">
          <LogStream lines={logs} />
        </div>
      </div>

      <ManageAppsModal
        open={manageAppsOpen}
        onClose={() => setManageAppsOpen(false)}
        apps={deviceApps.installed}
        isVisible={deviceApps.isVisible}
        onToggle={deviceApps.setVisible}
        onRefresh={refreshDeviceApps}
        refreshStatus={deviceApps.refreshStatus}
        refreshError={deviceApps.refreshError}
        canRefresh={canControl}
      />
    </>
  )
}

/** Per-device content — keyed by deviceId so logs/telemetry reseed when the
 *  selection moves to another phone (the panel shell itself stays mounted). */
function DrawerContent({ deviceId, onClose }: { deviceId: string; onClose: () => void }) {
  const snapshot = useFleet()
  // SECURITY: resolve the device from the SCOPED set so the drawer can never be
  // opened against a phone outside the acting member's scope.
  const scopedDevices = useScopedDevices()
  const device = scopedDevices.find((d) => d.id === deviceId)
  const job = device?.jobId ? snapshot.jobs.find((j) => j.id === device.jobId) ?? null : null
  // supabase-mode (production): render a TRUTHFUL body (real Supabase data + route to
  // the real Phone Control page) instead of the mock phone/controls/log, which only
  // make sense for the demo/me-mode in-memory provider. me-mode/demo keep the old body.
  const supabaseMode = AUTH_SOURCE === 'supabase' && isSupabaseConfigured
  const { lines: logs, push } = useDeviceLog(deviceId)
  const phoneRef = useRef<LivePhoneHandle>(null)
  const [copied, setCopied] = useState(false)
  const [sendText, setSendText] = useState('')
  const openPhoneControl = useUIStore((s) => s.openPhoneControl)
  const openSubmit = useUIStore((s) => s.openSubmit)
  const setView = useUIStore((s) => s.setView)
  const pinned = useUIStore((s) => s.drawerPinned)
  const togglePinned = useUIStore((s) => s.toggleDrawerPinned)

  // Simulated stream telemetry — alive numbers for the demo/me-mode mock body only.
  // In supabase-mode it never runs (that body shows REAL heartbeat freshness instead).
  const [latency, setLatency] = useState(41)
  const [fps, setFps] = useState(18)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (supabaseMode) return
    const id = setInterval(() => {
      setLatency((v) => Math.round(Math.min(80, Math.max(20, v + (Math.random() - 0.5) * 14))))
      setFps((v) => Math.round(Math.min(30, Math.max(14, v + (Math.random() - 0.5) * 3))))
      setNow(Date.now())
    }, 1400)
    return () => clearInterval(id)
  }, [supabaseMode])

  const groupOptions = [...new Set(snapshot.devices.map((d) => d.group))].sort()

  const copyId = async () => {
    if (!device) return
    try {
      await navigator.clipboard.writeText(device.id)
    } catch {
      /* ignore */
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  const confirmDestructive = useSettings((s) => s.confirmDestructive)

  const quickAction = (key: (typeof QUICK)[number]['key']) => {
    const p = phoneRef.current
    switch (key) {
      case 'lock':       p?.lock(); break
      case 'home':       p?.home(); break
      case 'back':       p?.back(); break
      case 'switcher':   p?.switcher(); break
      case 'screenshot': p?.screenshot(); break
    }
  }

  const meta = device ? STATUS[device.status] : null
  const canStart = device?.status === 'offline' || device?.status === 'error'
  const latColor = latency < 50 ? 'var(--status-online)' : latency < 70 ? 'var(--status-warming)' : 'var(--status-error)'

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* status-colored top hairline */}
      {meta && (
        <div className="absolute inset-x-0 top-0 z-10 h-[2px]" style={{ background: `linear-gradient(90deg, transparent, ${meta.color}, transparent)` }} />
      )}

      {/* header */}
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex min-w-0 items-center gap-2.5">
          {device && <StatusDot status={device.status} size={9} pulse={device.status !== 'offline'} />}
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-fg">{device ? device.name : deviceId}</div>
            <div className="label mt-0.5 text-fg-muted">
              {device ? `${device.group} · ${meta!.label}` : 'DISCONNECTED'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {device && (
            <button
              type="button"
              onClick={() => { onClose(); openPhoneControl(device.id) }}
              className="mono flex h-8 items-center gap-1.5 border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 text-[10px] uppercase tracking-widest text-[var(--accent-text)] transition-colors hover:brightness-125"
            >
              <Cpu size={12} /> Full Control <ArrowUpRight size={11} />
            </button>
          )}
          <button
            type="button"
            onClick={togglePinned}
            aria-pressed={pinned}
            title={pinned ? 'Unpin — closes when selection clears' : 'Pin — stays open while exploring the graph'}
            className={[
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-control transition-colors',
              pinned ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]' : 'text-fg-muted hover:bg-elevated hover:text-fg',
            ].join(' ')}
          >
            {pinned ? <Pin size={14} /> : <PinOff size={14} />}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-elevated hover:text-fg"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {device && meta ? (
        supabaseMode ? (
          <SupabaseDeviceBody device={device} job={job} onClose={onClose} />
        ) : (
        <>
          {/* live stream telemetry */}
          <div className="flex items-center justify-around border-b border-line bg-black/40">
            <Tele label="Latency" value={`${latency}ms`} color={latColor} />
            <Tele label="FPS" value={String(fps)} />
            <Tele label="Battery" value={`${device.battery}%`} color={device.battery > 30 ? 'var(--status-online)' : 'var(--status-error)'} />
            <Tele label="Stream" value="STABLE" color="var(--status-online)" />
            <Tele label="Uptime" value={formatUptime(now - device.createdAt)} />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* interactive phone + controls */}
            <div className="flex gap-4 border-b border-line px-5 py-5">
              <div className="hud-corners shrink-0 p-3" style={{ ['--hud-c' as string]: `${meta.color}55` }}>
                <LivePhone ref={phoneRef} device={device} job={job} width={192} onLog={push} />
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-3">
                {/* quick controls */}
                <div>
                  <Label className="text-fg-muted">Quick Controls</Label>
                  <div className="mt-2 grid grid-cols-4 gap-1.5">
                    {QUICK.map(({ key, label, Icon, ...rest }) => {
                      const danger = 'danger' in rest && rest.danger
                      return (
                        <motion.button
                          key={key}
                          type="button"
                          whileTap={{ scale: 0.92 }}
                          onClick={() => quickAction(key)}
                          className={[
                            'flex flex-col items-center gap-1 border py-2 transition-colors',
                            danger
                              ? 'border-status-error/25 text-status-error hover:border-status-error/60 hover:bg-status-error/10'
                              : 'border-line text-fg-muted hover:border-white/25 hover:bg-elevated hover:text-fg',
                          ].join(' ')}
                        >
                          <Icon size={13} />
                          <span className="mono text-[8px] uppercase tracking-wider">{label}</span>
                        </motion.button>
                      )
                    })}
                  </div>
                </div>

                {/* app quick-launch */}
                <div>
                  <Label className="text-fg-muted">Launch App</Label>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {GRID_APPS.slice(0, 8).map((app) => (
                      <motion.button
                        key={app.name}
                        type="button"
                        whileHover={{ scale: 1.12 }}
                        whileTap={{ scale: 0.9 }}
                        title={app.name}
                        onClick={() => phoneRef.current?.launchApp(app.name)}
                        className="flex h-8 w-8 items-center justify-center text-[9px] font-bold text-white"
                        style={{
                          borderRadius: 8,
                          background: app.bg,
                          border: app.border ? `1px solid ${app.border}` : 'none',
                          color: app.textColor ?? '#fff',
                        }}
                      >
                        {app.abbr}
                      </motion.button>
                    ))}
                  </div>
                </div>

                {/* send text */}
                <div>
                  <Label className="text-fg-muted">Send Text</Label>
                  <div className="mt-2 flex gap-1.5">
                    <input
                      value={sendText}
                      onChange={(e) => setSendText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && sendText.trim()) {
                          push('info', `send text: "${sendText.trim()}"`)
                          setSendText('')
                        }
                      }}
                      placeholder="Type to device…"
                      className="mono h-8 min-w-0 flex-1 border border-line bg-elevated px-2.5 text-[11px] text-fg-secondary placeholder-white/20 outline-none transition-colors focus:border-[var(--accent-border)]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!sendText.trim()) return
                        push('info', `send text: "${sendText.trim()}"`)
                        setSendText('')
                      }}
                      className="flex h-8 w-9 items-center justify-center border border-line text-fg-muted transition-colors hover:border-white/25 hover:text-fg"
                      aria-label="Send text"
                    >
                      <Send size={13} />
                    </button>
                  </div>
                </div>

                {/* group reassignment */}
                <div>
                  <Label className="text-fg-muted">Group</Label>
                  <select
                    value={device.group}
                    onChange={(e) => safe(client.assignGroup([device.id], e.target.value), 'Could not reassign group')}
                    aria-label="Device group"
                    className="mono mt-2 h-8 w-full rounded-control border border-line bg-elevated px-2 text-[12px] text-fg-secondary outline-none focus:border-accent/40"
                  >
                    {groupOptions.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* telemetry grid */}
            <div className="grid grid-cols-3 gap-x-4 border-b border-line px-5 py-3">
              <Cell label="Status" value={meta.label} color={meta.color} />
              <Cell label="Model" value={`${device.model} · ${device.osVersion}`} />
              <Cell label="Region" value={regionLabel(device.region)} />
              <Cell label="Device ID" value={device.id} />
              <Cell label="Operator" value={device.assignedUser ?? 'Unassigned'} />
              <Cell
                label="Job"
                value={job ? `${job.type.toUpperCase()} · ${Math.round(job.progress * 100)}%` : '—'}
              />
            </div>

            {/* actions */}
            <div className="flex flex-wrap gap-2 border-b border-line px-5 py-3">
              {canStart ? (
                <Button size="sm" variant="outline" onClick={() => safe(client.start(device.id), 'Could not start device')}>
                  <Play size={13} /> Start
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => safe(client.stop(device.id), 'Could not stop device')}>
                  <Square size={12} /> Stop
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={device.status !== 'online'}
                onClick={() => safe(client.runTask(device.id, { type: 'upload', label: 'Manual upload' }), 'Could not assign task')}
              >
                <Send size={13} /> Assign
              </Button>
              <Button size="sm" variant="outline" onClick={() => openSubmit()}>
                <Zap size={13} /> Run Automation
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!device.jobId}
                title={device.jobId ? 'Open the jobs pipeline' : 'No job running on this device'}
                onClick={() => { onClose(); setView('jobs') }}
              >
                <Briefcase size={13} /> View Job
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled
                title="Requires backend employee-assignment support (services/team.ts)"
              >
                <UserPlus size={13} /> Assign Employee
              </Button>
              <Button size="sm" variant="outline" onClick={copyId}>
                {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy ID'}
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  if (confirmDestructive && !window.confirm(`Retire ${device.name}? This removes it from the pool.`)) return
                  safe(client.delete(device.id), 'Could not retire device')
                }}
              >
                <Trash2 size={13} /> Retire
              </Button>
            </div>

            {/* live log */}
            <div className="flex items-center justify-between border-b border-line px-5 py-2.5">
              <Label className="text-fg-secondary">Live Log</Label>
              <span className="mono text-[10px] text-fg-muted">{logs.length} LINES</span>
            </div>
            <div className="h-56">
              <LogStream lines={logs} />
            </div>
          </div>
        </>
        )
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          <Label className="text-fg-muted">Device Retired</Label>
          <p className="mono text-xs text-fg-muted">{deviceId}</p>
          <Button size="sm" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      )}
    </div>
  )
}

/** Panel shell — slides in once and stays mounted while the selection moves
 *  between phones (content cross-fades). NON-MODAL: no backdrop, the graph
 *  behind stays fully interactive (pan/zoom/select). */
function DrawerPanel({ deviceId, onClose }: { deviceId: string; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  // Escape closes — unless pinned (the graph's own Escape handler also
  // respects the pin through closeDrawer guards upstream).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !useUIStore.getState().drawerPinned) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <motion.div
      ref={panelRef}
      role="dialog"
      aria-label={`Device ${deviceId}`}
      tabIndex={-1}
      className="scan-sweep fixed right-0 top-0 z-40 flex h-full w-[580px] max-w-[96vw] flex-col overflow-hidden border-l border-line bg-panel shadow-[-24px_0_60px_-30px_rgba(0,0,0,0.8)] outline-none"
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ duration: 0.3, ease: EXPO_OUT }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={deviceId}
          className="relative flex h-full min-h-0 flex-col"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
        >
          <DrawerContent deviceId={deviceId} onClose={onClose} />
        </motion.div>
      </AnimatePresence>
    </motion.div>
  )
}

/** Right slide-over: the shared device sidebar used by both fleet views — a
 *  live mini control-center with quick controls, app launch, telemetry, and
 *  the device's log stream. */
export function DeviceDrawer() {
  const deviceId = useUIStore((s) => s.drawerDeviceId)
  const closeDrawer = useUIStore((s) => s.closeDrawer)
  return (
    <AnimatePresence>
      {deviceId && <DrawerPanel key="device-drawer" deviceId={deviceId} onClose={closeDrawer} />}
    </AnimatePresence>
  )
}

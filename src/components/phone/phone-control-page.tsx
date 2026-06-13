import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, useMotionValue, useSpring, useReducedMotion } from 'framer-motion'
import {
  ChevronLeft, ChevronRight, AlertTriangle,
  Lock, Home, CornerDownLeft, Grid2x2,
  Camera, RefreshCw, Power,
  Send, Copy, X, Rocket, FileText,
  Video, Zap, Shield, BatteryMedium, Gauge, Anchor,
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Crosshair,
} from 'lucide-react'
import type { AppDef } from '@/components/phone/app-catalog'
import { LivePhone, type LivePhoneHandle } from '@/components/phone/live-phone'
import type { LogLevel } from '@/hooks/use-device-log'
import { useFleet } from '@/hooks/use-fleet'
import { STATUS } from '@/lib/status'
import { useUIStore } from '@/state/ui-store'
import { useSettings } from '@/state/settings-store'
import { useActingEmployee, useScopedDevices } from '@/lib/authorization/use-access'
import { canActOnPhone, can } from '@/lib/authorization'
import { AccessDenied } from '@/components/access/Can'
import { logAudit } from '@/services/audit'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 9) }
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

const MOCK_SESSIONS = [
  { date: 'Today, 09:14', duration: '1h 23m', operator: 'M. Chen' },
  { date: 'Today, 07:52', duration: '0h 47m', operator: 'J. Rivera' },
  { date: 'Yesterday, 22:10', duration: '2h 05m', operator: 'M. Chen' },
  { date: 'Yesterday, 18:33', duration: '0h 31m', operator: 'K. Park' },
]

const MOCK_LOGS = [
  '[09:14:02] SYS  Device stream initialised',
  '[09:14:03] SYS  Control channel established',
  '[09:14:05] CMD  Screen unlocked',
  '[09:14:06] SYS  Session ready · latency 38ms',
  '[09:15:12] CMD  Launched: Instagram',
  '[09:15:44] GES  Gesture: Tap at (188,422)',
  '[09:16:03] GES  Gesture: Swipe UP',
  '[09:18:55] CMD  Screenshot captured',
  '[09:20:01] SYS  FPS stabilised at 18',
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
  const [quality, setQuality]       = useState(defaultQuality)
  const [fps, setFps]               = useState(defaultFps)
  const [confirmingReboot, setConfirmingReboot] = useState(false)
  const [gesture, setGesture]       = useState('tap')
  const [sendText, setSendText]     = useState('')
  const [notes, setNotes]           = useState('')
  const [activeTab, setActiveTab]   = useState<'apps'|'automations'|'sessions'|'logs'>('apps')
  const [logs, setLogs]             = useState<LogEntry[]>(() => MOCK_LOGS.map(t => ({
    id: uid(), ts: new Date(Date.now() - Math.random() * 600000), type: 'system' as const, text: t
  })))

  // Live telemetry
  const [latency, setLatency] = useState(41)
  const [liveFps, setLiveFps] = useState(18)
  const logRef = useRef<HTMLDivElement>(null)
  const phoneRef = useRef<LivePhoneHandle>(null)

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
    const id1 = setInterval(() => setLatency(v => Math.min(80, Math.max(20, v + (Math.random() - 0.5) * 14))), 1200)
    const id2 = setInterval(() => setLiveFps(v => Math.min(32, Math.max(15, v + (Math.random() - 0.5) * 3 | 0))), 2000)
    return () => { clearInterval(id1); clearInterval(id2) }
  }, [])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs, activeTab])

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

  // Command lifecycle against the simulated stream: dispatch → ack.
  const dispatchCommand = (label: string, ack: string) => {
    addLog(`→ ${label} dispatched`)
    setTimeout(() => addLog(`✓ ${ack}`, 'screenshot'), 450)
  }

  const denyAction = (need: string) => {
    addLog(`✗ Action blocked — requires ${need} permission`, 'error')
    logAudit({ actor: employee.name, action: 'phone.command', target: device.name, detail: `denied: ${need}`, result: 'denied' })
  }

  const runQuick = (key: string) => {
    const p = phoneRef.current
    switch (key) {
      case 'lock': case 'home': case 'back': case 'switcher': case 'restart':
        if (!canControl) { denyAction('phone control'); return }
        if (key === 'lock') p?.lock()
        else if (key === 'home') p?.home()
        else if (key === 'back') p?.back()
        else if (key === 'switcher') p?.switcher()
        else dispatchCommand('Restart stream', 'Stream re-established')
        break
      case 'screenshot':
        if (!canScreenshot) { denyAction('screenshot'); return }
        p?.screenshot()
        break
      case 'reboot':
        if (!canReboot) { denyAction('reboot'); return }
        if (confirmDestructive && !confirmingReboot) {
          setConfirmingReboot(true)
          setTimeout(() => setConfirmingReboot(false), 3000)
          return
        }
        setConfirmingReboot(false)
        dispatchCommand('Device reboot', 'Reboot accepted — device restarting')
        logAudit({ actor: employee.name, action: 'phone.rebooted', target: device.name, result: 'success' })
        break
    }
  }

  // Body-level handler so the JSX array below never reads phoneRef during render.
  const captureScreenshot = () => phoneRef.current?.screenshot()

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
              <DPadButton disabled={readOnly} className="col-start-2" icon={<ArrowUp size={15} />} label="Swipe up" onClick={() => phoneRef.current?.swipe('up')} />
              <DPadButton disabled={readOnly} className="col-start-1 row-start-2" icon={<ArrowLeft size={15} />} label="Swipe left" onClick={() => phoneRef.current?.swipe('left')} />
              <DPadButton
                disabled={readOnly}
                className="col-start-2 row-start-2"
                icon={<Crosshair size={15} />}
                label="Tap center"
                center
                onClick={() => phoneRef.current?.tapCenter()}
              />
              <DPadButton disabled={readOnly} className="col-start-3 row-start-2" icon={<ArrowRight size={15} />} label="Swipe right" onClick={() => phoneRef.current?.swipe('right')} />
              <DPadButton disabled={readOnly} className="col-start-2 row-start-3" icon={<ArrowDown size={15} />} label="Swipe down" onClick={() => phoneRef.current?.swipe('down')} />
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
                onClick={() => { if (!canControl) { denyAction('phone control'); return } addLog(`Send text: "${sendText}"`); setSendText('') }}
                disabled={!canControl}
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
              <span className="text-[11px] text-white/40 uppercase tracking-wider">LATENCY</span>
              <span className="font-mono text-[12px] font-bold tabular-nums" style={{ color: latColor }}>{Math.round(latency)}ms</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Gauge size={11} className="text-white/35" />
              <span className="text-[11px] text-white/40 uppercase tracking-wider">FPS</span>
              <span className="font-mono text-[12px] font-bold text-white tabular-nums">{liveFps}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Shield size={11} className="text-white/35" />
              <span className="text-[11px] text-white/40 uppercase tracking-wider">STREAM</span>
              <span className="font-mono text-[12px] text-green-400">Stable</span>
            </div>
            <div className="flex items-center gap-1.5">
              <BatteryMedium size={11} className="text-white/35" />
              <span className="text-[11px] text-white/40 uppercase tracking-wider">BATTERY</span>
              <span className="font-mono text-[12px] text-white tabular-nums">{device.battery}%</span>
            </div>
            <div className="w-px h-4 bg-white/[0.08]" />
            {/* Stabilize: stops decorative body tilt — screen controls unaffected */}
            <button
              type="button"
              aria-pressed={stabilizePhone}
              title={stabilizePhone ? 'Phone motion is stabilized — click to enable tilt' : 'Stabilize phone (stop tilt motion)'}
              onClick={() => {
                const next = !stabilizePhone
                updateSettings({ stabilizePhone: next })
                addLog(next ? 'Phone motion stabilized' : 'Phone motion enabled')
              }}
              className={[
                'flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] uppercase tracking-wider transition-colors',
                stabilizePhone
                  ? 'bg-[var(--accent-soft)] text-[var(--accent-text)] border border-[var(--accent-border)]'
                  : 'text-white/40 border border-white/[0.08] hover:text-white/70',
              ].join(' ')}
            >
              <Anchor size={11} />
              {stabilizePhone ? 'Stabilized' : 'Stabilize'}
            </button>
          </div>

          {/* Read-only banner — viewer/scoped user without control permission */}
          {readOnly && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2">
              <Lock size={13} className="text-amber-400" />
              <span className="text-[11px] text-amber-200/90">View only — you don’t have control permission for this phone.</span>
            </div>
          )}

          {/* Live interactive phone — dominant object, subtle cursor tilt */}
          <PhoneStage statusColor={meta.color} stabilized={stabilizePhone}>
            <div className="hud-corners p-5" style={{ ['--hud-c' as string]: `${meta.color}55`, ['--hud-len' as string]: '16px' }}>
              <LivePhone
                ref={phoneRef}
                device={device}
                job={job}
                width={330}
                gesture={gesture}
                readOnly={readOnly}
                onLog={phoneLog}
              />
            </div>
          </PhoneStage>

          {/* Bottom action bar */}
          <div className="flex gap-2 mt-5">
            <button
              onClick={() => { if (!canControl) { denyAction('phone control'); return } phoneRef.current?.launchApp('Instagram') }}
              disabled={!canControl}
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
                  disabled={!need}
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
                        onClick={() => { if (!canControl) { denyAction('phone control'); return } phoneRef.current?.launchApp(app.name) }}
                        disabled={!canControl}
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

              {/* Sessions tab */}
              {activeTab === 'sessions' && (
                <div className="flex flex-col gap-2">
                  {MOCK_SESSIONS.map((s, i) => (
                    <div key={i} className="p-2.5 rounded-lg border border-white/[0.06]">
                      <div className="flex justify-between items-center">
                        <span className="text-[11px] text-white/70">{s.date}</span>
                        <span className="font-mono text-[10px] text-[#2dd4bf]">{s.duration}</span>
                      </div>
                      <span className="text-[10px] text-white/35">{s.operator}</span>
                    </div>
                  ))}
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

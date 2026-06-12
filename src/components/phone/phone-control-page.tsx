import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  Lock, Unlock, Home, CornerDownLeft, Grid2x2,
  Camera, RefreshCw, Power, Volume2, VolumeX,
} from 'lucide-react'
import { useFleet } from '@/hooks/use-fleet'
import { useUIStore } from '@/state/ui-store'

// ─── Types ────────────────────────────────────────────────────────────────────
interface LogEntry {
  id: string
  ts: Date
  type: 'command' | 'gesture' | 'screenshot' | 'error' | 'system'
  text: string
  typeLabel: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(d: Date) {
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
function uid() { return Math.random().toString(36).slice(2, 9) }

const LOG_COLORS: Record<LogEntry['type'], string> = {
  command:    'var(--accent-blue)',
  gesture:    'var(--accent-amber)',
  screenshot: 'var(--accent-green)',
  error:      'var(--accent-red)',
  system:     'rgba(255,255,255,0.35)',
}

// ─── Live stat ────────────────────────────────────────────────────────────────
function LiveStat({ label, unit, min, max, decimals = 0, flashColor }: {
  label: string; unit: string; min: number; max: number; decimals?: number; flashColor?: string
}) {
  const [val, setVal] = useState(min + Math.random() * (max - min))
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    const id = setInterval(() => {
      setVal(v => {
        const d = (Math.random() - 0.5) * (max - min) * 0.15
        return Math.min(max, Math.max(min, v + d))
      })
      setFlash(true)
      setTimeout(() => setFlash(false), 400)
    }, 1200)
    return () => clearInterval(id)
  }, [min, max])
  const color = flashColor
    ? (val < min + (max - min) * 0.5 ? 'var(--accent-green)' : val < min + (max - min) * 0.8 ? 'var(--accent-amber)' : 'var(--accent-red)')
    : 'rgba(255,255,255,0.8)'
  return (
    <div className="flex flex-col gap-1 p-2.5" style={{ border: '1px solid rgba(255,255,255,0.06)', background: '#0a0a0a' }}>
      <span className="mono text-[8px] uppercase tracking-[0.15em]" style={{ color: 'rgba(255,255,255,0.3)' }}>{label}</span>
      <span
        className="mono text-sm font-bold tabular-nums transition-colors duration-300"
        style={{ color: flash ? 'rgba(255,255,255,0.9)' : color }}
      >
        {val.toFixed(decimals)} <span className="text-[9px] font-normal opacity-50">{unit}</span>
      </span>
    </div>
  )
}

// ─── Mock phone screen ─────────────────────────────────────────────────────────
const MOCK_APPS = [
  { name: 'Instagram', bg: 'linear-gradient(135deg,#833ab4,#fd1d1d,#fcb045)' },
  { name: 'Camera',    bg: '#1a1a1a', border: 'rgba(255,255,255,0.15)' },
  { name: 'Safari',    bg: 'linear-gradient(135deg,#0080ff,#00c6ff)' },
  { name: 'Messages',  bg: '#22c55e' },
  { name: 'TikTok',    bg: '#000', border: '#ff0050' },
  { name: 'Settings',  bg: '#636366' },
  { name: 'Maps',      bg: 'linear-gradient(135deg,#34c759,#007aff)' },
  { name: 'X',         bg: '#000', border: 'rgba(255,255,255,0.2)' },
  { name: 'Mail',      bg: '#0a84ff' },
  { name: 'Music',     bg: 'linear-gradient(135deg,#ff2d55,#ff9500)' },
  { name: 'Photos',    bg: 'linear-gradient(135deg,#ff9500,#ff2d55,#af52de,#32ade6)' },
  { name: 'WhatsApp',  bg: '#25d366' },
  { name: 'Chrome',    bg: 'linear-gradient(135deg,#4285f4,#ea4335)' },
  { name: 'Telegram',  bg: '#2aabee' },
  { name: 'YT',        bg: '#ff0000' },
  { name: 'Spotify',   bg: '#1db954' },
  { name: 'Amazon',    bg: '#ff9900' },
  { name: 'Discord',   bg: '#5865f2' },
  { name: 'Snapchat',  bg: '#fffc00', textColor: '#000' },
  { name: 'LinkedIn',  bg: '#0077b5' },
]

function PhoneScreen() {
  const [tilt, setTilt] = useState({ x: 0, y: 0 })
  const frameRef = useRef<HTMLDivElement>(null)

  function handleMouseMove(e: React.MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const mx = (e.clientX - cx) / (r.width / 2)
    const my = (e.clientY - cy) / (r.height / 2)
    setTilt({ x: my * -6, y: mx * 6 })
  }

  return (
    <div
      ref={frameRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setTilt({ x: 0, y: 0 })}
      style={{
        perspective: '1000px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      {/* Phone outer frame */}
      <motion.div
        animate={{ rotateX: tilt.x, rotateY: tilt.y }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        style={{
          width: 240,
          border: '1px solid rgba(255,255,255,0.15)',
          background: '#050505',
          padding: '6px',
          boxShadow: '0 0 60px rgba(0,0,0,0.8), inset 0 0 20px rgba(255,255,255,0.02)',
        }}
      >
        {/* Status bar */}
        <div className="flex items-center justify-between px-3 py-1.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <span className="mono text-[8px] text-white/70 font-bold">09:41</span>
          <span className="mono text-[8px] text-white/50">●●●●● WiFi 🔋91%</span>
        </div>

        {/* App grid */}
        <div className="grid grid-cols-4 gap-1.5 p-2">
          {MOCK_APPS.slice(0, 16).map((app) => (
            <div key={app.name} className="flex flex-col items-center gap-0.5">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-[7px] font-bold"
                style={{
                  background: app.bg,
                  border: app.border ? `1px solid ${app.border}` : 'none',
                  color: app.textColor ?? 'white',
                }}
              >
                {app.name.slice(0, 2).toUpperCase()}
              </div>
              <span className="mono text-[6px] text-white/50 text-center leading-tight">{app.name}</span>
            </div>
          ))}
        </div>

        {/* Dock */}
        <div
          className="flex items-center justify-around px-3 py-2 mx-1 mb-1"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          {MOCK_APPS.slice(16, 20).map((app) => (
            <div key={app.name} className="flex flex-col items-center gap-0.5">
              <div
                className="w-9 h-9 rounded-xl"
                style={{ background: app.bg, border: app.border ? `1px solid ${app.border}` : 'none' }}
              />
            </div>
          ))}
        </div>
      </motion.div>

      {/* Live label */}
      <div className="flex items-center gap-2 mt-3">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 status-dot-pulse" />
        <span className="mono text-[9px] text-white/40 uppercase tracking-widest">LIVE FEED · 1080p · H.264</span>
      </div>
    </div>
  )
}

// ─── Session timer ─────────────────────────────────────────────────────────────
function SessionTimer() {
  const [sec, setSec] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setSec(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return (
    <span className="mono text-[11px] text-white/40 tabular-nums">
      {String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
    </span>
  )
}

// ─── Uptime timer ─────────────────────────────────────────────────────────────
function UptimeDisplay() {
  const [sec, setSec] = useState(Math.floor(Math.random() * 7200))
  useEffect(() => {
    const id = setInterval(() => setSec(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return (
    <div className="flex flex-col gap-1 p-2.5" style={{ border: '1px solid rgba(255,255,255,0.06)', background: '#0a0a0a' }}>
      <span className="mono text-[8px] uppercase tracking-[0.15em]" style={{ color: 'rgba(255,255,255,0.3)' }}>UPTIME</span>
      <span className="mono text-sm font-bold tabular-nums" style={{ color: 'rgba(255,255,255,0.8)' }}>
        {String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
      </span>
    </div>
  )
}

// ─── Card wrapper ──────────────────────────────────────────────────────────────
function TelCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid rgba(255,255,255,0.08)', background: '#0a0a0a' }}>
      <div className="px-3 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span className="mono text-[9px] uppercase tracking-[0.18em]" style={{ color: 'rgba(255,255,255,0.3)' }}>{title}</span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────
export function PhoneControlPage() {
  const snapshot = useFleet()
  const { devices } = snapshot
  const phoneControlDeviceId = useUIStore(s => s.phoneControlDeviceId)
  const closePhoneControl    = useUIStore(s => s.closePhoneControl)

  const device = phoneControlDeviceId
    ? devices.find(d => d.id === phoneControlDeviceId) ?? null
    : devices[0] ?? null

  const [qualityIdx, setQualityIdx] = useState(0)
  const [fpsIdx, setFpsIdx]         = useState(1)
  const [latency, setLatency]       = useState(34)
  const [logs, setLogs]             = useState<LogEntry[]>(() => [
    { id: uid(), ts: new Date(Date.now() - 8000), type: 'system',     typeLabel: 'SYS',     text: 'Device stream initialised' },
    { id: uid(), ts: new Date(Date.now() - 5000), type: 'system',     typeLabel: 'SYS',     text: 'Proxy tunnel established' },
    { id: uid(), ts: new Date(Date.now() - 2000), type: 'command',    typeLabel: 'CMD',     text: 'Screen unlocked' },
    { id: uid(), ts: new Date(Date.now() - 800),  type: 'system',     typeLabel: 'SYS',     text: 'Session ready' },
  ])

  const logRef = useRef<HTMLDivElement>(null)

  const addLog = useCallback((type: LogEntry['type'], typeLabel: string, text: string) => {
    setLogs(l => [...l, { id: uid(), ts: new Date(), type, typeLabel, text }].slice(-200))
  }, [])

  // Latency jitter
  useEffect(() => {
    const id = setInterval(() => setLatency(l => Math.min(120, Math.max(12, l + (Math.random() - 0.5) * 20))), 1200)
    return () => clearInterval(id)
  }, [])

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  if (!device) return (
    <div className="flex h-full items-center justify-center bg-black">
      <span className="mono text-[11px] text-white/20 uppercase tracking-widest">NO DEVICE SELECTED</span>
    </div>
  )

  const QUALITY_OPTIONS = ['ULTRA', 'HIGH', 'MED', 'LOW']
  const FPS_OPTIONS     = ['60', '30', '24', '15']

  const latColor = latency < 50 ? 'var(--accent-green)' : latency < 100 ? 'var(--accent-amber)' : 'var(--accent-red)'

  const quickControls = [
    { label: 'LOCK',   icon: <Lock size={13} />,           type: 'command' as const, text: 'Screen locked' },
    { label: 'UNLOCK', icon: <Unlock size={13} />,         type: 'command' as const, text: 'Screen unlocked' },
    { label: 'HOME',   icon: <Home size={13} />,           type: 'command' as const, text: 'Home button pressed' },
    { label: 'BACK',   icon: <CornerDownLeft size={13} />, type: 'command' as const, text: 'Back pressed' },
    { label: 'APPS',   icon: <Grid2x2 size={13} />,        type: 'command' as const, text: 'App switcher opened' },
    { label: 'SHOT',   icon: <Camera size={13} />,         type: 'screenshot' as const, text: 'Screenshot captured' },
    { label: 'STREAM', icon: <RefreshCw size={13} />,      type: 'command' as const, text: 'Stream restarted' },
    { label: 'REBOOT', icon: <Power size={13} />,          type: 'error' as const,   text: 'Device reboot sent', danger: true },
    { label: 'VOL+',   icon: <Volume2 size={13} />,        type: 'command' as const, text: 'Volume up' },
    { label: 'VOL-',   icon: <VolumeX size={13} />,        type: 'command' as const, text: 'Volume down' },
  ]

  const gestures = ['TAP', 'DBL TAP', 'SWIPE↑', 'SWIPE↓', 'SWIPE←', 'SWIPE→', 'PINCH', 'HOLD']

  const statusColor =
    device.status === 'busy'    ? 'var(--status-busy)' :
    device.status === 'online'  ? 'var(--status-online)' :
    device.status === 'offline' ? 'var(--status-offline)' : 'var(--status-warming)'

  return (
    <div className="flex flex-col h-full bg-black">
      {/* ── Header bar ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3 flex-shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', background: '#000' }}>
        <div className="flex items-center gap-4">
          <button
            onClick={closePhoneControl}
            className="mono text-[10px] uppercase tracking-widest text-white/30 hover:text-white/70 transition-colors flex items-center gap-1.5"
          >
            ← FLEET
          </button>
          <div className="w-px h-4 bg-white/[0.08]" />
          <span className="mono text-sm font-bold tracking-widest text-white uppercase">{device.name}</span>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full status-dot-pulse" style={{ background: statusColor }} />
            <span className="mono text-[9px] uppercase tracking-widest" style={{ color: statusColor }}>{device.status.toUpperCase()}</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="mono text-[9px] text-white/25 uppercase tracking-widest">SESSION</span>
            <SessionTimer />
          </div>
          <div className="flex items-center gap-1">
            {[1,2,3,4].map(i => (
              <div key={i} className="rounded-sm" style={{ width: 3, height: 4 + i * 3, background: i <= 3 ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.15)' }} />
            ))}
          </div>
        </div>
      </div>

      {/* ── Three-column layout ───────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* LEFT COLUMN — 280px */}
        <div className="w-[280px] shrink-0 flex flex-col gap-3 p-3 overflow-y-auto" style={{ borderRight: '1px solid rgba(255,255,255,0.06)' }}>

          {/* Device Telemetry */}
          <TelCard title="DEVICE TELEMETRY">
            <div className="flex flex-col gap-0">
              {[
                { label: 'MODEL',    value: device.model },
                { label: 'OS',       value: device.osVersion },
                { label: 'REGION',   value: device.region },
                { label: 'GROUP',    value: device.group },
                { label: 'PROXY',    value: device.proxy.split(':')[0] },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between items-center py-1.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <span className="mono text-[9px] uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.3)' }}>{label}</span>
                  <span className="mono text-[10px]" style={{ color: 'rgba(255,255,255,0.75)' }}>{value}</span>
                </div>
              ))}
              {/* Battery */}
              <div className="flex items-center justify-between py-2">
                <span className="mono text-[9px] uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.3)' }}>BATTERY</span>
                <div className="flex items-center gap-2">
                  <div className="w-16 h-0.5 overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                    <div className="h-full" style={{
                      width: device.battery + '%',
                      background: device.battery > 30 ? 'var(--accent-green)' : 'var(--accent-red)',
                    }} />
                  </div>
                  <span className="mono text-[10px]" style={{ color: device.battery > 30 ? 'var(--accent-green)' : 'var(--accent-red)' }}>{device.battery}%</span>
                </div>
              </div>
            </div>
          </TelCard>

          {/* Stream Config */}
          <TelCard title="STREAM CONFIG">
            <div className="mb-3">
              <p className="mono text-[8px] text-white/25 mb-1.5 tracking-wider">QUALITY</p>
              <div className="flex gap-1">
                {QUALITY_OPTIONS.map((q, i) => (
                  <button
                    key={q}
                    onClick={() => setQualityIdx(i)}
                    className="mono text-[9px] px-2 py-1 flex-1 tracking-wider transition-colors"
                    style={{
                      background: qualityIdx === i ? 'rgba(255,255,255,0.9)' : 'transparent',
                      color: qualityIdx === i ? '#000' : 'rgba(255,255,255,0.35)',
                      border: `1px solid ${qualityIdx === i ? 'transparent' : 'rgba(255,255,255,0.12)'}`,
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mono text-[8px] text-white/25 mb-1.5 tracking-wider">FPS</p>
              <div className="flex gap-1">
                {FPS_OPTIONS.map((f, i) => (
                  <button
                    key={f}
                    onClick={() => setFpsIdx(i)}
                    className="mono text-[9px] px-2 py-1 flex-1 tracking-wider transition-colors"
                    style={{
                      background: fpsIdx === i ? 'rgba(255,255,255,0.9)' : 'transparent',
                      color: fpsIdx === i ? '#000' : 'rgba(255,255,255,0.35)',
                      border: `1px solid ${fpsIdx === i ? 'transparent' : 'rgba(255,255,255,0.12)'}`,
                    }}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
          </TelCard>

          {/* Quick Controls */}
          <TelCard title="QUICK CONTROLS">
            <div className="grid grid-cols-5 gap-1">
              {quickControls.map(({ label, icon, type, text, danger }) => (
                <button
                  key={label}
                  onClick={() => addLog(type, type === 'command' ? 'CMD' : type === 'screenshot' ? 'CAP' : type.toUpperCase(), text)}
                  className="flex flex-col items-center gap-1 py-2 px-1 transition-all duration-100 group"
                  style={{
                    border: `1px solid ${danger ? 'rgba(255,59,59,0.25)' : 'rgba(255,255,255,0.08)'}`,
                    background: 'transparent',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = danger ? 'rgba(255,59,59,0.1)' : 'rgba(255,255,255,0.05)'; (e.currentTarget as HTMLElement).style.borderColor = danger ? 'rgba(255,59,59,0.6)' : 'rgba(255,255,255,0.3)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.borderColor = danger ? 'rgba(255,59,59,0.25)' : 'rgba(255,255,255,0.08)' }}
                >
                  <span style={{ color: danger ? 'var(--accent-red)' : 'rgba(255,255,255,0.6)' }}>{icon}</span>
                  <span className="mono text-[7px] uppercase tracking-wider" style={{ color: danger ? 'var(--accent-red)' : 'rgba(255,255,255,0.3)' }}>{label}</span>
                </button>
              ))}
            </div>
          </TelCard>
        </div>

        {/* CENTER COLUMN */}
        <div className="flex-1 flex flex-col items-center justify-center gap-5 overflow-y-auto py-6">
          <PhoneScreen />

          {/* Gesture controls */}
          <div className="flex flex-wrap justify-center gap-1.5 max-w-xs">
            {gestures.map(g => (
              <button
                key={g}
                onClick={() => addLog('gesture', 'GESTURE', `Gesture: ${g}`)}
                className="mono text-[9px] uppercase tracking-wider px-2.5 py-1.5 transition-all duration-100"
                style={{ border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.4)', background: 'transparent' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.9)'; (e.currentTarget as HTMLElement).style.color = '#000'; (e.currentTarget as HTMLElement).style.borderColor = 'transparent' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.4)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.12)' }}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        {/* RIGHT COLUMN — 300px */}
        <div className="w-[300px] shrink-0 flex flex-col" style={{ borderLeft: '1px solid rgba(255,255,255,0.06)' }}>

          {/* Command Log */}
          <div className="flex-1 flex flex-col min-h-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <span className="mono text-[9px] uppercase tracking-[0.18em]" style={{ color: 'rgba(255,255,255,0.3)' }}>COMMAND LOG</span>
            </div>
            <div
              ref={logRef}
              className="flex-1 overflow-y-auto p-3 flex flex-col gap-0.5"
              style={{ background: '#000', fontFamily: 'ui-monospace, monospace' }}
            >
              {logs.map(entry => (
                <div key={entry.id} className="flex items-start gap-2 text-[10px] leading-relaxed">
                  <span style={{ color: 'rgba(255,255,255,0.2)' }} className="shrink-0">[{fmt(entry.ts)}]</span>
                  <span className="shrink-0 w-[52px]" style={{ color: LOG_COLORS[entry.type] }}>{entry.typeLabel}</span>
                  <span style={{ color: 'rgba(255,255,255,0.6)' }}>{entry.text}</span>
                </div>
              ))}
              <div className="flex items-center gap-1 mt-1">
                <span style={{ color: 'rgba(255,255,255,0.4)' }} className="mono text-[10px]">▋</span>
              </div>
            </div>
          </div>

          {/* Stream Telemetry */}
          <div className="flex-shrink-0">
            <div className="px-3 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <span className="mono text-[9px] uppercase tracking-[0.18em]" style={{ color: 'rgba(255,255,255,0.3)' }}>STREAM TELEMETRY</span>
            </div>
            <div className="grid grid-cols-2 gap-0 p-2" style={{ gap: '4px' }}>
              <div className="flex flex-col gap-1 p-2.5" style={{ border: '1px solid rgba(255,255,255,0.06)', background: '#0a0a0a' }}>
                <span className="mono text-[8px] uppercase tracking-[0.15em]" style={{ color: 'rgba(255,255,255,0.3)' }}>RESOLUTION</span>
                <span className="mono text-sm font-bold" style={{ color: 'rgba(255,255,255,0.8)' }}>1920×1080</span>
              </div>
              <div className="flex flex-col gap-1 p-2.5" style={{ border: '1px solid rgba(255,255,255,0.06)', background: '#0a0a0a' }}>
                <span className="mono text-[8px] uppercase tracking-[0.15em]" style={{ color: 'rgba(255,255,255,0.3)' }}>CODEC</span>
                <span className="mono text-sm font-bold" style={{ color: 'rgba(255,255,255,0.8)' }}>H.264</span>
              </div>
              <LiveStat label="BITRATE" unit="Kbps" min={1200} max={2400} />
              <LiveStat label="FRAMERATE" unit="fps" min={28} max={32} />
              <div className="flex flex-col gap-1 p-2.5" style={{ border: '1px solid rgba(255,255,255,0.06)', background: '#0a0a0a' }}>
                <span className="mono text-[8px] uppercase tracking-[0.15em]" style={{ color: 'rgba(255,255,255,0.3)' }}>LATENCY</span>
                <span className="mono text-sm font-bold tabular-nums transition-colors duration-300" style={{ color: latColor }}>{Math.round(latency)}ms</span>
              </div>
              <UptimeDisplay />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

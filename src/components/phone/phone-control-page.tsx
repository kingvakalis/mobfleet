import { useState, useEffect, useRef, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft, Lock, Unlock, Home, CornerDownLeft, Grid2x2,
  Camera, RefreshCw, Power, Volume2, VolumeX, Wifi,
  Battery, Signal, Cpu, Activity, ChevronUp, ChevronDown,
  ChevronLeft, ChevronRight, ZoomIn, Clock, MousePointer,
} from 'lucide-react'
import { useFleet } from '@/hooks/use-fleet'
import { useUIStore } from '@/state/ui-store'

// ─── Types ────────────────────────────────────────────────────────────────────
interface LogEntry {
  id: string
  ts: Date
  type: 'command' | 'gesture' | 'screenshot' | 'error' | 'system'
  icon: React.ReactNode
  text: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(d: Date) {
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
function uid() { return Math.random().toString(36).slice(2, 9) }

const LOG_TYPE_COLOR: Record<LogEntry['type'], string> = {
  command:    'text-blue-400',
  gesture:    'text-purple-400',
  screenshot: 'text-green-400',
  error:      'text-red-400',
  system:     'text-white/40',
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function GlassCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-white/[0.06] bg-white/[0.02] backdrop-blur p-4 ${className}`}>
      {children}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-widest text-white/30 mb-3">{children}</p>
}

function BatteryBar({ pct }: { pct: number }) {
  const color = pct > 50 ? '#22c55e' : pct > 20 ? '#f59e0b' : '#ef4444'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[11px] font-mono text-white/50">{pct}%</span>
    </div>
  )
}

function SliderRow({ label, value, options, onChange }: {
  label: string; value: number; options: (string | number)[]; onChange: (i: number) => void
}) {
  return (
    <div className="mb-3">
      <div className="flex justify-between mb-1.5">
        <span className="text-[10px] text-white/40">{label}</span>
        <span className="text-[10px] font-mono text-white/60">{options[value]}</span>
      </div>
      <input
        type="range" min={0} max={options.length - 1} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-indigo-500 h-1 cursor-pointer"
      />
      <div className="flex justify-between mt-1">
        {options.map((o, i) => (
          <span key={i} className={`text-[9px] ${i === value ? 'text-indigo-400' : 'text-white/20'}`}>{o}</span>
        ))}
      </div>
    </div>
  )
}

function LatencyBadge({ ms }: { ms: number }) {
  const color = ms < 50 ? 'text-green-400 bg-green-400/10' : ms < 100 ? 'text-yellow-400 bg-yellow-400/10' : 'text-red-400 bg-red-400/10'
  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-mono ${color}`}>
      <Activity size={10} />
      {ms}ms
    </div>
  )
}

function QuickBtn({ icon, label, onClick, danger = false }: {
  icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-colors ${
        danger
          ? 'border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/15'
          : 'border-white/[0.06] bg-white/[0.02] text-white/50 hover:bg-white/[0.08] hover:text-white/80'
      }`}
    >
      {icon}
      <span className="text-[9px] leading-none">{label}</span>
    </button>
  )
}

// ─── iPhone Frame ─────────────────────────────────────────────────────────────
interface Ripple { id: string; x: number; y: number }

function IPhoneFrame({ onAction }: { onAction: (text: string) => void }) {
  const [tilt, setTilt] = useState({ x: 0, y: 0 })
  const [ripples, setRipples] = useState<Ripple[]>([])
  const frameRef = useRef<HTMLDivElement>(null)

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!frameRef.current) return
    const rect = frameRef.current.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const dx = (e.clientX - cx) / (rect.width / 2)
    const dy = (e.clientY - cy) / (rect.height / 2)
    setTilt({ x: dy * -8, y: dx * 8 })
  }

  const handleMouseLeave = () => setTilt({ x: 0, y: 0 })

  const handleScreenClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const id = uid()
    setRipples(r => [...r, { id, x, y }])
    setTimeout(() => setRipples(r => r.filter(rr => rr.id !== id)), 700)
    onAction('Screen tap')
  }

  const apps = [
    { name: 'Instagram', color: '#E1306C', bg: 'from-purple-600 to-pink-500' },
    { name: 'Camera', color: '#fff', bg: 'from-slate-600 to-slate-800' },
    { name: 'Settings', color: '#8E8E93', bg: 'from-slate-500 to-slate-700' },
    { name: 'Photos', color: '#fff', bg: 'from-yellow-400 to-orange-400' },
    { name: 'Safari', color: '#006CFF', bg: 'from-blue-500 to-cyan-500' },
    { name: 'Messages', color: '#34C759', bg: 'from-green-500 to-emerald-500' },
    { name: 'Maps', color: '#fff', bg: 'from-green-600 to-teal-600' },
    { name: 'Music', color: '#fff', bg: 'from-red-500 to-pink-600' },
    { name: 'TikTok', color: '#fff', bg: 'from-black to-slate-900' },
    { name: 'Twitter', color: '#1DA1F2', bg: 'from-sky-500 to-blue-600' },
    { name: 'YouTube', color: '#FF0000', bg: 'from-red-600 to-red-800' },
    { name: 'WhatsApp', color: '#25D366', bg: 'from-green-600 to-emerald-700' },
  ]

  return (
    <div className="flex flex-col items-center gap-6">
      {/* Phone frame */}
      <div
        ref={frameRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{
          transform: `perspective(800px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
          transition: tilt.x === 0 && tilt.y === 0 ? 'transform 0.5s ease' : 'transform 0.1s ease',
          filter: 'drop-shadow(0 32px 48px rgba(0,0,0,0.8))',
        }}
        className="relative select-none"
      >
        {/* Phone body */}
        <div className="relative w-[260px] rounded-[40px] bg-[#1a1a1e] border-[3px] border-[#3a3a3c] overflow-hidden"
          style={{ height: 530 }}>
          {/* Notch */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-28 h-7 bg-[#1a1a1e] rounded-b-2xl z-20" />

          {/* Status bar */}
          <div className="relative z-10 flex justify-between items-center px-6 pt-2 pb-1 text-white text-[11px] font-semibold">
            <span className="font-mono">9:41</span>
            <div className="flex items-center gap-1">
              <Signal size={12} />
              <Wifi size={12} />
              <Battery size={14} />
            </div>
          </div>

          {/* Screen – clickable */}
          <div
            className="relative mx-2 rounded-[24px] overflow-hidden cursor-pointer"
            style={{ height: 460, background: 'linear-gradient(135deg, #1c1c2e 0%, #0f0f1e 100%)' }}
            onClick={handleScreenClick}
          >
            {/* Wallpaper gradient */}
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-900/40 via-purple-900/20 to-blue-900/40" />

            {/* App grid */}
            <div className="relative z-10 grid grid-cols-4 gap-3 p-4 pt-6">
              {apps.map(app => (
                <div key={app.name} className="flex flex-col items-center gap-1">
                  <div className={`w-12 h-12 rounded-[14px] bg-gradient-to-br ${app.bg} flex items-center justify-center shadow-lg`}>
                    <span className="text-[8px] font-bold text-white/80">{app.name.slice(0, 2).toUpperCase()}</span>
                  </div>
                  <span className="text-[8px] text-white/60 truncate max-w-[52px] text-center">{app.name}</span>
                </div>
              ))}
            </div>

            {/* Dock */}
            <div className="absolute bottom-3 left-3 right-3 flex justify-around rounded-2xl bg-white/10 backdrop-blur py-2">
              {['Phone', 'Mail', 'Maps', 'Clock'].map(a => (
                <div key={a} className="w-11 h-11 rounded-[13px] bg-white/10 flex items-center justify-center">
                  <span className="text-[7px] font-bold text-white/50">{a.slice(0,2).toUpperCase()}</span>
                </div>
              ))}
            </div>

            {/* Ripples */}
            {ripples.map(r => (
              <motion.div
                key={r.id}
                className="absolute rounded-full border border-white/60 pointer-events-none"
                style={{ left: r.x - 15, top: r.y - 15, width: 30, height: 30 }}
                initial={{ opacity: 1, scale: 0.2 }}
                animate={{ opacity: 0, scale: 2.5 }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
              />
            ))}
          </div>

          {/* Home indicator */}
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-28 h-1 rounded-full bg-white/30" />
        </div>

        {/* Side buttons */}
        <div className="absolute left-[-5px] top-24 w-1.5 h-8 bg-[#3a3a3c] rounded-l-sm" />
        <div className="absolute left-[-5px] top-36 w-1.5 h-10 bg-[#3a3a3c] rounded-l-sm" />
        <div className="absolute left-[-5px] top-48 w-1.5 h-10 bg-[#3a3a3c] rounded-l-sm" />
        <div className="absolute right-[-5px] top-28 w-1.5 h-14 bg-[#3a3a3c] rounded-r-sm" />
      </div>

      {/* Shadow */}
      <div className="w-48 h-4 rounded-full bg-black/60 blur-xl -mt-2" />

      {/* Gesture buttons */}
      <div className="flex flex-wrap gap-2 justify-center max-w-sm">
        {[
          { label: 'Tap', icon: <MousePointer size={11} /> },
          { label: 'Double Tap', icon: <MousePointer size={11} /> },
          { label: 'Swipe Up', icon: <ChevronUp size={11} /> },
          { label: 'Swipe Down', icon: <ChevronDown size={11} /> },
          { label: 'Swipe Left', icon: <ChevronLeft size={11} /> },
          { label: 'Swipe Right', icon: <ChevronRight size={11} /> },
          { label: 'Pinch', icon: <ZoomIn size={11} /> },
          { label: 'Long Press', icon: <Clock size={11} /> },
        ].map(g => (
          <button
            key={g.label}
            onClick={() => onAction(`Gesture: ${g.label}`)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-purple-500/30 bg-purple-500/10 text-purple-300 text-[11px] hover:bg-purple-500/20 transition-colors"
          >
            {g.icon} {g.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Animated stream stat ──────────────────────────────────────────────────────
function LiveStat({ label, unit, min, max, decimals = 0 }: {
  label: string; unit: string; min: number; max: number; decimals?: number
}) {
  const [val, setVal] = useState(min + Math.random() * (max - min))
  useEffect(() => {
    const id = setInterval(() => {
      setVal(v => {
        const d = (Math.random() - 0.5) * (max - min) * 0.15
        return Math.min(max, Math.max(min, v + d))
      })
    }, 800)
    return () => clearInterval(id)
  }, [min, max])
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-white/[0.04] last:border-0">
      <span className="text-[11px] text-white/40">{label}</span>
      <span className="font-mono text-[11px] text-white/70">{val.toFixed(decimals)} {unit}</span>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────
export function PhoneControlPage() {
  const { devices } = useFleet()
  const phoneControlDeviceId = useUIStore(s => s.phoneControlDeviceId)
  const closePhoneControl    = useUIStore(s => s.closePhoneControl)

  const device = devices.find(d => d.id === phoneControlDeviceId) ?? devices[0]

  const [qualityIdx, setQualityIdx] = useState(2)
  const [fpsIdx, setFpsIdx]         = useState(2)
  const [latency, setLatency]       = useState(34)
  const [logs, setLogs]             = useState<LogEntry[]>(() => [
    { id: uid(), ts: new Date(Date.now() - 8000), type: 'system',  icon: <Cpu size={10} />,      text: 'Device stream initialised' },
    { id: uid(), ts: new Date(Date.now() - 5000), type: 'system',  icon: <Wifi size={10} />,     text: 'Proxy tunnel established' },
    { id: uid(), ts: new Date(Date.now() - 2000), type: 'command', icon: <Lock size={10} />,     text: 'Screen unlocked' },
    { id: uid(), ts: new Date(Date.now() - 800),  type: 'system',  icon: <Activity size={10} />, text: 'Session ready' },
  ])

  const logRef = useRef<HTMLDivElement>(null)

  const addLog = useCallback((type: LogEntry['type'], icon: React.ReactNode, text: string) => {
    setLogs(l => [{ id: uid(), ts: new Date(), type, icon, text }, ...l].slice(0, 200))
  }, [])

  // Latency jitter
  useEffect(() => {
    const id = setInterval(() => setLatency(l => Math.min(120, Math.max(12, l + (Math.random() - 0.5) * 20))), 1200)
    return () => clearInterval(id)
  }, [])

  if (!device) return null

  const quickControls = [
    { label: 'Lock',     icon: <Lock size={13} />,        type: 'command' as const, text: 'Screen locked' },
    { label: 'Unlock',   icon: <Unlock size={13} />,      type: 'command' as const, text: 'Screen unlocked' },
    { label: 'Home',     icon: <Home size={13} />,        type: 'command' as const, text: 'Home button pressed' },
    { label: 'Back',     icon: <CornerDownLeft size={13}/>,type: 'command' as const, text: 'Back pressed' },
    { label: 'Apps',     icon: <Grid2x2 size={13} />,     type: 'command' as const, text: 'App switcher opened' },
    { label: 'Shot',     icon: <Camera size={13} />,      type: 'screenshot' as const, text: 'Screenshot captured' },
    { label: 'Stream',   icon: <RefreshCw size={13} />,   type: 'command' as const, text: 'Stream restarted' },
    { label: 'Reboot',   icon: <Power size={13} />,       type: 'command' as const, text: 'Device reboot sent', danger: true },
    { label: 'Vol+',     icon: <Volume2 size={13} />,     type: 'command' as const, text: 'Volume up' },
    { label: 'Vol-',     icon: <VolumeX size={13} />,     type: 'command' as const, text: 'Volume down' },
  ]

  const statusColor = device.status === 'busy' ? '#22c55e' : device.status === 'online' ? '#818cf8' : '#f59e0b'

  return (
    <div className="flex flex-col h-full" style={{ background: '#080810' }}>
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-3 border-b border-white/[0.06] flex-shrink-0">
        <button
          onClick={closePhoneControl}
          className="flex items-center gap-2 text-white/40 hover:text-white/80 transition-colors text-sm"
        >
          <ArrowLeft size={16} /> Back
        </button>
        <div className="w-px h-4 bg-white/10" />
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: statusColor }} />
          <span className="font-semibold text-white">{device.name}</span>
          <span className="text-white/30 text-sm">·</span>
          <span className="text-white/40 text-sm font-mono">{device.id}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <LatencyBadge ms={Math.round(latency)} />
        </div>
      </div>

      {/* 3-column layout */}
      <div className="flex flex-1 gap-4 p-4 overflow-hidden min-h-0">

        {/* LEFT COLUMN */}
        <div className="flex flex-col gap-3 overflow-y-auto" style={{ width: 260, flexShrink: 0 }}>
          {/* Device Info */}
          <GlassCard>
            <SectionTitle>Device Info</SectionTitle>
            <p className="font-semibold text-white text-sm mb-1 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ background: statusColor }} />
              {device.name}
            </p>
            <div className="space-y-1.5 mt-3">
              {[
                ['Model', 'iPhone 14 Pro'],
                ['OS', 'iOS 17.2'],
                ['Status', device.status],
                ['Region', device.region ?? 'US-East'],
                ['Proxy', device.proxy.split(':')[0]],
                ['Group', device.group ?? 'Default'],
                ['User', device.assignedUser ?? '—'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <span className="text-[11px] text-white/30">{k}</span>
                  <span className="text-[11px] font-mono text-white/60 text-right max-w-[130px] truncate">{v}</span>
                </div>
              ))}
              <div className="pt-1">
                <div className="flex justify-between mb-1">
                  <span className="text-[11px] text-white/30">Battery</span>
                </div>
                <BatteryBar pct={device.battery} />
              </div>
            </div>
          </GlassCard>

          {/* Quality Settings */}
          <GlassCard>
            <SectionTitle>Quality Settings</SectionTitle>
            <SliderRow
              label="Quality" value={qualityIdx}
              options={['Low', 'Medium', 'High', 'Ultra']}
              onChange={i => { setQualityIdx(i); addLog('command', <Activity size={10} />, `Quality set to ${['Low','Medium','High','Ultra'][i]}`) }}
            />
            <SliderRow
              label="FPS" value={fpsIdx}
              options={[15, 24, 30, 60]}
              onChange={i => { setFpsIdx(i); addLog('command', <Activity size={10} />, `FPS set to ${[15,24,30,60][i]}`) }}
            />
            <div className="flex justify-between items-center mt-2">
              <span className="text-[10px] text-white/30">Latency</span>
              <LatencyBadge ms={Math.round(latency)} />
            </div>
          </GlassCard>

          {/* Quick Controls */}
          <GlassCard>
            <SectionTitle>Quick Controls</SectionTitle>
            <div className="grid grid-cols-5 gap-1.5">
              {quickControls.map(c => (
                <QuickBtn
                  key={c.label}
                  icon={c.icon}
                  label={c.label}
                  danger={c.danger}
                  onClick={() => addLog(c.type, c.icon, c.text)}
                />
              ))}
            </div>
          </GlassCard>
        </div>

        {/* CENTER COLUMN */}
        <div className="flex-1 flex items-center justify-center overflow-y-auto">
          <IPhoneFrame onAction={text => addLog('gesture', <MousePointer size={10} />, text)} />
        </div>

        {/* RIGHT COLUMN */}
        <div className="flex flex-col gap-3" style={{ width: 300, flexShrink: 0 }}>
          {/* Session Log */}
          <GlassCard className="flex-1 flex flex-col min-h-0">
            <SectionTitle>Session Log</SectionTitle>
            <div ref={logRef} className="flex-1 overflow-y-auto space-y-1 min-h-0 pr-1">
              <AnimatePresence initial={false}>
                {logs.map(entry => (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                    className="flex items-start gap-2 py-1 border-b border-white/[0.03]"
                  >
                    <span className={`mt-0.5 flex-shrink-0 ${LOG_TYPE_COLOR[entry.type]}`}>{entry.icon}</span>
                    <div className="min-w-0">
                      <p className="text-[10px] font-mono text-white/25">{fmt(entry.ts)}</p>
                      <p className={`text-[11px] leading-tight ${LOG_TYPE_COLOR[entry.type]}`}>{entry.text}</p>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </GlassCard>

          {/* Stream Info */}
          <GlassCard>
            <SectionTitle>Stream Info</SectionTitle>
            <div className="flex justify-between items-center py-1.5 border-b border-white/[0.04]">
              <span className="text-[11px] text-white/40">Resolution</span>
              <span className="font-mono text-[11px] text-white/70">1920×1080</span>
            </div>
            <div className="flex justify-between items-center py-1.5 border-b border-white/[0.04]">
              <span className="text-[11px] text-white/40">Codec</span>
              <span className="font-mono text-[11px] text-white/70">H.264</span>
            </div>
            <LiveStat label="Bitrate" unit="Kbps" min={1200} max={2400} />
            <LiveStat label="Frame Rate" unit="fps" min={28} max={32} decimals={1} />
            <LiveStat label="Latency" unit="ms" min={20} max={80} />
          </GlassCard>
        </div>
      </div>
    </div>
  )
}

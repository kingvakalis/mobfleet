import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  ChevronLeft, ChevronRight, AlertTriangle,
  Lock, Home, CornerDownLeft, Grid2x2,
  Camera, RefreshCw, Power,
  Send, Copy, X, Maximize2, Rocket, FileText,
  Video,
} from 'lucide-react'
import { useFleet } from '@/hooks/use-fleet'
import { useUIStore } from '@/state/ui-store'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 9) }
function fmt(d: Date) {
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

interface LogEntry {
  id: string; ts: Date; type: 'command'|'gesture'|'screenshot'|'error'|'system'; text: string
}

// ─── App icon definitions ─────────────────────────────────────────────────────
const GRID_APPS = [
  { name: 'Messages',  abbr: 'Me', bg: '#22c55e' },
  { name: 'Safari',    abbr: 'Sa', bg: 'linear-gradient(135deg,#0ea5e9,#2dd4bf)' },
  { name: 'Instagram', abbr: 'In', bg: 'linear-gradient(135deg,#833ab4,#fd1d1d,#fcb045)' },
  { name: 'TikTok',    abbr: 'Ti', bg: '#000', border: '#ff0050' },
  { name: 'Telegram',  abbr: 'Te', bg: '#2aabee' },
  { name: 'WhatsApp',  abbr: 'Wh', bg: '#25d366' },
  { name: 'Facebook',  abbr: 'Fb', bg: '#1877f2' },
  { name: 'Photos',    abbr: 'Ph', bg: 'linear-gradient(135deg,#ff9500,#ff2d55,#af52de,#32ade6)' },
  { name: 'Settings',  abbr: 'Se', bg: '#636366' },
  { name: 'Mail',      abbr: 'Ma', bg: '#0a84ff' },
  { name: 'Notes',     abbr: 'No', bg: '#ffd60a', textColor: '#000' },
  { name: 'Files',     abbr: 'Fi', bg: '#1d6ce6' },
]
const DOCK_APPS = [
  { name: 'Phone',    abbr: 'Ph', bg: '#22c55e' },
  { name: 'Safari',   abbr: 'Sa', bg: '#0a84ff' },
  { name: 'Messages', abbr: 'Me', bg: '#22c55e' },
  { name: 'Music',    abbr: 'Mu', bg: 'linear-gradient(135deg,#ff2d55,#ff9500)' },
]

const INSTALLED_APPS = [
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
  '[09:14:03] SYS  Proxy tunnel established — 10.0.0.0:8080',
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

// ─── iPhone Mockup ────────────────────────────────────────────────────────────
function iPhoneMockup() {
  return (
    <div className="relative" style={{
      width: 260,
      background: '#0d0d0d',
      border: '2px solid #1a1a1a',
      borderRadius: 36,
      boxShadow: '0 24px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.07)',
      overflow: 'hidden',
    }}>
      {/* Fullscreen icon */}
      <button className="absolute top-3 right-3 z-10 p-1 rounded opacity-40 hover:opacity-80 transition-opacity" style={{ background: 'rgba(255,255,255,0.08)' }}>
        <Maximize2 size={12} color="white" />
      </button>

      {/* iOS status bar */}
      <div className="flex items-center justify-between px-5 pt-3 pb-1">
        <span className="text-white text-[12px] font-semibold" style={{ fontFamily: 'system-ui' }}>9:41</span>
        <div className="flex items-center gap-1.5">
          {/* Signal bars */}
          <div className="flex items-end gap-[2px]">
            {[3,5,7,9].map((h, i) => (
              <div key={i} className="w-[3px] rounded-sm" style={{ height: h, background: i < 3 ? 'white' : 'rgba(255,255,255,0.3)' }} />
            ))}
          </div>
          {/* WiFi */}
          <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
            <path d="M7 8.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z" fill="white"/>
            <path d="M4 6.5C4.9 5.6 5.9 5 7 5s2.1.6 3 1.5" stroke="white" strokeWidth="1.2" strokeLinecap="round" fill="none"/>
            <path d="M1.5 4C3 2.5 5 1.5 7 1.5s4 1 5.5 2.5" stroke="white" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.5"/>
          </svg>
          {/* Battery */}
          <div className="flex items-center gap-[1px]">
            <div className="rounded-sm border border-white/60" style={{ width: 20, height: 10, padding: 1.5, boxSizing: 'border-box' }}>
              <div className="h-full rounded-sm bg-white" style={{ width: '30%' }} />
            </div>
            <div className="rounded-sm bg-white/50" style={{ width: 2, height: 5 }} />
          </div>
        </div>
      </div>

      {/* Dynamic Island */}
      <div className="flex justify-center mb-2">
        <div className="rounded-full bg-black" style={{ width: 88, height: 26 }} />
      </div>

      {/* App grid */}
      <div className="grid grid-cols-4 gap-y-3 gap-x-2 px-4 pb-3">
        {GRID_APPS.map(app => (
          <div key={app.name} className="flex flex-col items-center gap-1">
            <div className="w-[52px] h-[52px] rounded-2xl flex items-center justify-center text-[10px] font-bold"
              style={{ background: app.bg, border: (app as any).border ? `1.5px solid ${(app as any).border}` : 'none', color: (app as any).textColor ?? 'white', fontSize: 11 }}>
              {app.abbr}
            </div>
            <span className="text-[9px] text-white/50 text-center leading-tight truncate w-full text-center">{app.name}</span>
          </div>
        ))}
      </div>

      {/* Dock */}
      <div className="mx-4 mb-3 px-3 py-2 rounded-2xl flex items-center justify-around"
        style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}>
        {DOCK_APPS.map(app => (
          <div key={app.name} className="flex flex-col items-center gap-1">
            <div className="w-[50px] h-[50px] rounded-2xl flex items-center justify-center text-[10px] font-bold text-white"
              style={{ background: app.bg }}>
              {app.abbr}
            </div>
          </div>
        ))}
      </div>

      {/* Home indicator */}
      <div className="flex justify-center pb-2">
        <div className="rounded-full bg-white/30" style={{ width: 100, height: 4 }} />
      </div>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────
export function PhoneControlPage() {
  const { devices } = useFleet()
  const phoneControlDeviceId = useUIStore(s => s.phoneControlDeviceId)
  const closePhoneControl    = useUIStore(s => s.closePhoneControl)

  // Device navigation
  const initialIndex = Math.max(0, devices.findIndex(d => d.id === phoneControlDeviceId))
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const device = devices[currentIndex] ?? devices[0] ?? null

  // UI state
  const [quality, setQuality]       = useState(22)
  const [fps, setFps]               = useState(18)
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

  const addLog = useCallback((text: string, type: LogEntry['type'] = 'command') => {
    setLogs(l => [...l, { id: uid(), ts: new Date(), type, text }].slice(-500))
  }, [])

  useEffect(() => {
    const id1 = setInterval(() => setLatency(v => Math.min(80, Math.max(20, v + (Math.random() - 0.5) * 14))), 1200)
    const id2 = setInterval(() => setLiveFps(v => Math.min(32, Math.max(15, v + (Math.random() - 0.5) * 3 | 0))), 2000)
    return () => { clearInterval(id1); clearInterval(id2) }
  }, [])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs, activeTab])

  if (!device) return (
    <div className="flex h-full items-center justify-center bg-[#0a0b0e]">
      <span className="mono text-[11px] text-white/20 uppercase tracking-widest">NO DEVICE SELECTED</span>
    </div>
  )

  const GESTURES = ['Tap','Precise Tap','Double Tap','Long Press','Swipe','Scroll','Pinch / Rotate']
  const latColor = latency < 50 ? '#4ade80' : latency < 70 ? '#fbbf24' : '#f87171'

  const quickControls = [
    { label: 'Lock',       icon: <Lock size={18} />,           action: () => addLog('Lock button pressed') },
    { label: 'Home',       icon: <Home size={18} />,           action: () => addLog('Home button pressed') },
    { label: 'Back',       icon: <CornerDownLeft size={18} />, action: () => addLog('Back pressed') },
    { label: 'Switcher',   icon: <Grid2x2 size={18} />,        action: () => addLog('App switcher opened') },
    { label: 'Screenshot', icon: <Camera size={18} />,         action: () => addLog('Screenshot captured', 'screenshot') },
    { label: 'Restart',    icon: <RefreshCw size={18} />,      action: () => addLog('Stream restarted') },
    { label: 'Reboot',     icon: <Power size={18} />,          action: () => addLog('Device reboot sent', 'error'), danger: true },
  ]

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
                <div className="w-1.5 h-1.5 rounded-full bg-green-400" style={{ boxShadow: '0 0 4px #4ade80' }} />
                <span className="text-[10px] text-green-400">Online</span>
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
                { label: 'STATUS',   value: 'Online' },
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
              {/* Proxy IP - clickable */}
              <div className="flex justify-between items-center py-1.5">
                <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.35)' }}>PROXY IP</span>
                <button
                  className="font-mono text-[11px] text-[#2dd4bf] hover:text-[#5eead4] transition-colors"
                  onClick={() => { navigator.clipboard?.writeText('10.0.0.0'); addLog('Copied proxy IP: 10.0.0.0') }}
                  title="Click to copy"
                >
                  10.0.0.0
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
                onClick={() => { addLog(`Send text: "${sendText}"`); setSendText('') }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium text-[#0d1117] transition-colors hover:bg-[#5eead4]"
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
              <div className="w-2 h-2 rounded-full bg-green-400" style={{ boxShadow: '0 0 5px #4ade80' }} />
              <span className="text-[11px] text-green-400">Online</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-white/40 uppercase tracking-wider">⚡ LATENCY</span>
              <span className="font-mono text-[12px] font-bold tabular-nums" style={{ color: latColor }}>{Math.round(latency)}ms</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-white/40 uppercase tracking-wider">📷 FPS</span>
              <span className="font-mono text-[12px] font-bold text-white">{liveFps}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-white/40 uppercase tracking-wider">🛡 PROXY</span>
              <span className="font-mono text-[12px] text-green-400">Healthy</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-white/40 uppercase tracking-wider">🔋 BATTERY</span>
              <span className="font-mono text-[12px] text-white">{device.battery}%</span>
            </div>
          </div>

          {/* iPhone */}
          {iPhoneMockup()}

          {/* Bottom action bar */}
          <div className="flex gap-2 mt-5">
            <button
              onClick={() => addLog('Launching app...')}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[12px] font-medium text-[#0d1117] hover:bg-[#5eead4] transition-colors"
              style={{ background: '#2dd4bf' }}
            >
              <Rocket size={14} />Launch App
            </button>
            {[
              { label: 'Screenshot', icon: <Camera size={14} />, action: () => addLog('Screenshot captured', 'screenshot') },
              { label: 'Record',     icon: <Video size={14} />,  action: () => addLog('Recording started') },
              { label: 'Open Logs',  icon: <FileText size={14} />, action: () => setActiveTab('logs') },
              { label: 'Restart Stream', icon: <RefreshCw size={14} />, action: () => addLog('Stream restarted') },
            ].map(({ label, icon, action }) => (
              <button
                key={label}
                onClick={action}
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-[12px] text-white/70 border border-white/[0.12] hover:border-white/30 hover:text-white transition-colors"
              >
                {icon}{label}
              </button>
            ))}
          </div>
        </div>

        {/* ── RIGHT COLUMN (300px) ──────────────────────────────────────────── */}
        <div className="w-[300px] shrink-0 flex flex-col gap-3 p-3 overflow-y-auto" style={{ borderLeft: '1px solid rgba(255,255,255,0.06)' }}>

          {/* Quick Controls */}
          <Card title="Quick Controls">
            <div className="grid grid-cols-4 gap-2">
              {quickControls.map(({ label, icon, action, danger }) => (
                <button
                  key={label}
                  onClick={action}
                  className="flex flex-col items-center gap-1.5 py-3 rounded-lg border transition-all"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    borderColor: danger ? 'rgba(248,113,113,0.25)' : 'rgba(255,255,255,0.08)',
                    color: danger ? '#f87171' : 'rgba(255,255,255,0.6)',
                  }}
                  onMouseEnter={e => {
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
              ))}
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
                        style={{ background: app.bg, border: (app as any).border ? `1px solid ${(app as any).border}` : 'none' }}>
                        {app.abbr}
                      </div>
                      <span className="text-[11px] text-white/70 truncate flex-1">{app.name}</span>
                      <button
                        onClick={() => addLog(`Launched: ${app.name}`)}
                        className="text-[10px] text-[#2dd4bf] hover:text-[#5eead4] shrink-0 transition-colors px-1 py-0.5 rounded hover:border hover:border-[#2dd4bf]/40"
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

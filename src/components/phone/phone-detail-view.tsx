import { useState, useEffect, useRef } from 'react'
import {
  ChevronLeft, ChevronRight, AlertTriangle,
  Lock, Home, ArrowLeft, Grid, Camera, RotateCcw, Power,
  Crosshair, MousePointerClick, Timer, Move, ZoomIn,
  Send, Copy, Eraser, Play, ScrollText,
  Battery, Wifi, Signal, Circle,
} from 'lucide-react'
import { phones, buildLogs, type LogLevel, statusMeta } from '@/lib/fleet-data'
import { useUIStore } from '@/state/ui-store'

interface Props { deviceId: string; onClose: () => void }
type Tab = 'Apps' | 'Automations' | 'Sessions' | 'Logs'

const APPS = [
  { name: 'Instagram', color: '#e1306c', emoji: '📷' },
  { name: 'TikTok',    color: '#010101', emoji: '🎵' },
  { name: 'Telegram',  color: '#2aabee', emoji: '✈️' },
  { name: 'WhatsApp',  color: '#25d366', emoji: '💬' },
  { name: 'Facebook',  color: '#1877f2', emoji: '👤' },
  { name: 'Safari',    color: '#1d9bf0', emoji: '🧭' },
  { name: 'Settings',  color: '#8e8e93', emoji: '⚙️' },
  { name: 'Photos',    color: '#f5a623', emoji: '🖼️' },
  { name: 'Messages',  color: '#34c759', emoji: '💬' },
  { name: 'Mail',      color: '#0a84ff', emoji: '✉️' },
  { name: 'Notes',     color: '#ffd60a', emoji: '📝' },
  { name: 'Files',     color: '#1d9bf0', emoji: '📁' },
]

const QUICK_CONTROLS = [
  { label: 'Lock',       Icon: Lock },
  { label: 'Home',       Icon: Home },
  { label: 'Back',       Icon: ArrowLeft },
  { label: 'Apps',       Icon: Grid },
  { label: 'Screenshot', Icon: Camera },
  { label: 'Restart',    Icon: RotateCcw },
  { label: 'Reboot',     Icon: Power },
]

const GESTURES = [
  { label: 'Tap',         Icon: MousePointerClick },
  { label: 'Precise Tap', Icon: Crosshair },
  { label: 'Double Tap',  Icon: MousePointerClick },
  { label: 'Long Press',  Icon: Timer },
  { label: 'Swipe',       Icon: Move },
  { label: 'Scroll',      Icon: ScrollText },
  { label: 'Pinch',       Icon: ZoomIn },
]

const LOG_COLORS: Record<LogLevel, string> = {
  INFO:  'text-white/40',
  WARN:  'text-yellow-400',
  ERROR: 'text-red-400',
  OK:    'text-emerald-400',
}
const LOG_BG: Record<LogLevel, string> = {
  INFO:  'bg-white/[0.04] text-white/35',
  WARN:  'bg-yellow-400/10 text-yellow-400',
  ERROR: 'bg-red-400/10 text-red-400',
  OK:    'bg-emerald-400/10 text-emerald-400',
}

export function PhoneDetailView({ deviceId }: Props) {
  const [tab, setTab]         = useState<Tab>('Apps')
  const [logs, setLogs]       = useState(() => buildLogs(30))
  const [text, setText]       = useState('')
  const [quality, setQuality] = useState(80)
  const [fps, setFps]         = useState(30)
  const [phoneIndex, setPhoneIndex] = useState(() => {
    const idx = phones.findIndex(p => p.id === deviceId)
    return idx >= 0 ? idx : 0
  })
  const logRef = useRef<HTMLDivElement>(null)
  const setView = useUIStore(s => s.setView)

  const phone = phones[phoneIndex] ?? phones[0]
  const meta  = statusMeta[phone.status]

  useEffect(() => {
    const iv = setInterval(() => setLogs(prev => [...prev.slice(-80), ...buildLogs(1)]), 3500)
    return () => clearInterval(iv)
  }, [])
  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight) }, [logs])

  const TABS: Tab[] = ['Apps', 'Automations', 'Sessions', 'Logs']

  return (
    <div className="flex h-full bg-[#0a0a0f] overflow-hidden">
      {/* ── Left Column ────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 w-[220px] shrink-0 overflow-y-auto p-4 border-r border-white/[0.06]">
        {/* Device Info */}
        <section className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 flex flex-col gap-2">
          <h3 className="text-[10px] uppercase tracking-widest text-white/30 font-medium">Device Info</h3>
          {([
            ['Name',    phone.name],
            ['Model',   phone.model],
            ['OS',      phone.os],
            ['Status',  phone.status],
            ['Battery', phone.battery + '%'],
            ['Region',  phone.region],
            ['Proxy',   phone.proxyIp],
            ['Group',   phone.group],
            ['User',    phone.assignedUser],
          ] as [string, string][]).map(([k, v]) => (
            <div key={k} className="flex justify-between text-xs">
              <span className="text-white/30">{k}</span>
              <span className="text-white/65 font-mono text-right max-w-[110px] truncate">{v}</span>
            </div>
          ))}
        </section>

        {/* Quality */}
        <section className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 flex flex-col gap-3">
          <h3 className="text-[10px] uppercase tracking-widest text-white/30 font-medium">Quality</h3>
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-[10px] text-white/40">
              <span>Quality</span><span>{quality}%</span>
            </div>
            <input type="range" min={10} max={100} value={quality} onChange={e => setQuality(+e.target.value)}
              className="w-full h-1 appearance-none bg-white/10 rounded cursor-pointer accent-indigo-500" />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-[10px] text-white/40">
              <span>FPS</span><span>{fps}</span>
            </div>
            <input type="range" min={5} max={60} value={fps} onChange={e => setFps(+e.target.value)}
              className="w-full h-1 appearance-none bg-white/10 rounded cursor-pointer accent-indigo-500" />
          </div>
          <div className="flex justify-between text-[10px] text-white/40">
            <span>Latency</span>
            <span className="text-emerald-400">42ms</span>
          </div>
        </section>

        {/* Quick Controls */}
        <section className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 flex flex-col gap-2">
          <h3 className="text-[10px] uppercase tracking-widest text-white/30 font-medium">Quick Controls</h3>
          <div className="grid grid-cols-2 gap-1">
            {QUICK_CONTROLS.map(({ label, Icon }) => (
              <button key={label} className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.09] text-[10px] text-white/50 hover:text-white/80 transition-colors">
                <Icon size={11} />{label}
              </button>
            ))}
          </div>
        </section>

        {/* Gestures */}
        <section className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 flex flex-col gap-2">
          <h3 className="text-[10px] uppercase tracking-widest text-white/30 font-medium">Gestures</h3>
          <div className="grid grid-cols-2 gap-1">
            {GESTURES.map(({ label, Icon }) => (
              <button key={label} className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-white/[0.04] hover:bg-indigo-500/20 hover:text-indigo-300 text-[10px] text-white/50 transition-colors">
                <Icon size={11} />{label}
              </button>
            ))}
          </div>
        </section>

        {/* Send Text */}
        <section className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 flex flex-col gap-2">
          <h3 className="text-[10px] uppercase tracking-widest text-white/30 font-medium">Send Text</h3>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Type message..."
            rows={3}
            className="w-full bg-black/30 border border-white/[0.06] rounded-lg p-2 text-xs text-white/70 placeholder-white/20 outline-none focus:border-indigo-500/50 resize-none"
          />
          <div className="grid grid-cols-3 gap-1">
            {([
              { label: 'Send',  Icon: Send   },
              { label: 'Copy',  Icon: Copy   },
              { label: 'Clear', Icon: Eraser },
            ] as { label: string; Icon: typeof Send }[]).map(({ label, Icon }) => (
              <button key={label} onClick={() => label === 'Clear' && setText('')}
                className="flex items-center justify-center gap-1 py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.09] text-[10px] text-white/50 hover:text-white/80 transition-colors">
                <Icon size={10} />{label}
              </button>
            ))}
          </div>
        </section>
      </div>

      {/* ── Center Column ──────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 items-center overflow-y-auto p-6 gap-4">
        {/* Top bar */}
        <div className="w-full flex items-center justify-between gap-3">
          <button
            onClick={() => setView('phones')}
            className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors"
          >
            <ChevronLeft size={14} /> Phones
          </button>
          <div className="flex items-center gap-2">
            <button onClick={() => setPhoneIndex(i => Math.max(0, i - 1))} className="p-1 rounded hover:bg-white/[0.06] text-white/30 hover:text-white/70 transition-colors">
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs text-white/50 font-mono">{phoneIndex + 1} / {phones.length}</span>
            <button onClick={() => setPhoneIndex(i => Math.min(phones.length - 1, i + 1))} className="p-1 rounded hover:bg-white/[0.06] text-white/30 hover:text-white/70 transition-colors">
              <ChevronRight size={14} />
            </button>
          </div>
          <button className="flex items-center gap-1.5 text-xs text-white/30 hover:text-yellow-400 transition-colors">
            <AlertTriangle size={13} /> Report
          </button>
        </div>

        {/* Status strip */}
        <div className="flex items-center gap-4 px-4 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] w-full">
          <span className="flex items-center gap-1.5 text-xs">
            <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: meta.color }} />
            <span style={{ color: meta.color }}>{meta.label}</span>
          </span>
          <span className="text-xs text-white/40">42ms latency</span>
          <span className="text-xs text-white/40">{fps} FPS</span>
          <span className="text-xs text-white/40">{phone.battery}% batt</span>
          <span className={['text-xs ml-auto', phone.proxyStatus === 'healthy' ? 'text-emerald-400' : 'text-yellow-400'].join(' ')}>
            {phone.proxyStatus === 'healthy' ? '● Proxy OK' : '⚠ Proxy Issue'}
          </span>
        </div>

        {/* iPhone frame */}
        <div className="relative" style={{ width: 280, height: 560 }}>
          <div className="absolute inset-0 rounded-[44px] bg-gradient-to-b from-[#2a2a2a] to-[#1a1a1a] shadow-2xl border border-white/10" />
          <div className="absolute left-[-3px] top-[100px] w-[3px] h-8 rounded-l bg-[#2a2a2a]" />
          <div className="absolute left-[-3px] top-[148px] w-[3px] h-12 rounded-l bg-[#2a2a2a]" />
          <div className="absolute left-[-3px] top-[208px] w-[3px] h-12 rounded-l bg-[#2a2a2a]" />
          <div className="absolute right-[-3px] top-[148px] w-[3px] h-16 rounded-r bg-[#2a2a2a]" />
          <div className="absolute inset-[10px] rounded-[36px] bg-black overflow-hidden">
            {/* Notch */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-28 h-7 bg-black rounded-b-2xl z-20 flex items-center justify-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#1a1a1a]" />
              <div className="w-3 h-3 rounded-full bg-[#1a1a1a]" />
            </div>
            {/* Status bar */}
            <div className="relative z-10 flex items-center justify-between px-6 pt-8 pb-2">
              <span className="text-white text-[11px] font-semibold">9:41</span>
              <div className="flex items-center gap-1">
                <Signal size={10} className="text-white" />
                <Wifi size={10} className="text-white" />
                <Battery size={10} className="text-white" />
              </div>
            </div>
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-900 via-purple-900 to-black opacity-80" />
            <div className="relative z-10 grid grid-cols-4 gap-3 px-4 pt-2">
              {APPS.map(app => (
                <div key={app.name} className="flex flex-col items-center gap-1">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shadow-lg" style={{ background: app.color }}>
                    {app.emoji}
                  </div>
                  <span className="text-white text-[8px] text-center leading-tight drop-shadow">{app.name}</span>
                </div>
              ))}
            </div>
            <div className="absolute bottom-6 left-4 right-4 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/10 p-2 flex justify-around">
              {APPS.slice(0, 4).map(app => (
                <div key={app.name + '-dock'} className="w-12 h-12 rounded-xl flex items-center justify-center text-xl" style={{ background: app.color }}>
                  {app.emoji}
                </div>
              ))}
            </div>
            <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-24 h-1 rounded-full bg-white/40" />
          </div>
          <div className="absolute inset-[10px] rounded-[36px] bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-2 flex-wrap justify-center">
          {([
            { label: 'Launch App', Icon: Play },
            { label: 'Screenshot', Icon: Camera },
            { label: 'Record',     Icon: Circle },
            { label: 'Open Logs',  Icon: ScrollText },
            { label: 'Restart',    Icon: RotateCcw },
          ] as { label: string; Icon: typeof Play }[]).map(({ label, Icon }) => (
            <button key={label} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-xs text-white/60 hover:text-white/90 transition-colors border border-white/[0.05]">
              <Icon size={12} />{label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Right Column ───────────────────────────────────────────────── */}
      <div className="flex flex-col w-[280px] shrink-0 border-l border-white/[0.06] overflow-hidden">
        <div className="p-4 border-b border-white/[0.06]">
          <h3 className="text-[10px] uppercase tracking-widest text-white/30 mb-2">Notes</h3>
          <textarea
            rows={2}
            placeholder="Add notes about this device..."
            className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg p-2 text-xs text-white/60 placeholder-white/20 outline-none focus:border-white/20 resize-none"
          />
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/[0.06]">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                'flex-1 py-2 text-[10px] uppercase tracking-wide transition-colors border-b-2',
                tab === t ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-white/30 hover:text-white/60',
              ].join(' ')}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {tab === 'Apps' && (
            <div className="p-3 grid grid-cols-3 gap-2">
              {APPS.map(app => (
                <button key={app.name} className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-white/[0.05] transition-colors group">
                  <div className="w-10 h-10 rounded-2xl text-lg flex items-center justify-center shadow" style={{ background: app.color }}>
                    {app.emoji}
                  </div>
                  <span className="text-[9px] text-white/45 group-hover:text-white/70">{app.name}</span>
                </button>
              ))}
            </div>
          )}
          {tab === 'Automations' && (
            <div className="p-3 flex flex-col gap-2">
              <div className="px-3 py-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-xs text-indigo-400">
                ● Running: Instagram Warmup
              </div>
              {['Account Check', 'Story View', 'Refresh Session', 'TikTok Warmup'].map(name => (
                <div key={name} className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.05]">
                  <span className="text-xs text-white/60">{name}</span>
                  <button className="p-1 rounded bg-indigo-500/15 text-indigo-400 hover:bg-indigo-500/30 transition-colors">
                    <Play size={10} />
                  </button>
                </div>
              ))}
              <div className="mt-2">
                <h4 className="text-[10px] uppercase tracking-wider text-white/20 mb-2">Recent</h4>
                {['ig-warmup · 2m ago · ✓', 'app-check · 8m ago · ✓', 'story-view · 15m ago · ✓'].map(s => (
                  <div key={s} className="text-[10px] text-white/25 font-mono py-0.5">{s}</div>
                ))}
              </div>
            </div>
          )}
          {tab === 'Sessions' && (
            <div className="p-3 flex flex-col gap-2">
              {[
                { acc: '@carol_official', app: 'Instagram', state: 'Active', color: 'text-emerald-400' },
                { acc: '@carofficial',    app: 'TikTok',    state: 'Active', color: 'text-emerald-400' },
                { acc: 'Session #4',      app: 'Telegram',  state: 'Idle',   color: 'text-white/30' },
              ].map(s => (
                <div key={s.acc} className="px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs text-white/65">{s.acc}</span>
                    <span className={['text-[10px]', s.color].join(' ')}>{s.state}</span>
                  </div>
                  <span className="text-[10px] text-white/30">{s.app}</span>
                </div>
              ))}
            </div>
          )}
          {tab === 'Logs' && (
            <div ref={logRef} className="p-2 font-mono text-[10px] space-y-0.5 overflow-y-auto h-full bg-black/20">
              {logs.map((l, i) => (
                <div key={i} className="flex items-start gap-2 py-0.5">
                  <span className="text-white/15 shrink-0 w-14">{l.ts.split(' ')[0]}</span>
                  <span className={['shrink-0 px-1 rounded text-[8px] font-bold', LOG_BG[l.level]].join(' ')}>{l.level}</span>
                  <span className={LOG_COLORS[l.level]}>{l.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

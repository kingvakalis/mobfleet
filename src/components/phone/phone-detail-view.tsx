import { useState, useEffect, useRef } from 'react'
import {
  Battery, Wifi, Camera, Home, ChevronUp, ChevronDown,
  Lock, RotateCcw, Power, Hand, MousePointerClick, Move,
  Send, Copy, Eraser, Play, History, LayoutGrid,
} from 'lucide-react'
import { buildLogs, type LogLevel, phones } from '@/lib/fleet-data'

interface PhoneDetailViewProps {
  deviceId: string
  onClose: () => void
}

const APPS = [
  { name: 'Instagram', color: '#e1306c' },
  { name: 'TikTok',    color: '#111111' },
  { name: 'Telegram',  color: '#2aabee' },
  { name: 'WhatsApp',  color: '#25d366' },
  { name: 'Facebook',  color: '#1877f2' },
  { name: 'Safari',    color: '#1d9bf0' },
  { name: 'Settings',  color: '#8e8e93' },
  { name: 'Photos',    color: '#f5a623' },
  { name: 'Messages',  color: '#34c759' },
  { name: 'Notes',     color: '#ffd60a' },
  { name: 'Files',     color: '#1d9bf0' },
  { name: 'Mail',      color: '#0a84ff' },
]

const TABS = ['Apps', 'Automations', 'Sessions', 'Logs'] as const
type Tab = typeof TABS[number]

const levelStyle: Record<LogLevel, string> = {
  INFO: 'text-white/35', WARN: 'text-yellow-400', ERROR: 'text-red-400', OK: 'text-emerald-400'
}

export function PhoneDetailView({ deviceId, onClose }: PhoneDetailViewProps) {
  const [tab, setTab] = useState<Tab>('Apps')
  const [logs, setLogs] = useState(() => buildLogs(20))
  const [text, setText] = useState('')
  const logRef = useRef<HTMLDivElement>(null)
  const phone = phones.find(p => p.id === deviceId) ?? phones[0]

  useEffect(() => {
    const iv = setInterval(() => {
      setLogs(prev => [...prev.slice(-60), ...buildLogs(1)])
    }, 4000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight)
  }, [logs])

  return (
    <div className="flex h-full bg-[#0a0a0f] overflow-hidden">
      {/* Left: iPhone + controls */}
      <div className="flex flex-col items-center gap-4 p-6 w-[260px] shrink-0 border-r border-white/[0.06] overflow-y-auto">
        {/* Close */}
        <div className="w-full flex items-center justify-between mb-1">
          <span className="font-mono text-xs text-white/60">{phone.name}</span>
          <button onClick={onClose} className="text-white/25 hover:text-white/70 text-xl leading-none">×</button>
        </div>

        {/* iPhone frame */}
        <div className="relative w-[148px] h-[300px] rounded-[26px] border-2 border-white/25 bg-black overflow-hidden shadow-2xl shrink-0">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-16 h-4 bg-black rounded-b-xl z-10" />
          <div className="flex items-center justify-between px-4 pt-5 pb-1 text-[7px] text-white/50">
            <span>9:41</span>
            <div className="flex items-center gap-1"><Wifi size={7} /><Battery size={7} /></div>
          </div>
          <div className="grid grid-cols-4 gap-1.5 p-2">
            {APPS.map(app => (
              <div key={app.name} className="flex flex-col items-center gap-0.5">
                <div className="w-8 h-8 rounded-xl" style={{ background: app.color }} />
                <span className="text-[5px] text-white/40 truncate w-full text-center">{app.name}</span>
              </div>
            ))}
          </div>
          <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-16 h-1 rounded-full bg-white/25" />
        </div>

        {/* Gesture controls */}
        <div className="w-full">
          <p className="text-[9px] uppercase tracking-widest text-white/20 mb-2">Controls</p>
          <div className="grid grid-cols-3 gap-1">
            {[
              { label: 'Lock',   Icon: Lock },
              { label: 'Home',   Icon: Home },
              { label: 'Back',   Icon: ChevronDown },
              { label: 'Up',     Icon: ChevronUp },
              { label: 'Down',   Icon: ChevronDown },
              { label: 'Grid',   Icon: LayoutGrid },
              { label: 'Tap',    Icon: MousePointerClick },
              { label: 'Drag',   Icon: Move },
              { label: 'Gesture',Icon: Hand },
              { label: 'Camera', Icon: Camera },
              { label: 'Rotate', Icon: RotateCcw },
              { label: 'Power',  Icon: Power },
            ].map(({ label, Icon }) => (
              <button key={label} className="flex flex-col items-center gap-0.5 p-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] transition-colors text-white/40 hover:text-white/70">
                <Icon size={12} />
                <span className="text-[8px]">{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Text input */}
        <div className="w-full">
          <p className="text-[9px] uppercase tracking-widest text-white/20 mb-2">Text Input</p>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Type to send..."
            className="w-full h-16 bg-white/[0.04] border border-white/[0.06] rounded-lg p-2 text-xs text-white/70 placeholder-white/20 outline-none focus:border-white/20 resize-none"
          />
          <div className="flex gap-1 mt-1.5">
            {[{ Icon: Send, label: 'Send' }, { Icon: Copy, label: 'Copy' }, { Icon: Eraser, label: 'Clear' }].map(({ Icon, label }) => (
              <button key={label} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-[10px] text-white/40 hover:text-white/70 transition-colors">
                <Icon size={10} />{label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Device info strip */}
        <div className="flex items-center gap-6 px-5 py-3 border-b border-white/[0.06] bg-white/[0.01]">
          {[
            ['Model', phone.model],
            ['iOS', phone.os],
            ['Battery', \`\${phone.battery}%\`],
            ['Proxy', phone.proxyIp],
            ['Group', phone.group],
            ['Status', phone.status],
            ['Uptime', phone.uptime],
          ].map(([k, v]) => (
            <div key={k} className="flex flex-col gap-0.5">
              <span className="text-[9px] text-white/20 uppercase tracking-wider">{k}</span>
              <span className="text-xs text-white/65">{v}</span>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 py-2 border-b border-white/[0.06]">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={\`px-3 py-1.5 text-xs rounded-md transition-colors flex items-center gap-1.5 \${tab === t ? 'bg-white/[0.08] text-white/90' : 'text-white/35 hover:text-white/60'}\`}
            >
              {t === 'Apps' && <LayoutGrid size={11} />}
              {t === 'Automations' && <Play size={11} />}
              {t === 'Sessions' && <History size={11} />}
              {t === 'Logs' && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />}
              {t}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-auto p-4">
          {tab === 'Apps' && (
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
              {APPS.map(app => (
                <button key={app.name} className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-white/[0.04] transition-colors group">
                  <div className="w-12 h-12 rounded-2xl shadow-lg group-hover:scale-105 transition-transform" style={{ background: app.color }} />
                  <span className="text-[10px] text-white/50 group-hover:text-white/70">{app.name}</span>
                </button>
              ))}
            </div>
          )}
          {tab === 'Automations' && (
            <div className="flex flex-col gap-2">
              {['Instagram Warmup', 'Story View', 'Account Health Check', 'Refresh Session'].map(name => (
                <div key={name} className="flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                  <span className="text-sm text-white/70">{name}</span>
                  <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 text-xs transition-colors">
                    <Play size={10} /> Run
                  </button>
                </div>
              ))}
            </div>
          )}
          {tab === 'Sessions' && (
            <div className="flex flex-col gap-2">
              {['Instagram · @carol_official · Active', 'TikTok · @carofficial · Active', 'Telegram · Session #4 · Idle'].map(s => (
                <div key={s} className="px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.05] text-xs text-white/50">{s}</div>
              ))}
            </div>
          )}
          {tab === 'Logs' && (
            <div ref={logRef} className="font-mono text-[11px] space-y-0.5 max-h-full overflow-y-auto">
              {logs.map(l => (
                <div key={l.id} className="flex items-center gap-3 py-0.5">
                  <span className="text-white/15 w-16 shrink-0">{l.ts}</span>
                  <span className={\`w-10 shrink-0 text-[9px] font-semibold \${levelStyle[l.level]}\`}>{l.level}</span>
                  <span className={levelStyle[l.level]}>{l.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
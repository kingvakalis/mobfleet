import { useState, useEffect, useRef } from 'react'
import {
  Battery, Wifi, RefreshCw, Camera, Home,
  ChevronUp, ChevronDown, Pointer,
} from 'lucide-react'

interface PhoneDetailViewProps {
  deviceId: string
  onClose: () => void
}

const APPS = [
  { id: 'ig', label: 'Instagram', color: '#E1306C', emoji: '📷' },
  { id: 'tt', label: 'TikTok',    color: '#000',    emoji: '🎵' },
  { id: 'tg', label: 'Telegram',  color: '#0088cc', emoji: '✈️' },
  { id: 'wa', label: 'WhatsApp',  color: '#25D366', emoji: '💬' },
  { id: 'sf', label: 'Safari',    color: '#006CFF', emoji: '🧭' },
  { id: 'st', label: 'Settings',  color: '#8E8E93', emoji: '⚙️' },
]

export function PhoneDetailView({ deviceId, onClose }: PhoneDetailViewProps) {
  const [logs, setLogs] = useState<string[]>([])
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const entries = [
      `[${new Date().toLocaleTimeString()}] Device ${deviceId} connected`,
      `[${new Date().toLocaleTimeString()}] Session initialized`,
      `[${new Date().toLocaleTimeString()}] Instagram opened`,
      `[${new Date().toLocaleTimeString()}] Feed loaded — 42 posts visible`,
    ]
    setLogs(entries)
    const iv = setInterval(() => {
      setLogs(prev => [...prev.slice(-50), `[${new Date().toLocaleTimeString()}] Heartbeat OK`])
    }, 4000)
    return () => clearInterval(iv)
  }, [deviceId])

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight)
  }, [logs])

  return (
    <div className="flex flex-col h-full bg-[#0a0a0f] text-white/80">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
        <span className="text-sm font-semibold text-white/90">{deviceId}</span>
        <button onClick={onClose} className="text-white/30 hover:text-white/70 transition-colors text-lg leading-none">×</button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: iPhone frame */}
        <div className="flex flex-col items-center justify-start gap-4 p-6 w-[280px] shrink-0">
          {/* Phone frame */}
          <div className="relative w-[160px] h-[320px] rounded-[28px] border-2 border-white/20 bg-black overflow-hidden shadow-2xl">
            {/* Notch */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-20 h-5 bg-black rounded-b-xl z-10" />
            {/* Status bar */}
            <div className="flex items-center justify-between px-4 pt-6 pb-1 text-[8px] text-white/60">
              <span>9:41</span>
              <div className="flex items-center gap-1">
                <Wifi size={8} /><Battery size={8} />
              </div>
            </div>
            {/* App grid */}
            <div className="grid grid-cols-3 gap-3 p-3 pt-2">
              {APPS.map(app => (
                <div key={app.id} className="flex flex-col items-center gap-1">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl" style={{ background: app.color }}>
                    {app.emoji}
                  </div>
                  <span className="text-[7px] text-white/60">{app.label}</span>
                </div>
              ))}
            </div>
            {/* Home bar */}
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-20 h-1 rounded-full bg-white/30" />
          </div>

          {/* Gesture controls */}
          <div className="flex flex-wrap gap-1.5 justify-center">
            {[
              { label: 'Tap', icon: <Pointer size={11} /> },
              { label: 'Up', icon: <ChevronUp size={11} /> },
              { label: 'Down', icon: <ChevronDown size={11} /> },
              { label: 'Home', icon: <Home size={11} /> },
              { label: 'Screenshot', icon: <Camera size={11} /> },
              { label: 'Restart', icon: <RefreshCw size={11} /> },
            ].map(b => (
              <button key={b.label} className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/[0.05] hover:bg-white/[0.09] text-white/50 hover:text-white/80 text-[10px] transition-colors">
                {b.icon}{b.label}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Info + logs */}
        <div className="flex flex-col flex-1 overflow-hidden border-l border-white/[0.06]">
          {/* Device info */}
          <div className="grid grid-cols-2 gap-3 p-5 border-b border-white/[0.06]">
            {[
              ['Model', 'iPhone SE (3rd)'],
              ['iOS', '17.4.1'],
              ['Battery', '82%'],
              ['Proxy', 'US-East · 42ms'],
              ['Group', 'Carolina'],
              ['Status', 'Online'],
            ].map(([k, v]) => (
              <div key={k} className="flex flex-col gap-0.5">
                <span className="text-[10px] text-white/25 uppercase tracking-wider">{k}</span>
                <span className="text-xs text-white/70">{v}</span>
              </div>
            ))}
          </div>

          {/* Log stream */}
          <div className="flex flex-col flex-1 overflow-hidden p-4 gap-2">
            <span className="text-[10px] text-white/25 uppercase tracking-wider">Live Log</span>
            <div ref={logRef} className="flex-1 overflow-y-auto font-mono text-[10px] text-emerald-400/70 bg-black/30 rounded-lg p-3 space-y-1">
              {logs.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

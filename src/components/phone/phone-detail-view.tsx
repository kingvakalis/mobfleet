import React, { useState, useEffect, useRef } from 'react'
import {
  X, Battery, Wifi, RefreshCw, Camera, Home,
  ChevronUp, ChevronDown, Pointer,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

interface PhoneDetailViewProps {
  deviceId: string
  onClose: () => void
}

const APP_ICONS: { name: string; color: string }[] = [
  { name: 'Instagram', color: 'bg-gradient-to-br from-purple-500 to-pink-500' },
  { name: 'TikTok',    color: 'bg-black border border-white/20' },
  { name: 'Telegram',  color: 'bg-sky-500' },
  { name: 'WhatsApp',  color: 'bg-green-500' },
  { name: 'Safari',    color: 'bg-blue-500' },
  { name: 'Settings',  color: 'bg-zinc-600' },
]

const MOCK_DEVICE = {
  model: 'iPhone SE (3rd Gen)',
  ios: '17.4.1',
  battery: 78,
  proxy: '104.21.45.12:8080',
  group: 'Instagram Farm',
  status: 'online' as const,
}

const STATUS_BADGE = {
  online:  'bg-green-500/15 text-green-400',
  offline: 'bg-zinc-500/15 text-zinc-400',
  warning: 'bg-amber-500/15 text-amber-400',
}

function generateLogLine(i: number) {
  const events = [
    '[adb] shell input tap 195 420',
    '[ig]  story viewed · dwell 3.2s',
    '[ig]  scroll feed · 2 posts',
    '[sys] heartbeat ok · battery 78%',
    '[adb] screenshot captured',
    '[ig]  liked post · @user_842',
    '[net] proxy latency 42ms',
    '[ig]  profile visited · 4.1s',
    '[sys] cpu 12% · mem 1.2GB',
    '[ig]  story tap next',
  ]
  const ts = new Date(Date.now() - (20 - i) * 8000)
  const hh = ts.getHours().toString().padStart(2, '0')
  const mm = ts.getMinutes().toString().padStart(2, '0')
  const ss = ts.getSeconds().toString().padStart(2, '0')
  return `${hh}:${mm}:${ss}  ${events[i % events.length]}`
}

export function PhoneDetailView({ deviceId, onClose }: PhoneDetailViewProps) {
  const [logs, setLogs] = useState(() => Array.from({ length: 20 }, (_, i) => generateLogLine(i)))
  const [notes, setNotes] = useState('')
  const logsEndRef = useRef<HTMLDivElement>(null)

  // Stream new log lines
  useEffect(() => {
    const id = setInterval(() => {
      setLogs(prev => {
        const next = [...prev.slice(-19), generateLogLine(Math.floor(Math.random() * 10))]
        return next
      })
    }, 4000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  return (
    <div className="flex h-full flex-col bg-[#0a0a0f]">
      {/* Header bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-6 py-3">
        <div className="text-sm font-medium text-white/80">Device · {deviceId}</div>
        <button onClick={onClose} className="rounded p-1.5 text-white/30 hover:text-white/70 hover:bg-white/[0.06]">
          <X size={16} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 gap-6 overflow-hidden p-6">
        {/* ── Left: Phone frame ──────────────────────────────── */}
        <div className="flex shrink-0 flex-col items-center gap-4">
          {/* iPhone SE frame */}
          <div className="relative flex h-[480px] w-[240px] flex-col items-center justify-center rounded-[36px] border-2 border-zinc-700 bg-zinc-900 shadow-2xl">
            {/* Notch/speaker */}
            <div className="absolute top-4 h-4 w-20 rounded-full bg-zinc-800" />

            {/* Screen */}
            <div className="absolute inset-3 top-10 bottom-10 rounded-[28px] bg-zinc-950 overflow-hidden">
              {/* Status bar */}
              <div className="flex items-center justify-between px-4 pt-2 pb-1">
                <span className="mono text-[9px] text-white/60">9:41</span>
                <div className="flex items-center gap-1">
                  <Wifi size={9} className="text-white/60" />
                  <Battery size={9} className="text-white/60" />
                </div>
              </div>

              {/* App grid */}
              <div className="grid grid-cols-3 gap-3 p-3 pt-2">
                {APP_ICONS.map(app => (
                  <div key={app.name} className="flex flex-col items-center gap-1">
                    <div className={`h-12 w-12 rounded-[12px] ${app.color} flex items-center justify-center`}>
                      <span className="text-[8px] font-bold text-white">{app.name[0]}</span>
                    </div>
                    <span className="text-[7px] text-white/70 text-center leading-tight">{app.name}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Home indicator */}
            <div className="absolute bottom-3 h-1 w-20 rounded-full bg-zinc-600" />
          </div>

          {/* Gesture controls */}
          <div className="flex flex-wrap gap-2 justify-center">
            {[
              { label: 'Tap',    icon: <Pointer size={12} /> },
              { label: 'Swipe↑', icon: <ChevronUp size={12} /> },
              { label: 'Swipe↓', icon: <ChevronDown size={12} /> },
              { label: 'Home',   icon: <Home size={12} /> },
              { label: 'Shot',   icon: <Camera size={12} /> },
            ].map(btn => (
              <button
                key={btn.label}
                className="flex items-center gap-1.5 rounded border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-white/60 hover:bg-white/[0.08] hover:text-white/90 transition-colors"
              >
                {btn.icon} {btn.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Right: Info panel ──────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto">
          {/* Device info */}
          <div className="rounded-xl border border-white/[0.06] bg-[#111118] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-white/90">Device Info</span>
              <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${STATUS_BADGE[MOCK_DEVICE.status]}`}>
                {MOCK_DEVICE.status}
              </span>
            </div>
            {[
              ['Model',   MOCK_DEVICE.model],
              ['iOS',     MOCK_DEVICE.ios],
              ['Battery', `${MOCK_DEVICE.battery}%`],
              ['Proxy',   MOCK_DEVICE.proxy],
              ['Group',   MOCK_DEVICE.group],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-xs">
                <span className="mono text-white/30 uppercase tracking-wide">{k}</span>
                <span className="mono text-white/70">{v}</span>
              </div>
            ))}
          </div>

          {/* Notes */}
          <div className="rounded-xl border border-white/[0.06] bg-[#111118] p-4 space-y-2">
            <label className="mono text-[10px] uppercase tracking-widest text-white/30">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Add notes about this device…"
              className="w-full resize-none rounded bg-white/[0.03] border border-white/[0.06] px-3 py-2 text-xs text-white/70 placeholder-white/20 outline-none focus:border-white/20 transition-colors"
            />
          </div>

          {/* Actions */}
          <div className="rounded-xl border border-white/[0.06] bg-[#111118] p-4 space-y-3">
            <span className="mono text-[10px] uppercase tracking-widest text-white/30">Actions</span>
            <div className="flex flex-col gap-2">
              <select className="rounded border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-white/70 outline-none">
                <option>Launch App…</option>
                {APP_ICONS.map(a => <option key={a.name}>{a.name}</option>)}
              </select>
              <select className="rounded border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs text-white/70 outline-none">
                <option>Run Automation…</option>
                <option>Instagram Warmup</option>
                <option>Account Check</option>
                <option>Story View</option>
              </select>
              <button className="flex items-center justify-center gap-2 rounded border border-red-500/20 bg-red-500/[0.06] px-3 py-2 text-xs text-red-400 hover:bg-red-500/[0.12] transition-colors">
                <RefreshCw size={12} /> Restart Device
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Log stream ──────────────────────────────────────── */}
      <div className="shrink-0 border-t border-white/[0.06]">
        <div className="mono h-36 overflow-y-auto bg-zinc-950 p-3 text-[11px] text-green-400/80 leading-5">
          {logs.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  )
}

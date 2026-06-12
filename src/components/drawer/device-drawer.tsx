import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Check, Copy, Play, Send, Square, Trash2, X,
  Lock, Home, CornerDownLeft, Grid2x2, Camera, RefreshCw, Power,
  Cpu, ArrowUpRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { StatusDot } from '@/components/ui/status-dot'
import { GRID_APPS } from '@/components/phone/app-catalog'
import { LivePhone, type LivePhoneHandle } from '@/components/phone/live-phone'
import { useDeviceLog } from '@/hooks/use-device-log'
import { useFleet } from '@/hooks/use-fleet'
import { regionLabel } from '@/data/regions'
import { client } from '@/lib/provider'
import { formatUptime } from '@/lib/format'
import { EXPO_OUT } from '@/lib/motion'
import { STATUS } from '@/lib/status'
import { useUIStore } from '@/state/ui-store'
import { useSettings } from '@/state/settings-store'
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

/** Live telemetry readout cell with a subtle flash on change. */
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

const QUICK = [
  { key: 'lock',       label: 'Lock',     Icon: Lock },
  { key: 'home',       label: 'Home',     Icon: Home },
  { key: 'back',       label: 'Back',     Icon: CornerDownLeft },
  { key: 'switcher',   label: 'Switch',   Icon: Grid2x2 },
  { key: 'screenshot', label: 'Shot',     Icon: Camera },
  { key: 'restart',    label: 'Stream',   Icon: RefreshCw },
  { key: 'reboot',     label: 'Reboot',   Icon: Power, danger: true },
] as const

function DrawerInner({ deviceId, onClose }: { deviceId: string; onClose: () => void }) {
  const snapshot = useFleet()
  const device = snapshot.devices.find((d) => d.id === deviceId)
  const job = device?.jobId ? snapshot.jobs.find((j) => j.id === device.jobId) ?? null : null
  const { lines: logs, push } = useDeviceLog(deviceId)
  const panelRef = useRef<HTMLDivElement>(null)
  const phoneRef = useRef<LivePhoneHandle>(null)
  const [copied, setCopied] = useState(false)
  const [sendText, setSendText] = useState('')
  const openPhoneControl = useUIStore((s) => s.openPhoneControl)

  // Simulated stream telemetry — alive numbers, same spirit as the control page.
  const [latency, setLatency] = useState(41)
  const [fps, setFps] = useState(18)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => {
      setLatency((v) => Math.round(Math.min(80, Math.max(20, v + (Math.random() - 0.5) * 14))))
      setFps((v) => Math.round(Math.min(30, Math.max(14, v + (Math.random() - 0.5) * 3))))
      setNow(Date.now())
    }, 1400)
    return () => clearInterval(id)
  }, [])

  const groupOptions = [...new Set(snapshot.devices.map((d) => d.group))].sort()

  useEffect(() => {
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
      case 'restart':    push('info', 'stream restarted'); break
      case 'reboot':
        if (confirmDestructive && !window.confirm('Reboot this device?')) return
        push('warn', 'device reboot dispatched')
        break
    }
  }

  const meta = device ? STATUS[device.status] : null
  const canStart = device?.status === 'offline' || device?.status === 'error'
  const latColor = latency < 50 ? 'var(--status-online)' : latency < 70 ? 'var(--status-warming)' : 'var(--status-error)'

  return (
    <div className="fixed inset-0 z-50">
      <motion.div
        className="absolute inset-0 bg-black/50 backdrop-blur-md"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        onClick={onClose}
      />

      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Device ${deviceId}`}
        tabIndex={-1}
        className="scan-sweep absolute right-0 top-0 flex h-full w-[580px] max-w-[96vw] flex-col overflow-hidden border-l border-line bg-panel outline-none"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: 0.34, ease: EXPO_OUT }}
      >
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
                className="mono flex h-8 items-center gap-1.5 border border-[#4fc3f7]/30 bg-[#4fc3f7]/10 px-3 text-[10px] uppercase tracking-widest text-[#7dd3fc] transition-colors hover:bg-[#4fc3f7]/25"
              >
                <Cpu size={12} /> Full Control <ArrowUpRight size={11} />
              </button>
            )}
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
                        className="mono h-8 min-w-0 flex-1 border border-line bg-elevated px-2.5 text-[11px] text-fg-secondary placeholder-white/20 outline-none transition-colors focus:border-[#4fc3f7]/50"
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
                      onChange={(e) => void client.assignGroup([device.id], e.target.value)}
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
                  <Button size="sm" variant="outline" onClick={() => void client.start(device.id)}>
                    <Play size={13} /> Start
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => void client.stop(device.id)}>
                    <Square size={12} /> Stop
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={device.status !== 'online'}
                  onClick={() => void client.runTask(device.id, { type: 'upload', label: 'Manual upload' })}
                >
                  <Send size={13} /> Assign
                </Button>
                <Button size="sm" variant="outline" onClick={copyId}>
                  {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy ID'}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    if (confirmDestructive && !window.confirm(`Retire ${device.name}? This removes it from the pool.`)) return
                    void client.delete(device.id)
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
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
            <Label className="text-fg-muted">Device Retired</Label>
            <p className="mono text-xs text-fg-muted">{deviceId}</p>
            <Button size="sm" variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        )}
      </motion.div>
    </div>
  )
}

/** Right slide-over: a live mini control-center — interactive phone, quick
 *  controls, app launch, telemetry, and the device's log stream. */
export function DeviceDrawer() {
  const deviceId = useUIStore((s) => s.drawerDeviceId)
  const closeDrawer = useUIStore((s) => s.closeDrawer)
  return (
    <AnimatePresence>
      {deviceId && <DrawerInner key={deviceId} deviceId={deviceId} onClose={closeDrawer} />}
    </AnimatePresence>
  )
}

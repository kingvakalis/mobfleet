import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Copy, Play, Send, Square, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { StatusDot } from '@/components/ui/status-dot'
import { PhoneFrame } from '@/components/phone/phone-frame'
import { useDeviceLog } from '@/hooks/use-device-log'
import { useFleet } from '@/hooks/use-fleet'
import { regionLabel } from '@/data/regions'
import { client } from '@/lib/provider'
import { formatUptime } from '@/lib/format'
import { EXPO_OUT } from '@/lib/motion'
import { STATUS } from '@/lib/status'
import { useUIStore } from '@/state/ui-store'
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

function DrawerInner({ deviceId, onClose }: { deviceId: string; onClose: () => void }) {
  const snapshot = useFleet()
  const device = snapshot.devices.find((d) => d.id === deviceId)
  const job = device?.jobId ? snapshot.jobs.find((j) => j.id === device.jobId) ?? null : null
  const { lines: logs, push } = useDeviceLog(deviceId)
  const panelRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

  const groupOptions = [...new Set(snapshot.devices.map((d) => d.group))].sort()

  useEffect(() => {
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const copyProxy = async () => {
    if (!device) return
    try {
      await navigator.clipboard.writeText(device.proxy)
    } catch {
      /* ignore */
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  const meta = device ? STATUS[device.status] : null
  const canStart = device?.status === 'offline' || device?.status === 'error'

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
        className="absolute right-0 top-0 flex h-full w-[460px] max-w-[92vw] flex-col border-l border-line bg-panel outline-none"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: 0.34, ease: EXPO_OUT }}
      >
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
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-elevated hover:text-fg"
          >
            <X size={16} />
          </button>
        </div>

        {device && meta ? (
          <>
            {/* interactive phone + telemetry */}
            <div className="flex gap-5 border-b border-line px-5 py-5">
              <PhoneFrame device={device} job={job} onLog={push} />
              <div className="min-w-0 flex-1">
                <Cell label="Status" value={meta.label} color={meta.color} />
                <Cell label="Model" value={`${device.model} · ${device.osVersion}`} />
                <Cell label="Region" value={regionLabel(device.region)} />
                <Cell label="Battery" value={`${device.battery}%`} />
                <Cell label="Proxy" value={device.proxy} />
                <Cell label="Operator" value={device.assignedUser ?? 'Unassigned'} />
                <Cell
                  label="Job"
                  value={job ? `${job.type.toUpperCase()} · ${Math.round(job.progress * 100)}%` : '—'}
                />
                <Cell label="Uptime" value={formatUptime(Date.now() - device.createdAt)} />

                {/* group reassignment */}
                <div className="py-1">
                  <div className="label text-fg-muted">Group</div>
                  <select
                    value={device.group}
                    onChange={(e) => void client.assignGroup([device.id], e.target.value)}
                    aria-label="Device group"
                    className="mono mt-1 h-7 w-full rounded-control border border-line bg-elevated px-2 text-[12px] text-fg-secondary outline-none focus:border-accent/40"
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
              <Button size="sm" variant="outline" onClick={copyProxy}>
                {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Proxy'}
              </Button>
              <Button size="sm" variant="danger" onClick={() => void client.delete(device.id)}>
                <Trash2 size={13} /> Retire
              </Button>
            </div>

            {/* live log */}
            <div className="flex items-center justify-between border-b border-line px-5 py-2.5">
              <Label className="text-fg-secondary">Live Log</Label>
              <span className="mono text-[10px] text-fg-muted">{logs.length} LINES</span>
            </div>
            <div className="min-h-0 flex-1">
              <LogStream lines={logs} />
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

/** Right slide-over: full device telemetry + live log stream. */
export function DeviceDrawer() {
  const deviceId = useUIStore((s) => s.drawerDeviceId)
  const closeDrawer = useUIStore((s) => s.closeDrawer)
  return (
    <AnimatePresence>
      {deviceId && <DrawerInner key={deviceId} deviceId={deviceId} onClose={closeDrawer} />}
    </AnimatePresence>
  )
}

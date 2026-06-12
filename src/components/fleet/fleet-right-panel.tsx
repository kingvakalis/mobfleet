import { useState } from 'react'
import { useFleet } from '@/hooks/use-fleet'
import { AnimatePresence, motion } from 'framer-motion'
import {
  X,
  Pause,
  Play,
  Filter,
  Monitor,
  Camera,
  RefreshCw,
  FileText,
  Briefcase,
  ScreenShareOff,
  RotateCcw,
  UserPlus,
  Download,
} from 'lucide-react'
import { useActivityFeed, type ActivityEvent } from './fleet-activity'

export interface FleetRightPanelProps {
  mode: 'activity' | 'device' | 'bulk' | 'fleet'
  selectedIds: string[]
  onClose: () => void
}

const levelColor: Record<ActivityEvent['level'], string> = {
  OK:    'text-emerald-400',
  INFO:  'text-white/40',
  WARN:  'text-amber-400',
  ERROR: 'text-red-400',
}
const levelDot: Record<ActivityEvent['level'], string> = {
  OK:    'bg-emerald-400',
  INFO:  'bg-white/40',
  WARN:  'bg-amber-400',
  ERROR: 'bg-red-400',
}

function ActivityPanel({ onClose }: { onClose: () => void }) {
  const [paused, setPaused] = useState(false)
  const events = useActivityFeed(paused)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
        <span className="text-xs font-medium text-white/70">Live Activity</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPaused(p => !p)}
            className={[
              'flex items-center justify-center w-6 h-6 rounded-md transition-colors',
              paused ? 'text-amber-400 bg-amber-500/10' : 'text-white/30 hover:text-white/60 hover:bg-white/[0.05]',
            ].join(' ')}
          >
            {paused ? <Play size={11} /> : <Pause size={11} />}
          </button>
          <button className="flex items-center justify-center w-6 h-6 rounded-md text-white/30 hover:text-white/60 hover:bg-white/[0.05] transition-colors">
            <Filter size={11} />
          </button>
          <button onClick={onClose} className="flex items-center justify-center w-6 h-6 rounded-md text-white/30 hover:text-white/60 hover:bg-white/[0.05] transition-colors">
            <X size={11} />
          </button>
        </div>
      </div>

      {/* Events */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
        <AnimatePresence initial={false}>
          {events.map(evt => (
            <motion.div
              key={evt.id}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22 }}
              className="flex items-start gap-2 py-1.5 px-2 rounded-lg hover:bg-white/[0.03] transition-colors"
            >
              <span className={['w-1.5 h-1.5 rounded-full mt-1.5 shrink-0', levelDot[evt.level]].join(' ')} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] font-medium text-white/60 truncate">{evt.device}</span>
                  <span className="text-[9px] text-white/25 shrink-0 font-mono">{evt.ts}</span>
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className={['text-[10px] font-medium shrink-0', levelColor[evt.level]].join(' ')}>{evt.type}</span>
                  <span className="text-[10px] text-white/30 truncate">{evt.message}</span>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

function DevicePanel({ deviceId, onClose }: { deviceId: string; onClose: () => void }) {
  const snapshot = useFleet()
  const device = snapshot.devices.find(d => d.id === deviceId)
  if (!device) return null

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
        <span className="text-xs font-medium text-white/70">{device.name}</span>
        <button onClick={onClose} className="flex items-center justify-center w-6 h-6 rounded-md text-white/30 hover:text-white/60 hover:bg-white/[0.05] transition-colors">
          <X size={11} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Info */}
        <div className="space-y-2">
          {[
            { label: 'Status',  value: device.status },
            { label: 'Model',   value: device.model },
            { label: 'OS',      value: device.osVersion },
            { label: 'Group',   value: device.group },
            { label: 'Proxy',   value: device.proxy },
            { label: 'User',    value: device.assignedUser ?? 'Unassigned' },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between">
              <span className="text-[10px] text-white/30 uppercase tracking-wider">{label}</span>
              <span className="text-[11px] text-white/70 font-mono">{value}</span>
            </div>
          ))}
          {/* Battery */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-white/30 uppercase tracking-wider">Battery</span>
            <div className="flex items-center gap-2">
              <div className="w-16 h-1.5 rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: device.battery + '%',
                    background: device.battery > 30 ? '#22c55e' : '#ef4444',
                  }}
                />
              </div>
              <span className="text-[11px] text-white/50">{device.battery}%</span>
            </div>
          </div>
        </div>

        {/* Quick actions */}
        <div>
          <p className="text-[10px] text-white/25 uppercase tracking-wider mb-2">Quick Actions</p>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { icon: <Monitor size={12} />, label: 'Control' },
              { icon: <Camera size={12} />, label: 'Screenshot' },
              { icon: <RefreshCw size={12} />, label: 'Reboot' },
              { icon: <FileText size={12} />, label: 'Logs' },
            ].map(({ icon, label }) => (
              <button
                key={label}
                className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-[11px] text-white/60 hover:text-white/90 transition-colors"
              >
                {icon} {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function BulkPanel({ count, onClose }: { count: number; onClose: () => void }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
        <span className="text-xs font-medium text-white/70">{count} devices selected</span>
        <button onClick={onClose} className="flex items-center justify-center w-6 h-6 rounded-md text-white/30 hover:text-white/60 hover:bg-white/[0.05] transition-colors">
          <X size={11} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <p className="text-[10px] text-white/25 uppercase tracking-wider mb-2">Bulk Actions</p>
        <div className="space-y-1.5">
          {[
            { icon: <Briefcase size={12} />, label: 'Run Job' },
            { icon: <ScreenShareOff size={12} />, label: 'Screenshot All' },
            { icon: <RotateCcw size={12} />, label: 'Reboot All' },
            { icon: <RefreshCw size={12} />, label: 'Assign Proxy' },
            { icon: <UserPlus size={12} />, label: 'Add to Group' },
            { icon: <Download size={12} />, label: 'Export List' },
          ].map(({ icon, label }) => (
            <button
              key={label}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.05] text-xs text-white/60 hover:text-white/90 transition-colors text-left"
            >
              {icon} {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function FleetHealthPanel({ onClose }: { onClose: () => void }) {
  const snapshot = useFleet()
  const phones   = snapshot.devices
  const total   = phones.length
  const online  = phones.filter(p => p.status === 'online' || p.status === 'busy' || p.status === 'warming').length
  const running = phones.filter(p => p.status === 'busy').length
  const warning = phones.filter(p => p.status === 'error').length
  const offline = phones.filter(p => p.status === 'offline').length
  const onlinePct = Math.round((online / total) * 100)
  const circumference = 2 * Math.PI * 36

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
        <span className="text-xs font-medium text-white/70">Fleet Health</span>
        <button onClick={onClose} className="flex items-center justify-center w-6 h-6 rounded-md text-white/30 hover:text-white/60 hover:bg-white/[0.05] transition-colors">
          <X size={11} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Circular progress */}
        <div className="flex justify-center">
          <div className="relative w-24 h-24">
            <svg className="w-24 h-24 -rotate-90" viewBox="0 0 84 84">
              <circle cx="42" cy="42" r="36" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="6" />
              <circle
                cx="42" cy="42" r="36" fill="none"
                stroke="#22c55e" strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={circumference.toString()}
                strokeDashoffset={(circumference * (1 - onlinePct / 100)).toString()}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-lg font-bold text-white/90">{onlinePct}%</span>
              <span className="text-[9px] text-white/30">Online</span>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="space-y-2">
          {[
            { label: 'Total',   value: total,   color: 'text-white/60' },
            { label: 'Online',  value: online,  color: 'text-emerald-400' },
            { label: 'Running', value: running, color: 'text-indigo-400' },
            { label: 'Warning', value: warning, color: 'text-amber-400' },
            { label: 'Offline', value: offline, color: 'text-red-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex items-center justify-between">
              <span className="text-[10px] text-white/30">{label}</span>
              <span className={['text-xs font-semibold', color].join(' ')}>{value}</span>
            </div>
          ))}
        </div>

        <div className="h-px bg-white/[0.06]" />

        {/* Metrics */}
        <div className="space-y-2">
          {[
            { label: 'Proxy Failures', value: '1',   color: 'text-amber-400' },
            { label: 'Avg Latency',    value: '42ms', color: 'text-white/60' },
            { label: 'Running Jobs',   value: running.toString(), color: 'text-indigo-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex items-center justify-between">
              <span className="text-[10px] text-white/30">{label}</span>
              <span className={['text-xs font-mono', color].join(' ')}>{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function FleetRightPanel({ mode, selectedIds, onClose }: FleetRightPanelProps) {
  return (
    <div
      className="h-full border-l border-white/[0.06] bg-black/30 backdrop-blur-sm flex flex-col"
      style={{ width: 280 }}
    >
      {mode === 'activity' && <ActivityPanel onClose={onClose} />}
      {mode === 'device'   && <DevicePanel deviceId={selectedIds[0]} onClose={onClose} />}
      {mode === 'bulk'     && <BulkPanel count={selectedIds.length} onClose={onClose} />}
      {mode === 'fleet'    && <FleetHealthPanel onClose={onClose} />}
    </div>
  )
}

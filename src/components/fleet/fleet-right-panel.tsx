import { useState } from 'react'
import { useFleet } from '@/hooks/use-fleet'
import { useScopedDevices } from '@/lib/authorization/use-access'
import { AnimatePresence, motion } from 'framer-motion'
import { X, Pause, Play, Activity, HeartPulse } from 'lucide-react'
import { EXPO_OUT } from '@/lib/motion'
import { useSettings } from '@/state/settings-store'
import { useActivityFeed, type ActivityEvent } from './fleet-activity'

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

function ActivityFeed({ paused }: { paused: boolean }) {
  const events = useActivityFeed(paused)
  return (
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
  )
}

function HealthBody() {
  const snapshot = useFleet()
  // SECURITY: health figures reflect only the acting member's scoped devices.
  const phones   = useScopedDevices()
  const total   = Math.max(1, phones.length)
  const online  = phones.filter(p => p.status === 'online' || p.status === 'busy' || p.status === 'warming').length
  const running = phones.filter(p => p.status === 'busy').length
  const warning = phones.filter(p => p.status === 'error').length
  const offline = phones.filter(p => p.status === 'offline').length
  const queued  = snapshot.jobs.filter(j => j.status === 'queued').length
  const onlinePct = Math.round((online / total) * 100)
  const circumference = 2 * Math.PI * 36

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
      <div className="flex justify-center">
        <div className="relative w-24 h-24">
          <svg className="w-24 h-24 -rotate-90" viewBox="0 0 84 84">
            <circle cx="42" cy="42" r="36" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="6" />
            <circle
              cx="42" cy="42" r="36" fill="none"
              stroke="var(--status-online)" strokeWidth="6"
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

      <div className="space-y-2">
        {[
          { label: 'Total',       value: phones.length, color: 'text-white/60' },
          { label: 'Online',      value: online,        color: 'text-emerald-400' },
          { label: 'Running',     value: running,       color: 'text-[#4fc3f7]' },
          { label: 'Warning',     value: warning,       color: 'text-amber-400' },
          { label: 'Offline',     value: offline,       color: 'text-red-400' },
          { label: 'Queued Jobs', value: queued,        color: 'text-white/60' },
        ].map(({ label, value, color }) => (
          <div key={label} className="flex items-center justify-between">
            <span className="text-[10px] text-white/30">{label}</span>
            <span className={['text-xs font-semibold tabular-nums', color].join(' ')}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Collapsible right drawer for the fleet views: live activity + fleet health.
 * Closed by default — the canvas keeps the full width until the operator
 * explicitly opens it.
 */
export function FleetActivityDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<'activity' | 'health'>('activity')
  // Workspace notification setting decides whether the feed streams by default.
  const notifications = useSettings((s) => s.activityNotifications)
  const [paused, setPaused] = useState(!notifications)

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ x: 300, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 300, opacity: 0 }}
          transition={{ duration: 0.26, ease: EXPO_OUT }}
          className="absolute right-0 top-0 z-30 flex h-full w-[280px] flex-col border-l border-line bg-panel"
        >
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-line">
            <div className="flex items-center gap-1">
              {([
                { id: 'activity' as const, label: 'Activity', Icon: Activity },
                { id: 'health'   as const, label: 'Health',   Icon: HeartPulse },
              ]).map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={[
                    'flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] uppercase tracking-wider transition-colors',
                    tab === id ? 'text-[var(--accent-text)] bg-[var(--accent-soft)]' : 'text-white/35 hover:text-white/70',
                  ].join(' ')}
                >
                  <Icon size={11} /> {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              {tab === 'activity' && (
                <button
                  type="button"
                  onClick={() => setPaused(p => !p)}
                  title={paused ? 'Resume feed' : 'Pause feed'}
                  className={[
                    'flex items-center justify-center w-6 h-6 rounded-md transition-colors',
                    paused ? 'text-amber-400 bg-amber-500/10' : 'text-white/30 hover:text-white/60 hover:bg-white/[0.05]',
                  ].join(' ')}
                >
                  {paused ? <Play size={11} /> : <Pause size={11} />}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close panel"
                className="flex items-center justify-center w-6 h-6 rounded-md text-white/30 hover:text-white/60 hover:bg-white/[0.05] transition-colors"
              >
                <X size={11} />
              </button>
            </div>
          </div>
          {tab === 'activity' ? <ActivityFeed paused={paused} /> : <HealthBody />}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

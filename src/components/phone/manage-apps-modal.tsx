import { AnimatePresence, motion } from 'framer-motion'
import { X, RefreshCw, Eye, EyeOff } from 'lucide-react'
import type { DeviceApp } from '@/services/device-commands'

/**
 * Per-user, per-device "which installed apps do I want to see" panel. Lists the REAL
 * detected inventory (device_apps) with a show/hide toggle each, plus "Refresh Apps"
 * (re-detect on the device). Shared by Phone Control + the Fleet drawer. Honest empty
 * state when nothing is detected — never a fabricated list.
 */
export function ManageAppsModal({
  open, onClose, apps, isVisible, onToggle, onRefresh, refreshing, canRefresh,
}: {
  open: boolean
  onClose: () => void
  apps: DeviceApp[]
  isVisible: (bundleId: string) => boolean
  onToggle: (bundleId: string, visible: boolean) => void
  onRefresh: () => void
  refreshing: boolean
  canRefresh: boolean
}) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <motion.div
            className="absolute inset-0 bg-black/55"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog" aria-modal="true" aria-label="Manage apps"
            className="relative w-[380px] max-w-full rounded-xl border border-white/[0.1] bg-[#111318] p-4 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.85)]"
            initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[12px] font-semibold uppercase tracking-widest text-white/60">Manage Apps</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onRefresh}
                  disabled={!canRefresh || refreshing}
                  title={canRefresh ? 'Re-detect installed apps on the device' : 'Requires control permission'}
                  className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-[#2dd4bf] transition-colors enabled:hover:text-[#5eead4] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <RefreshCw size={12} className={refreshing ? 'spin-slow' : ''} /> Refresh Apps
                </button>
                <button type="button" onClick={onClose} aria-label="Close" className="text-white/40 transition-colors hover:text-white">
                  <X size={15} />
                </button>
              </div>
            </div>

            {apps.length === 0 ? (
              <p className="py-8 text-center text-[11px] leading-relaxed text-white/35">
                No installed apps detected yet.<br />Press <span className="text-white/55">Refresh Apps</span> once the device agent is connected.
              </p>
            ) : (
              <div className="flex max-h-[320px] flex-col gap-1 overflow-y-auto">
                {apps.map((app) => {
                  const visible = isVisible(app.bundleId)
                  return (
                    <button
                      key={app.bundleId}
                      type="button"
                      onClick={() => onToggle(app.bundleId, !visible)}
                      aria-pressed={visible}
                      className="flex items-center gap-2.5 rounded-lg border border-white/[0.06] p-2 text-left transition-colors hover:border-white/[0.14]"
                    >
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[8px] font-bold text-white" style={{ background: app.iconColor ?? '#3a3a40' }}>
                        {app.abbr ?? app.name.slice(0, 2)}
                      </div>
                      <span className="flex-1 truncate text-[11px] text-white/75">{app.name}</span>
                      {visible
                        ? <Eye size={13} className="shrink-0 text-[#2dd4bf]" />
                        : <EyeOff size={13} className="shrink-0 text-white/25" />}
                    </button>
                  )
                })}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

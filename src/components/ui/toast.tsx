import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useToastStore, type ToastLevel } from '@/state/toast-store'

const levelStyles: Record<ToastLevel, string> = {
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  error:   'border-red-500/30 bg-red-500/10 text-red-300',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  info:    'border-white/10 bg-white/[0.06] text-white/60',
}

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore()

  return (
    // Screen-reader announcement region. Errors/warnings are assertive (they
    // interrupt); success/info are polite. role + aria-live make transient
    // toasts perceivable to AT users who never see the visual element.
    <div
      className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none"
      role="region"
      aria-label="Notifications"
    >
      <AnimatePresence>
        {toasts.map(toast => {
          const assertive = toast.level === 'error' || toast.level === 'warning'
          return (
          <motion.div
            key={toast.id}
            role={assertive ? 'alert' : 'status'}
            aria-live={assertive ? 'assertive' : 'polite'}
            initial={{ opacity: 0, x: 60, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 60, scale: 0.95 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className={[
              'pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border text-sm min-w-[240px] max-w-[340px] backdrop-blur-xl shadow-xl',
              levelStyles[toast.level],
            ].join(' ')}
          >
            <span className="flex-1">{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              aria-label="Dismiss notification"
              className="shrink-0 opacity-50 hover:opacity-100 transition-opacity"
            >
              <X size={13} />
            </button>
            <ToastTimer id={toast.id} duration={toast.duration} />
          </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

function ToastTimer({ id, duration }: { id: string; duration: number }) {
  const removeToast = useToastStore(s => s.removeToast)
  useEffect(() => {
    const t = setTimeout(() => removeToast(id), duration)
    return () => clearTimeout(t)
  }, [id, duration, removeToast])
  return null
}

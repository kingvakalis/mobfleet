import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useFleet } from '@/hooks/use-fleet'
import { regionLabel } from '@/data/regions'
import { client } from '@/lib/provider'
import { EXPO_OUT } from '@/lib/motion'
import type { TaskType } from '@/lib/provider/types'
import { cn } from '@/lib/utils'

const TASK_TYPES: TaskType[] = ['upload', 'warmup', 'engage', 'post']

function Inner({ onClose }: { onClose: () => void }) {
  const snapshot = useFleet()
  const [type, setType] = useState<TaskType>('upload')
  const [target, setTarget] = useState('auto')
  const [busy, setBusy] = useState(false)

  const idle = snapshot.devices.filter((d) => d.status === 'online')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async () => {
    setBusy(true)
    try {
      if (target === 'auto') await client.enqueueTask({ type, label: `${type} (auto)` })
      else await client.runTask(target, { type, label: type })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <motion.div
        className="absolute inset-0 bg-black/50 backdrop-blur-md"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Dispatch job"
        className="relative w-[420px] max-w-full rounded-card border border-line bg-panel p-5 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.85)]"
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 6 }}
        transition={{ duration: 0.22, ease: EXPO_OUT }}
      >
        <div className="flex items-center justify-between">
          <Label className="text-fg">Dispatch Job</Label>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-elevated hover:text-fg"
          >
            <X size={15} />
          </button>
        </div>

        {/* task type */}
        <div className="mt-5">
          <Label className="text-fg-muted">Task Type</Label>
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            {TASK_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={cn(
                  'label rounded-control border px-2 py-2 transition-colors',
                  type === t
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : 'border-line text-fg-muted hover:bg-elevated hover:text-fg',
                )}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* target */}
        <div className="mt-5">
          <Label className="text-fg-muted">Target</Label>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="mono mt-2 h-9 w-full rounded-control border border-line bg-elevated px-3 text-[12px] text-fg outline-none focus:border-accent/40"
          >
            <option value="auto">Auto · next idle device</option>
            {idle.map((d) => (
              <option key={d.id} value={d.id}>
                {d.id} · {regionLabel(d.region)}
              </option>
            ))}
          </select>
          <p className="mono mt-2 text-[10px] text-fg-muted">
            {target === 'auto'
              ? `queued for the scheduler · ${idle.length} idle now`
              : 'dispatched immediately to the selected device'}
          </p>
        </div>

        <div className="mt-6 flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={busy} onClick={submit}>
            Dispatch
          </Button>
        </div>
      </motion.div>
    </div>
  )
}

export function SubmitJobDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <AnimatePresence>{open && <Inner onClose={onClose} />}</AnimatePresence>
}

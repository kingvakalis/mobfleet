import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useDialog } from '@/hooks/use-dialog'
import { useFleet } from '@/hooks/use-fleet'
import { regionLabel } from '@/data/regions'
import { AUTOMATIONS } from '@/data/automations'
import { client } from '@/lib/provider'
import { EXPO_OUT } from '@/lib/motion'
import { useUIStore } from '@/state/ui-store'
import { useToastStore } from '@/state/toast-store'
import { cn } from '@/lib/utils'

function Inner({ onClose, presetId }: { onClose: () => void; presetId: string | null }) {
  const snapshot = useFleet()
  const addToast = useToastStore((s) => s.addToast)
  const [automationId, setAutomationId] = useState(presetId ?? AUTOMATIONS[0].id)
  const [target, setTarget] = useState('auto')
  const [busy, setBusy] = useState(false)

  const idle = snapshot.devices.filter((d) => d.status === 'online')
  const automation = AUTOMATIONS.find((a) => a.id === automationId) ?? AUTOMATIONS[0]
  const dialogRef = useDialog<HTMLDivElement>(onClose)

  const submit = async () => {
    setBusy(true)
    try {
      const task = { type: automation.taskType, label: automation.name }
      if (target === 'auto') await client.enqueueTask(task)
      else await client.runTask(target, task)
      onClose()
    } catch (err) {
      // Surface the failure instead of leaving the dialog stuck "busy" with no
      // feedback (and an unhandled rejection in the console).
      console.error('[submit-job] dispatch failed', err)
      addToast('Could not dispatch the automation — please try again', 'error')
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
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Run automation"
        className="relative w-[440px] max-w-full rounded-card border border-line bg-panel p-5 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.85)] focus:outline-none"
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 6 }}
        transition={{ duration: 0.22, ease: EXPO_OUT }}
      >
        <div className="flex items-center justify-between">
          <Label className="text-fg">Run Automation</Label>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-elevated hover:text-fg"
          >
            <X size={15} />
          </button>
        </div>

        {/* automation */}
        <div className="mt-5">
          <Label className="text-fg-muted">Automation</Label>
          <div className="mt-2 grid grid-cols-1 gap-1.5">
            {AUTOMATIONS.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setAutomationId(a.id)}
                className={cn(
                  'flex items-center justify-between rounded-control border px-3 py-2 text-left transition-colors',
                  automationId === a.id
                    ? 'border-accent/40 bg-accent/10'
                    : 'border-line hover:bg-elevated',
                )}
              >
                <span className={cn('text-sm', automationId === a.id ? 'text-accent' : 'text-fg-secondary')}>
                  {a.name}
                </span>
                <span className="label text-fg-muted">{a.taskType}</span>
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
            aria-label="Target device"
            className="mono mt-2 h-9 w-full rounded-control border border-line bg-elevated px-3 text-[12px] text-fg outline-none focus:border-accent/40"
          >
            <option value="auto">Auto · next idle device</option>
            {idle.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} · {regionLabel(d.region)}
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
            Run
          </Button>
        </div>
      </motion.div>
    </div>
  )
}

export function SubmitJobDialog() {
  const open = useUIStore((s) => s.submitOpen)
  const close = useUIStore((s) => s.closeSubmit)
  const presetId = useUIStore((s) => s.submitAutomationId)
  return (
    <AnimatePresence>
      {open && <Inner key={presetId ?? 'new'} onClose={close} presetId={presetId} />}
    </AnimatePresence>
  )
}

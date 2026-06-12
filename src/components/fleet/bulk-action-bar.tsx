import { type ComponentType } from 'react'
import { motion } from 'framer-motion'
import { Play, Send, Square, Trash2, X } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { EXPO_OUT } from '@/lib/motion'
import { cn } from '@/lib/utils'

function BarBtn({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: ComponentType<{ size?: number }>
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'label flex h-8 items-center gap-1.5 rounded-control px-2.5 transition-colors',
        danger
          ? 'text-status-error hover:bg-status-error/10'
          : 'text-fg-secondary hover:bg-elevated hover:text-fg',
      )}
    >
      <Icon size={13} />
      {label}
    </button>
  )
}

/** Slides up from the bottom when devices are selected. */
export function BulkActionBar({
  count,
  onStart,
  onStop,
  onAssign,
  onRetire,
  onClear,
}: {
  count: number
  onStart: () => void
  onStop: () => void
  onAssign: () => void
  onRetire: () => void
  onClear: () => void
}) {
  return (
    <motion.div
      className="nodrag absolute bottom-4 left-1/2 z-20"
      initial={{ y: 80, opacity: 0, x: '-50%' }}
      animate={{ y: 0, opacity: 1, x: '-50%' }}
      exit={{ y: 80, opacity: 0, x: '-50%' }}
      transition={{ duration: 0.28, ease: EXPO_OUT }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1 rounded-card border border-line bg-panel/95 p-2 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.85)] backdrop-blur">
        <div className="flex items-center gap-2 px-3">
          <span className="mono text-sm text-fg">{count}</span>
          <Label className="text-fg-muted">Selected</Label>
        </div>
        <div className="mx-1 h-6 w-px bg-line" />
        <BarBtn icon={Play} label="Start" onClick={onStart} />
        <BarBtn icon={Square} label="Stop" onClick={onStop} />
        <BarBtn icon={Send} label="Assign" onClick={onAssign} />
        <BarBtn icon={Trash2} label="Retire" danger onClick={onRetire} />
        <div className="mx-1 h-6 w-px bg-line" />
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          className="flex h-8 w-8 items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-elevated hover:text-fg"
        >
          <X size={14} />
        </button>
      </div>
    </motion.div>
  )
}

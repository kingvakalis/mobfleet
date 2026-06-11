import { motion } from 'framer-motion'
import { VIEWS, type View } from '@/lib/views'
import { EXPO_OUT } from '@/lib/motion'
import { cn } from '@/lib/utils'

export function ViewSwitcher({
  value,
  onChange,
}: {
  value: View
  onChange: (v: View) => void
}) {
  return (
    <div className="flex items-center gap-1 rounded-control border border-line bg-panel p-1">
      {VIEWS.map((v) => {
        const active = v.id === value
        return (
          <button
            key={v.id}
            type="button"
            onClick={() => onChange(v.id)}
            aria-pressed={active}
            className={cn(
              'label relative rounded-[4px] px-3 py-1.5 transition-colors',
              active ? 'text-fg' : 'text-fg-muted hover:text-fg-secondary',
            )}
          >
            {active && (
              <motion.span
                layoutId="view-highlight"
                className="absolute inset-0 rounded-[4px] bg-elevated"
                transition={{ duration: 0.25, ease: EXPO_OUT }}
              />
            )}
            <span className="relative z-10">{v.label}</span>
          </button>
        )
      })}
    </div>
  )
}

import type { ComponentType, ReactNode } from 'react'
import { Lock } from 'lucide-react'

/**
 * Shared settings primitives — the card `Section`, the label/control `Field`
 * row, and the accent `Toggle` switch. Extracted from settings-view.tsx so the
 * Settings page and the Email settings page render identical controls (no
 * one-off switches) without a circular import between the two views.
 */

type IconComponent = ComponentType<{ size?: number | string; className?: string }>

export function Section({ icon: Icon, title, desc, children, wide, locked }: {
  icon: IconComponent; title: string; desc: string; children: ReactNode; wide?: boolean
  /** When true, every control inside is disabled (insufficient permission). */
  locked?: boolean
}) {
  return (
    <div className={`card-surface p-5 ${wide ? 'lg:col-span-2' : ''}`}>
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center border border-line bg-black/40">
          <Icon size={14} className="text-[var(--accent-text)]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13px] font-medium text-white/85">
            {title}
            {locked && <span className="flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[8px] uppercase tracking-wider text-white/35"><Lock size={8} /> Read-only</span>}
          </div>
          <div className="mt-0.5 text-[11px] text-white/35">{desc}</div>
        </div>
      </div>
      {/* fieldset[disabled] natively disables every control inside the section */}
      <fieldset disabled={locked} className={`space-y-4 border-0 p-0 m-0 ${locked ? 'opacity-50' : ''}`}>{children}</fieldset>
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <div className="min-w-0">
        <div className="text-[11px] text-white/60">{label}</div>
        {hint && <div className="mt-0.5 text-[10px] text-white/25">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className="relative h-5 w-9 rounded-full transition-colors"
      style={{ background: on ? 'var(--accent)' : 'rgba(148,163,184,0.18)' }}
    >
      <span
        className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform"
        style={{ transform: on ? 'translateX(18px)' : 'translateX(2px)' }}
      />
    </button>
  )
}

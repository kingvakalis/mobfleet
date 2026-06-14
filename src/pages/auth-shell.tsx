import { type InputHTMLAttributes, type ReactNode } from 'react'

/** Centered card shell shared by the login / signup / invite pages. */
export function AuthShell({ title, subtitle, children, footer }: {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-canvas px-4">
      {/* subtle backdrop grid + glow, matching the app's dark command-center look */}
      <div className="pointer-events-none absolute inset-0 opacity-60" style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(45,212,191,0.06), transparent 60%)' }} />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '40px 40px' }}
      />
      <div className="relative w-full max-w-[380px]">
        <div className="mb-6 text-center">
          <div className="mono mb-2 text-[11px] uppercase tracking-[0.3em] text-[var(--accent-text)]">MobFleet</div>
          <h1 className="text-lg font-semibold text-white">{title}</h1>
          {subtitle && <p className="mt-1 text-[13px] text-white/45">{subtitle}</p>}
        </div>
        <div className="card-surface rounded-card border border-line bg-panel/80 p-6 backdrop-blur-sm">{children}</div>
        {footer && <div className="mt-5 text-center text-[13px] text-white/45">{footer}</div>}
      </div>
    </div>
  )
}

/** Labeled text input in the app's form language. */
export function AuthField({ label, id, ...props }: { label: string; id: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={id} className="mono mb-1.5 block text-[10px] uppercase tracking-wider text-white/50">
        {label}
      </label>
      <input
        id={id}
        className="mono h-10 w-full rounded-control border border-line bg-elevated px-3 text-[13px] text-fg outline-none transition-colors focus:border-[var(--accent-border)] disabled:opacity-50"
        {...props}
      />
    </div>
  )
}

/** Inline error banner. */
export function AuthError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div role="alert" className="rounded-control border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
      {message}
    </div>
  )
}

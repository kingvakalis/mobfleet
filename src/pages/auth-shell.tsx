import { useEffect, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { MotionConfig, motion, type Variants } from 'framer-motion'
import { Eye, EyeOff, Lock, Mail, ShieldCheck } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { EXPO_OUT } from '@/lib/motion'

/**
 * Premium authentication shell — the entrance to the MobFleet command center.
 *
 * A balanced two-zone composition: a branded operations panel (the product's
 * own Fleet-constellation metaphor) fills the canvas on large screens, with the
 * authentication card in a refined, focused panel beside it. Collapses to a
 * single centered column on small screens. Reuses the global design tokens, so
 * it reacts automatically to the selected appearance preset (Obsidian /
 * Graphite / Midnight / Titanium / OLED). Purely presentational — every auth
 * page (Sign in / Sign up / Invite) composes this; none of the auth logic lives
 * here.
 */

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
}
const rise: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.42, ease: EXPO_OUT } },
}

export function AuthShell({ title, subtitle, children, footer }: {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <MotionConfig reducedMotion="user">
      <div className="relative flex min-h-[100dvh] w-full overflow-hidden bg-canvas text-fg">
        <AuthBackground />

        {/* Branded operations panel — large screens only (decorative). */}
        <motion.aside
          variants={container}
          initial="hidden"
          animate="show"
          className="relative z-10 hidden min-w-0 flex-1 flex-col justify-between overflow-hidden border-r border-line p-12 xl:p-16 lg:flex"
          aria-hidden
        >
          <BrandPanel />
        </motion.aside>

        {/* Authentication panel — the primary task. */}
        <main className="relative z-10 flex w-full flex-col items-center justify-center bg-panel/40 px-5 py-12 backdrop-blur-[2px] sm:px-6 lg:w-[min(50%,620px)] lg:flex-none lg:px-14">
          <motion.div
            variants={container}
            initial="hidden"
            animate="show"
            className="w-full max-w-[440px]"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            <motion.div variants={rise} className="mb-7">
              <div className="mono mb-5 flex items-center gap-2.5 text-[11px] uppercase tracking-[0.32em] text-[var(--accent-text)] lg:hidden">
                <CoreMark className="h-5 w-5" />
                MobFleet
              </div>
              <h1 className="text-[24px] font-semibold leading-tight tracking-tight text-white">{title}</h1>
              {subtitle && <p className="mt-1.5 text-[13.5px] leading-relaxed text-white/55">{subtitle}</p>}
            </motion.div>

            <motion.div
              variants={rise}
              className="card-surface scan-sweep relative overflow-hidden rounded-card border border-line bg-panel/70 p-6 backdrop-blur-sm sm:p-7"
            >
              <div className="hud-corners pointer-events-none absolute inset-0 rounded-card" />
              {children}
            </motion.div>

            {footer && <motion.div variants={rise} className="mt-6 text-center text-[13px] text-white/50">{footer}</motion.div>}

            <motion.div variants={rise}>
              <AuthStatus />
            </motion.div>
          </motion.div>
        </main>
      </div>
    </MotionConfig>
  )
}

/* ── Ambient background ──────────────────────────────────────────────────────
   Restrained, CSS-only depth using the app's shared atmosphere tokens: technical
   grid + soft radial light behind the card + grain + vignette. No WebGL, no
   video, no per-frame React state. */
function AuthBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 app-bg-grid" />
      <div className="absolute inset-0 app-bg-glow" />
      <div className="absolute inset-0 app-bg-noise" />
      <div className="absolute inset-0 app-bg-vignette" />
    </div>
  )
}

/* ── Brand / operations panel ───────────────────────────────────────────────── */
function BrandPanel() {
  return (
    <>
      <motion.div variants={rise} className="relative flex items-center gap-3">
        <CoreMark className="h-9 w-9" />
        <div>
          <div className="text-[15px] font-semibold tracking-tight text-white">MobFleet</div>
          <div className="mono text-[10px] uppercase tracking-[0.28em] text-white/40">Fleet Control Plane</div>
        </div>
      </motion.div>

      <motion.div variants={rise} className="relative flex flex-1 items-center justify-center py-10">
        <Constellation />
      </motion.div>

      <motion.div variants={rise} className="relative max-w-[440px]">
        <h2 className="text-[26px] font-semibold leading-tight tracking-tight text-white xl:text-[30px]">
          Command your entire device fleet from one console.
        </h2>
        <p className="mt-3 text-[14px] leading-relaxed text-white/55">
          Secure access to your remote fleet operations — real-time orchestration,
          role-scoped control, and live telemetry across every phone.
        </p>
        <ul className="mt-7 space-y-3">
          {[
            'Real-time device orchestration',
            'Role-scoped access control',
            'Live telemetry & job queue',
          ].map((f) => (
            <li key={f} className="flex items-center gap-3 text-[13px] text-white/70">
              <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)]">
                <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="var(--accent-text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.5 6.5 5 9l4.5-5.5" />
                </svg>
              </span>
              {f}
            </li>
          ))}
        </ul>
      </motion.div>
    </>
  )
}

/** Brand glyph — a luminous core ring, echoing the orchestrator node. */
function CoreMark({ className }: { className?: string }) {
  return (
    <span
      className={`relative inline-flex items-center justify-center rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] ${className ?? ''}`}
      style={{ boxShadow: 'inset 0 0 12px rgba(45,212,191,0.25)' }}
      aria-hidden
    >
      <span className="h-1/3 w-1/3 rounded-full bg-[var(--accent)]" style={{ boxShadow: '0 0 8px rgba(45,212,191,0.8)' }} />
    </span>
  )
}

/** Page-visibility flag — lets us pause ambient motion on hidden tabs. */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden)
  useEffect(() => {
    const on = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return visible
}

/** CSS-only orbiting constellation — the product metaphor, restrained. Two slow
 *  counter-rotating rings of device nodes around a luminous core. Paused while
 *  the tab is hidden; the global reduced-motion rule freezes it entirely. */
function Constellation() {
  const visible = usePageVisible()
  const play = visible ? 'running' : 'paused'
  const node = (color: string) => ({ background: color, boxShadow: `0 0 10px ${color}` }) as const
  const ring1 = [
    { a: 30, c: 'var(--status-online)' },
    { a: 150, c: 'var(--status-busy)' },
    { a: 265, c: 'var(--status-warming)' },
  ]
  const ring2 = [
    { a: 10, c: 'var(--status-busy)' },
    { a: 70, c: 'var(--status-online)' },
    { a: 130, c: 'var(--status-online)' },
    { a: 200, c: 'var(--status-warming)' },
    { a: 260, c: 'var(--status-busy)' },
    { a: 320, c: 'var(--status-online)' },
  ]
  return (
    <div className="relative h-[340px] w-[340px]">
      <div className="absolute inset-0 rounded-full" style={{ background: 'radial-gradient(circle at center, rgba(45,212,191,0.10), transparent 62%)' }} />

      <div className="absolute left-1/2 top-1/2 h-[200px] w-[200px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.07]" />
      <div className="absolute left-1/2 top-1/2 h-[320px] w-[320px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/[0.05]" />

      <div className="spin-slow absolute left-1/2 top-1/2 h-[200px] w-[200px] -translate-x-1/2 -translate-y-1/2" style={{ animationPlayState: play }}>
        {ring1.map((d) => (
          <span key={d.a} className="absolute left-1/2 top-1/2 h-2.5 w-2.5 rounded-full" style={{ ...node(d.c), transform: `translate(-50%,-50%) rotate(${d.a}deg) translateY(-100px)` }} />
        ))}
      </div>
      <div className="spin-slow-rev absolute left-1/2 top-1/2 h-[320px] w-[320px] -translate-x-1/2 -translate-y-1/2" style={{ animationPlayState: play }}>
        {ring2.map((d) => (
          <span key={d.a} className="absolute left-1/2 top-1/2 h-2.5 w-2.5 rounded-full" style={{ ...node(d.c), transform: `translate(-50%,-50%) rotate(${d.a}deg) translateY(-160px)` }} />
        ))}
      </div>

      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="flex h-16 w-16 items-center justify-center rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] backdrop-blur-sm" style={{ boxShadow: 'inset 0 0 18px rgba(45,212,191,0.3), 0 0 40px rgba(45,212,191,0.18)' }}>
          <div className="h-5 w-5 rounded-full bg-[var(--accent)]" style={{ boxShadow: '0 0 14px rgba(45,212,191,0.9)' }} />
        </div>
        <div className="status-dot-pulse absolute inset-0 -z-10 rounded-full" style={{ boxShadow: '0 0 60px 10px rgba(45,212,191,0.12)', animationPlayState: play }} />
      </div>
    </div>
  )
}

/** Restrained trust line — truthful, no fake "operational" status. */
function AuthStatus() {
  return (
    <div className="mono mt-8 flex items-center justify-center gap-2 text-[10px] uppercase tracking-[0.18em] text-white/30">
      <ShieldCheck size={12} className="text-[var(--accent-text)]/70" aria-hidden />
      Encrypted session · role-based access
    </div>
  )
}

/* ── Form primitives ──────────────────────────────────────────────────────────
   Shared input language. Labels are always present (not placeholder-only),
   icons are decorative, autocomplete/password-manager attributes pass straight
   through, and error state wires aria-invalid for screen readers. */

type FieldProps = { label: string; id: string; icon?: 'email' | 'lock'; error?: boolean } & InputHTMLAttributes<HTMLInputElement>

const ICONS = { email: Mail, lock: Lock } as const

const fieldBase =
  'mono h-11 w-full rounded-control border bg-elevated text-[13px] text-fg outline-none transition-[border-color,box-shadow] placeholder:text-white/25 disabled:opacity-50'

export function AuthField({ label, id, icon, error, ...props }: FieldProps) {
  const Icon = icon ? ICONS[icon] : null
  return (
    <div>
      <label htmlFor={id} className="mono mb-1.5 block text-[10px] uppercase tracking-wider text-white/50">
        {label}
      </label>
      <div className="relative">
        {Icon && (
          <Icon size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/35" />
        )}
        <input
          id={id}
          aria-invalid={error || undefined}
          className={`${fieldBase} ${Icon ? 'pl-9 pr-3' : 'px-3'} ${
            error
              ? 'border-red-500/45 focus:border-red-500/70 focus:shadow-[0_0_0_3px_rgba(239,68,68,0.12)]'
              : 'border-line focus:border-[var(--accent-border)] focus:shadow-[0_0_0_3px_var(--accent-soft)]'
          }`}
          {...props}
        />
      </div>
    </div>
  )
}

/** Password input with an accessible show/hide control. Keeps the field type a
 *  real password (managers + autofill work) and never renders the raw value. */
export function PasswordField({ label, id, error, ...props }: Omit<FieldProps, 'icon'>) {
  const [show, setShow] = useState(false)
  return (
    <div>
      <label htmlFor={id} className="mono mb-1.5 block text-[10px] uppercase tracking-wider text-white/50">
        {label}
      </label>
      <div className="relative">
        <Lock size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/35" />
        <input
          id={id}
          type={show ? 'text' : 'password'}
          aria-invalid={error || undefined}
          className={`${fieldBase} pl-9 pr-10 ${
            error
              ? 'border-red-500/45 focus:border-red-500/70 focus:shadow-[0_0_0_3px_rgba(239,68,68,0.12)]'
              : 'border-line focus:border-[var(--accent-border)] focus:shadow-[0_0_0_3px_var(--accent-soft)]'
          }`}
          {...props}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Hide password' : 'Show password'}
          aria-pressed={show}
          tabIndex={-1}
          className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-control text-white/40 transition-colors hover:text-white/80"
        >
          {show ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
        </button>
      </div>
    </div>
  )
}

/** Inline error banner — assertive for screen readers, plain language only. */
export function AuthError({ message }: { message: string | null }) {
  return (
    <div aria-live="assertive" className="empty:hidden">
      {message && (
        <motion.div
          role="alert"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: EXPO_OUT }}
          className="rounded-control border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] leading-relaxed text-red-300"
        >
          {message}
        </motion.div>
      )}
    </div>
  )
}

/** Primary submit — the dashboard's accent CTA language, with a no-layout-shift
 *  loading state (fixed height, spinner swaps in place). */
export function AuthSubmit({ busy, busyLabel, children }: { busy: boolean; busyLabel: string; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={busy}
      aria-busy={busy}
      className="btn-accent mono flex h-11 w-full items-center justify-center gap-2 rounded-control text-[11px] uppercase tracking-widest"
    >
      {busy ? (
        <>
          <Spinner size={14} />
          {busyLabel}
        </>
      ) : (
        children
      )}
    </button>
  )
}

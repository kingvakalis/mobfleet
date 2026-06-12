import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, RotateCcw, Save, Monitor, Gauge, Bell, Building2 } from 'lucide-react'
import { EXPO_OUT } from '@/lib/motion'
import {
  useSettings, DEFAULT_SETTINGS,
  type WorkspaceSettings, type PerformanceMode,
} from '@/state/settings-store'

/**
 * Workspace settings. Every control here is consumed by real app logic:
 *  - performanceMode / reduceMotion → ambient backgrounds + 3D fleet quality
 *  - defaultStreamQuality / FPS    → phone-control initial slider state
 *  - confirmDestructive            → reboot / retire confirmation prompts
 *  - activityNotifications         → live activity feed default state
 * Persistence is local (documented backend integration point in settings-store).
 */

function Section({ icon: Icon, title, desc, children }: {
  icon: typeof Monitor; title: string; desc: string; children: React.ReactNode
}) {
  return (
    <div className="card-surface p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center border border-line bg-black/40">
          <Icon size={14} className="text-[var(--accent-text)]" />
        </div>
        <div>
          <div className="text-[13px] font-medium text-white/85">{title}</div>
          <div className="mt-0.5 text-[11px] text-white/35">{desc}</div>
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
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

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
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

const PERF_MODES: { id: PerformanceMode; label: string; desc: string }[] = [
  { id: 'full',     label: 'Full',     desc: 'All atmosphere, grain, and 3D effects' },
  { id: 'balanced', label: 'Balanced', desc: 'Static backgrounds, full 3D' },
  { id: 'reduced',  label: 'Reduced',  desc: 'No decorative rendering' },
]

export function SettingsView() {
  const store = useSettings()
  const [draft, setDraft] = useState<WorkspaceSettings>({
    workspaceName: store.workspaceName,
    operatorName: store.operatorName,
    performanceMode: store.performanceMode,
    reduceMotion: store.reduceMotion,
    defaultStreamQuality: store.defaultStreamQuality,
    defaultStreamFps: store.defaultStreamFps,
    confirmDestructive: store.confirmDestructive,
    activityNotifications: store.activityNotifications,
  })
  const [saved, setSaved] = useState(false)

  const dirty =
    draft.workspaceName !== store.workspaceName ||
    draft.operatorName !== store.operatorName ||
    draft.performanceMode !== store.performanceMode ||
    draft.reduceMotion !== store.reduceMotion ||
    draft.defaultStreamQuality !== store.defaultStreamQuality ||
    draft.defaultStreamFps !== store.defaultStreamFps ||
    draft.confirmDestructive !== store.confirmDestructive ||
    draft.activityNotifications !== store.activityNotifications

  const valid =
    draft.workspaceName.trim().length > 0 &&
    draft.defaultStreamQuality >= 0 && draft.defaultStreamQuality <= 100 &&
    draft.defaultStreamFps >= 5 && draft.defaultStreamFps <= 60

  useEffect(() => {
    if (!saved) return
    const id = setTimeout(() => setSaved(false), 1800)
    return () => clearTimeout(id)
  }, [saved])

  const set = <K extends keyof WorkspaceSettings>(k: K, v: WorkspaceSettings[K]) =>
    setDraft(d => ({ ...d, [k]: v }))

  const save = () => {
    if (!valid) return
    store.update(draft)
    setSaved(true)
  }

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <div>
          <p className="mono mb-1 text-[9px] uppercase tracking-[0.2em] text-white/30">Workspace</p>
          <h1 className="mono text-lg font-bold uppercase tracking-widest text-white">Settings</h1>
        </div>
        <div className="flex items-center gap-2">
          <AnimatePresence>
            {dirty && (
              <motion.span
                initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                className="mono text-[10px] uppercase tracking-wider text-amber-400"
              >
                Unsaved changes
              </motion.span>
            )}
          </AnimatePresence>
          <button
            onClick={() => { setDraft({ ...DEFAULT_SETTINGS }); }}
            className="btn-ghost mono flex h-8 items-center gap-1.5 px-3 text-[10px] uppercase tracking-widest"
          >
            <RotateCcw size={11} /> Defaults
          </button>
          <button
            onClick={save}
            disabled={!dirty || !valid}
            title={!valid ? 'Fix validation errors first' : undefined}
            className="btn-accent mono flex h-8 items-center gap-1.5 px-4 text-[10px] uppercase tracking-widest"
          >
            {saved ? <Check size={12} /> : <Save size={12} />} {saved ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EXPO_OUT }}
          className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-4 lg:grid-cols-2"
        >
          <Section icon={Building2} title="Workspace" desc="Identity shown across the console.">
            <Field label="Workspace name">
              <input
                value={draft.workspaceName}
                onChange={e => set('workspaceName', e.target.value)}
                className="mono h-8 w-44 rounded-control border border-line bg-elevated px-2.5 text-[12px] text-fg outline-none transition-colors focus:border-[var(--accent-border)]"
              />
            </Field>
            <Field label="Operator name" hint="Used to attribute actions in the activity feed">
              <input
                value={draft.operatorName}
                onChange={e => set('operatorName', e.target.value)}
                className="mono h-8 w-44 rounded-control border border-line bg-elevated px-2.5 text-[12px] text-fg outline-none transition-colors focus:border-[var(--accent-border)]"
              />
            </Field>
          </Section>

          <Section icon={Monitor} title="Appearance & Performance" desc="Drives ambient backgrounds and 3D rendering quality.">
            <div className="grid grid-cols-3 gap-1.5">
              {PERF_MODES.map(m => (
                <button
                  key={m.id}
                  onClick={() => set('performanceMode', m.id)}
                  className={[
                    'border px-2.5 py-2.5 text-left transition-colors',
                    draft.performanceMode === m.id
                      ? 'border-[var(--accent-border)] bg-[var(--accent-soft)]'
                      : 'border-line hover:bg-hover',
                  ].join(' ')}
                >
                  <div className={['mono text-[10px] uppercase tracking-wider', draft.performanceMode === m.id ? 'text-[var(--accent-text)]' : 'text-white/60'].join(' ')}>{m.label}</div>
                  <div className="mt-1 text-[9px] leading-snug text-white/30">{m.desc}</div>
                </button>
              ))}
            </div>
            <Field label="Reduce motion" hint="Overrides OS preference; disables ambient and idle animation">
              <Toggle on={draft.reduceMotion} onChange={v => set('reduceMotion', v)} label="Reduce motion" />
            </Field>
          </Section>

          <Section icon={Gauge} title="Device Control" desc="Defaults applied when opening a phone-control session.">
            <Field label="Default stream quality" hint="0–100">
              <input
                type="number" min={0} max={100}
                value={draft.defaultStreamQuality}
                onChange={e => set('defaultStreamQuality', Number(e.target.value))}
                className={[
                  'mono h-8 w-20 rounded-control border bg-elevated px-2.5 text-[12px] text-fg outline-none transition-colors',
                  draft.defaultStreamQuality >= 0 && draft.defaultStreamQuality <= 100 ? 'border-line focus:border-[var(--accent-border)]' : 'border-status-error',
                ].join(' ')}
              />
            </Field>
            <Field label="Default stream FPS" hint="5–60">
              <input
                type="number" min={5} max={60}
                value={draft.defaultStreamFps}
                onChange={e => set('defaultStreamFps', Number(e.target.value))}
                className={[
                  'mono h-8 w-20 rounded-control border bg-elevated px-2.5 text-[12px] text-fg outline-none transition-colors',
                  draft.defaultStreamFps >= 5 && draft.defaultStreamFps <= 60 ? 'border-line focus:border-[var(--accent-border)]' : 'border-status-error',
                ].join(' ')}
              />
            </Field>
            <Field label="Confirm destructive actions" hint="Ask before reboot and retire">
              <Toggle on={draft.confirmDestructive} onChange={v => set('confirmDestructive', v)} label="Confirm destructive actions" />
            </Field>
          </Section>

          <Section icon={Bell} title="Notifications" desc="Live event surfacing across the console.">
            <Field label="Live activity feed" hint="Stream fleet events into the Fleet activity panel">
              <Toggle on={draft.activityNotifications} onChange={v => set('activityNotifications', v)} label="Live activity feed" />
            </Field>
            <p className="border-t border-line pt-3 text-[10px] leading-relaxed text-white/25">
              Settings persist in this browser. Server-side workspace settings are a
              documented backend integration point (state/settings-store.ts).
            </p>
          </Section>
        </motion.div>
      </div>
    </div>
  )
}

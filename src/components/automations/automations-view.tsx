import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Play, Pause, Plus, X, Trash2, ArrowUp, ArrowDown, Pencil, Copy } from 'lucide-react'
import { useAutomations } from '@/hooks/use-automations'
import { useUIStore } from '@/state/ui-store'
import { useActingEmployee } from '@/lib/authorization/use-access'
import { can } from '@/lib/authorization'
import { logAudit } from '@/services/audit'
import { EXPO_OUT, fadeRise, staggerContainer } from '@/lib/motion'
import {
  useAutomationLocal, STEP_META, defaultSteps, newStepId,
  type AutomationStep, type CustomAutomation, type StepKind,
} from '@/services/automations-local'
import type { TaskType } from '@/shared/types'
import { AUTH_SOURCE } from '@/auth/auth-source'
import { isSupabaseConfigured } from '@/lib/supabase'
import { useTeamContext } from '@/contexts/TeamContext'
import { useSupabaseAutomations } from '@/hooks/useSupabaseAutomations'
import { useToastStore } from '@/state/toast-store'

const SUPABASE_MODE = AUTH_SOURCE === 'supabase' && isSupabaseConfigured

type AuditAction = 'automation.edited' | 'automation.run' | 'automation.deleted'

const ADDABLE_STEPS: StepKind[] = ['open-app', 'wait', 'tap', 'type', 'swipe', 'screenshot']
const TASK_TYPES: TaskType[] = ['warmup', 'upload', 'engage', 'post']

interface Row {
  id: string
  name: string
  description: string
  taskType: TaskType
  successRate: number
  runs: number
  lastRun: string
  paused: boolean
  custom: boolean
  steps?: AutomationStep[]
}

// ─── Builder modal — a real editor that saves real automations ───────────────

function BuilderModal({ initial, onSave, onClose }: { initial: CustomAutomation | null; onSave: (a: CustomAutomation) => Promise<void> | void; onClose: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [taskType, setTaskType] = useState<TaskType>(initial?.taskType ?? 'warmup')
  const [steps, setSteps] = useState<AutomationStep[]>(initial?.steps ?? defaultSteps())
  const [dirty, setDirty] = useState(false)
  const [selectedStep, setSelectedStep] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)

  const valid = name.trim().length > 1 && steps.length >= 2

  const mutate = (fn: (s: AutomationStep[]) => AutomationStep[]) => {
    setSteps(fn)
    setDirty(true)
  }

  const addStep = (kind: StepKind) =>
    mutate(s => {
      const endIdx = s.findIndex(x => x.kind === 'end')
      const step = { id: newStepId(), kind, config: '' }
      const next = [...s]
      next.splice(endIdx === -1 ? s.length : endIdx, 0, step)
      return next
    })

  const removeStep = (id: string) => mutate(s => s.filter(x => x.id !== id))
  const move = (id: string, dir: -1 | 1) =>
    mutate(s => {
      const i = s.findIndex(x => x.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= s.length) return s
      if (s[i].kind === 'start' || s[i].kind === 'end') return s
      if (s[j].kind === 'start' || s[j].kind === 'end') return s
      const next = [...s]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const save = async () => {
    if (!valid || saving) return
    setSaving(true); setSaveErr(null)
    try {
      await onSave({
        id: initial?.id ?? 'custom-' + newStepId(),
        name: name.trim(),
        description: description.trim() || 'Custom automation',
        taskType,
        steps,
        createdAt: initial?.createdAt ?? Date.now(),
      })
      onClose()
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Could not save automation')
      setSaving(false)
    }
  }

  const tryClose = () => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return
    onClose()
  }

  const sel = steps.find(s => s.id === selectedStep)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={tryClose} />
      <motion.div
        role="dialog" aria-modal="true" aria-label="Automation builder"
        initial={{ opacity: 0, scale: 0.97, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
        transition={{ duration: 0.22, ease: EXPO_OUT }}
        className="relative flex max-h-[85vh] w-[640px] flex-col border border-line bg-panel"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <span className="label text-fg">{initial ? 'Edit Automation' : 'New Automation'}</span>
          <div className="flex items-center gap-3">
            {dirty && <span className="mono text-[9px] uppercase tracking-wider text-amber-400">Unsaved</span>}
            <button onClick={tryClose} aria-label="Close" className="text-fg-muted hover:text-fg"><X size={15} /></button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {/* meta */}
          <div className="grid grid-cols-2 gap-3">
            <input
              value={name}
              onChange={e => { setName(e.target.value); setDirty(true) }}
              placeholder="Automation name"
              className="mono h-9 rounded-control border border-line bg-elevated px-3 text-[12px] text-fg outline-none transition-colors focus:border-[var(--accent-border)]"
            />
            <select
              value={taskType}
              onChange={e => { setTaskType(e.target.value as TaskType); setDirty(true) }}
              aria-label="Task type"
              className="mono h-9 rounded-control border border-line bg-elevated px-2 text-[12px] text-fg-secondary outline-none focus:border-[var(--accent-border)]"
            >
              {TASK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <input
            value={description}
            onChange={e => { setDescription(e.target.value); setDirty(true) }}
            placeholder="What does this automation do?"
            className="mono h-9 w-full rounded-control border border-line bg-elevated px-3 text-[12px] text-fg outline-none transition-colors focus:border-[var(--accent-border)]"
          />

          {/* step list */}
          <div>
            <div className="label mb-2 text-fg-muted">Steps</div>
            <div className="space-y-1.5">
              {steps.map((step, i) => {
                const meta = STEP_META[step.kind]
                const locked = step.kind === 'start' || step.kind === 'end'
                const active = selectedStep === step.id
                return (
                  <div
                    key={step.id}
                    className={[
                      'flex items-center gap-2 border px-3 py-2 transition-colors cursor-pointer',
                      active ? 'border-[var(--accent-border)] bg-[var(--accent-soft)]' : 'border-line hover:bg-hover',
                    ].join(' ')}
                    onClick={() => setSelectedStep(active ? null : step.id)}
                  >
                    <span className="mono w-5 text-[10px] text-white/25">{i + 1}</span>
                    <span
                      className="mono px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                      style={{ color: meta.color, background: meta.color + '15', border: `1px solid ${meta.color}30` }}
                    >
                      {meta.label}
                    </span>
                    <span className="mono flex-1 truncate text-[11px] text-white/45">{step.config}</span>
                    {!locked && (
                      <span className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
                        <button onClick={() => move(step.id, -1)} aria-label="Move up" className="p-1 text-white/25 hover:text-white/70"><ArrowUp size={11} /></button>
                        <button onClick={() => move(step.id, 1)} aria-label="Move down" className="p-1 text-white/25 hover:text-white/70"><ArrowDown size={11} /></button>
                        <button onClick={() => removeStep(step.id)} aria-label="Delete step" className="p-1 text-white/25 hover:text-status-error"><Trash2 size={11} /></button>
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

            {/* step config */}
            {sel && STEP_META[sel.kind].configHint && (
              <div className="mt-2 border border-line bg-black/30 p-3">
                <div className="label mb-1.5 text-fg-muted">{STEP_META[sel.kind].label} — {STEP_META[sel.kind].configHint}</div>
                <input
                  value={sel.config}
                  onChange={e => mutate(s => s.map(x => x.id === sel.id ? { ...x, config: e.target.value } : x))}
                  placeholder={STEP_META[sel.kind].configHint}
                  className="mono h-8 w-full rounded-control border border-line bg-elevated px-2.5 text-[12px] text-fg outline-none focus:border-[var(--accent-border)]"
                />
              </div>
            )}

            {/* add step */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {ADDABLE_STEPS.map(kind => (
                <button
                  key={kind}
                  onClick={() => addStep(kind)}
                  className="btn-ghost mono px-2.5 py-1.5 text-[10px] uppercase tracking-wider"
                >
                  + {STEP_META[kind].label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-line p-4">
          {saveErr && <p className="mb-2 text-[11px] text-status-error">{saveErr}</p>}
          <button
            onClick={() => void save()}
            disabled={!valid || saving}
            title={!valid ? 'Name and at least one step are required' : undefined}
            className="btn-accent mono w-full py-2.5 text-[11px] uppercase tracking-widest"
          >
            {saving ? 'Saving…' : 'Save Automation'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ─── Shared presentational body (mode-agnostic) ───────────────────────────────

interface AutomationsBodyProps {
  rows: Row[]
  perms: { canCreate: boolean; canRun: boolean; canEdit: boolean; canDelete: boolean }
  /** Session-audit hook for demo/me-mode; a no-op in supabase-mode (DB triggers record it). */
  audit: (action: AuditAction, target: string, detail?: string) => void
  onSave: (a: CustomAutomation) => Promise<void> | void
  onTogglePaused: (row: Row) => Promise<unknown> | void
  onRun: (row: Row) => Promise<unknown> | void
  onDelete: (row: Row) => Promise<unknown> | void
}

function AutomationsBody({ rows, perms, audit, onSave, onTogglePaused, onRun, onDelete }: AutomationsBodyProps) {
  const { canCreate, canRun, canEdit, canDelete } = perms
  const [search, setSearch] = useState('')
  const [builder, setBuilder] = useState<{ open: boolean; editing: CustomAutomation | null }>({ open: false, editing: null })

  const toEditing = (row: Row): CustomAutomation => ({
    id: row.id, name: row.name, description: row.description, taskType: row.taskType,
    steps: row.steps ?? defaultSteps(), createdAt: Date.now(),
  })

  const visible = rows.filter(a =>
    search === '' ||
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.taskType.includes(search.toLowerCase())
  )

  const active = rows.filter(a => !a.paused).length
  const pausedCount = rows.length - active
  const totalRuns = rows.reduce((s, a) => s + a.runs, 0)

  const duplicate = (row: Row) => {
    setBuilder({
      open: true,
      editing: {
        id: 'custom-' + newStepId(),
        name: row.name + ' (copy)',
        description: row.description,
        taskType: row.taskType,
        steps: row.steps ?? defaultSteps(),
        createdAt: Date.now(),
      },
    })
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <div>
          <p className="mono mb-1 text-[9px] uppercase tracking-[0.2em] text-white/30">Fleet</p>
          <h1 className="mono text-lg font-bold uppercase tracking-widest text-white">Automations</h1>
        </div>
        <button
          onClick={() => setBuilder({ open: true, editing: null })}
          disabled={!canCreate}
          title={canCreate ? 'Create a new automation' : 'Requires create permission'}
          className="btn-accent mono flex h-8 items-center gap-1.5 px-4 text-[10px] uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={12} /> New Automation
        </button>
      </div>

      {/* KPI */}
      <div className="flex gap-3 border-b border-line px-6 py-3">
        {[
          { label: 'Total',      value: rows.length, color: 'text-white/80' },
          { label: 'Active',     value: active,      color: 'text-emerald-400' },
          { label: 'Paused',     value: pausedCount, color: 'text-amber-400' },
          { label: 'Total Runs', value: totalRuns,   color: 'text-[var(--accent-text)]' },
        ].map(k => (
          <div key={k.label} className="card-surface flex flex-col px-4 py-2">
            <span className="text-[10px] uppercase tracking-wider text-white/30">{k.label}</span>
            <span className={['mono mt-0.5 text-xl font-semibold tabular-nums', k.color].join(' ')}>{k.value.toLocaleString()}</span>
          </div>
        ))}
        <div className="ml-auto flex items-center">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search automations..."
            className="h-8 w-52 rounded-lg border border-line bg-white/[0.03] px-3 text-xs text-white/80 placeholder-white/25 outline-none transition-colors focus:border-[var(--accent-border)]"
          />
        </div>
      </div>

      {/* Cards grid */}
      <div className="flex-1 overflow-auto p-6">
        <motion.div variants={staggerContainer} initial="hidden" animate="show" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map(a => (
            <motion.div key={a.id} variants={fadeRise} whileHover={{ y: -2 }} className="card-surface flex flex-col gap-3 rounded-2xl p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-white/90">
                    {a.name}
                    {a.custom && <span className="mono text-[8px] uppercase tracking-wider text-white/30 border border-line px-1 py-0.5">Custom</span>}
                  </h2>
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-white/35">{a.description}</p>
                </div>
                <span className={[
                  'ml-2 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
                  !a.paused ? 'bg-emerald-400/10 text-emerald-400' : 'bg-amber-400/10 text-amber-400',
                ].join(' ')}>
                  {a.paused ? 'paused' : 'active'}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-white/[0.03] py-2">
                  <div className="text-sm font-semibold text-white/80">{a.successRate}%</div>
                  <div className="text-[9px] text-white/25">Success</div>
                </div>
                <div className="rounded-lg bg-white/[0.03] py-2">
                  <div className="text-sm font-semibold text-white/80">{a.runs.toLocaleString()}</div>
                  <div className="text-[9px] text-white/25">Runs</div>
                </div>
                <div className="rounded-lg bg-white/[0.03] py-2">
                  <div className="text-sm font-semibold text-white/50">{a.lastRun}</div>
                  <div className="text-[9px] text-white/25">Last run</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-1">
                <span className="rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[9px] text-[var(--accent-text)]">{a.taskType}</span>
              </div>

              <div className="flex gap-1.5 border-t border-line pt-2">
                <button
                  type="button"
                  disabled={!canEdit}
                  title={canEdit ? undefined : 'Requires edit permission'}
                  onClick={() => { void onTogglePaused(a); audit('automation.edited', a.name, a.paused ? 'resumed' : 'paused') }}
                  className={[
                    'flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-35',
                    !a.paused
                      ? 'bg-amber-400/10 text-amber-400 enabled:hover:bg-amber-400/20'
                      : 'bg-emerald-400/10 text-emerald-400 enabled:hover:bg-emerald-400/20',
                  ].join(' ')}
                >
                  {!a.paused ? <><Pause size={10} /> Pause</> : <><Play size={10} /> Resume</>}
                </button>
                <button
                  type="button"
                  disabled={a.paused || !canRun}
                  title={!canRun ? 'Requires run permission' : a.paused ? 'Resume the automation to run it' : undefined}
                  onClick={() => { void onRun(a); audit('automation.run', a.name) }}
                  className="btn-accent flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-[10px] disabled:opacity-35 disabled:cursor-not-allowed"
                >
                  <Play size={10} /> Run Now
                </button>
                {a.custom ? (
                  <>
                    {canEdit && (
                      <button
                        type="button"
                        title="Edit"
                        onClick={() => setBuilder({ open: true, editing: toEditing(a) })}
                        className="btn-ghost flex items-center justify-center rounded-lg px-2.5"
                      >
                        <Pencil size={11} />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        title="Delete"
                        onClick={() => { if (window.confirm(`Delete "${a.name}"?`)) { void onDelete(a); audit('automation.deleted', a.name) } }}
                        className="flex items-center justify-center rounded-lg border border-status-error/25 px-2.5 text-status-error transition-colors hover:bg-status-error/10"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={!canCreate}
                    title={canCreate ? 'Duplicate as custom automation' : 'Requires create permission'}
                    onClick={() => duplicate(a)}
                    className="btn-ghost flex items-center justify-center rounded-lg px-2.5 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Copy size={11} />
                  </button>
                )}
              </div>
            </motion.div>
          ))}
        </motion.div>
        {visible.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center text-sm text-white/40">
            No automations match "{search}"
          </div>
        )}
      </div>

      <AnimatePresence>
        {builder.open && (
          <BuilderModal
            key={builder.editing?.id ?? 'new'}
            initial={builder.editing}
            onSave={onSave}
            onClose={() => setBuilder({ open: false, editing: null })}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── demo / me-mode (presets + localStorage custom; unchanged behavior) ───────
function DemoAutomationsView() {
  const providerList = useAutomations()
  const { paused, custom, togglePaused, removeCustom, saveCustom } = useAutomationLocal()
  const openSubmit = useUIStore(s => s.openSubmit)
  const { employee, member } = useActingEmployee()

  const rows = useMemo<Row[]>(() => [
    ...providerList.map(a => ({
      id: a.id, name: a.name, description: a.description, taskType: a.taskType,
      successRate: a.successRate, runs: a.runs, lastRun: a.lastRun,
      paused: !!paused[a.id], custom: false,
    })),
    ...custom.map(c => ({
      id: c.id, name: c.name, description: c.description, taskType: c.taskType,
      successRate: 100, runs: 0, lastRun: 'never',
      paused: !!paused[c.id], custom: true, steps: c.steps,
    })),
  ], [providerList, custom, paused])

  return (
    <AutomationsBody
      rows={rows}
      perms={{ canCreate: can(member, 'automations.create'), canRun: can(member, 'automations.run'), canEdit: can(member, 'automations.edit'), canDelete: can(member, 'automations.delete') }}
      audit={(action, target, detail) => logAudit({ actor: employee.name, action, target, detail, result: 'success' })}
      onSave={(a) => saveCustom(a)}
      onTogglePaused={(row) => togglePaused(row.id)}
      onRun={(row) => openSubmit(row.custom ? undefined : row.id)}
      onDelete={(row) => removeCustom(row.id)}
    />
  )
}

// ─── supabase-mode (real automations table + automation_jobs metrics; no localStorage,
// no /v1/automations, no fabricated metrics) ───────────────────────────────────
function SupabaseAutomationsView() {
  const { team } = useTeamContext()
  const sa = useSupabaseAutomations(team?.id ?? null)
  const { member } = useActingEmployee()
  const addToast = useToastStore(s => s.addToast)

  const rows = useMemo<Row[]>(() => sa.automations.map(a => ({
    id: a.id, name: a.name, description: a.description, taskType: a.taskType,
    successRate: a.successRate, runs: a.runs, lastRun: a.lastRun,
    paused: a.paused, custom: true, steps: a.steps,
  })), [sa.automations])

  const save = async (a: CustomAutomation) => {
    // A 'custom-'-prefixed id is a brand-new (unsaved) automation → insert; a real UUID → update.
    const r = await sa.saveAutomation({ id: a.id.startsWith('custom-') ? undefined : a.id, name: a.name, description: a.description, taskType: a.taskType, steps: a.steps })
    if (r?.error) throw new Error(r.error)
  }
  const run = async (row: Row) => {
    const summary = sa.automations.find(a => a.id === row.id)
    if (!summary) return
    const r = await sa.runAutomation(summary, null)
    addToast(r?.error ? `Run failed: ${r.error}` : `Queued a run of ${summary.name}`, r?.error ? 'error' : 'success')
  }
  const toggle = async (row: Row) => { const r = await sa.togglePaused(row.id); if (r?.error) addToast(`Could not update: ${r.error}`, 'error') }
  const del = async (row: Row) => { const r = await sa.deleteAutomation(row.id); if (r?.error) addToast(`Delete failed: ${r.error}`, 'error') }

  return (
    <AutomationsBody
      rows={rows}
      perms={{ canCreate: can(member, 'automations.create'), canRun: can(member, 'automations.run'), canEdit: can(member, 'automations.edit'), canDelete: can(member, 'automations.delete') }}
      audit={() => { /* supabase: activity recorded by DB triggers (automation.*) */ }}
      onSave={save}
      onTogglePaused={toggle}
      onRun={run}
      onDelete={del}
    />
  )
}

export function AutomationsView() {
  return SUPABASE_MODE ? <SupabaseAutomationsView /> : <DemoAutomationsView />
}

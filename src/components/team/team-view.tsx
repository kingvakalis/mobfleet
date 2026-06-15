import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Plus, X, Users, Smartphone, Coffee, LogOut, LogIn, Calendar,
  ShieldCheck, Trash2, Ban, CheckCircle2, ChevronRight, ChevronDown, Eye, Copy, Mail, Clock,
} from 'lucide-react'
import { EXPO_OUT } from '@/lib/motion'
import { useDialog } from '@/hooks/use-dialog'
import {
  useTeam, toMember, shiftDurationMs, activeMs, currentSessionMs, fmtDur,
  fetchTeamMembers, inviteTeamMember, removeTeamMember, patchTeamMember,
  type RoleId, type ShiftStatus, type TeamMemberDTO, type MemberPatch,
} from '@/services/team'
import type { RosterApi } from '@/hooks/useTeamRoster'
import { inviteUrl, type RosterMember, type RosterStatus } from '@/services/team-members'
import { useAuth } from '@/contexts/AuthContext'
import { useShiftOverlay } from '@/state/shift-overlay'
import { Spinner } from '@/components/ui/spinner'
import {
  RANGE_OPTIONS, rangeFor, previousRange, periodStats, sumStats, deltaPct, tzName,
  type RangeKey, type DateRange,
} from '@/services/team-range'
import {
  SCOPE_LABELS, can, canManageMember, canRemoveMember, type Member,
} from '@/lib/authorization'
import { useActingEmployee } from '@/lib/authorization/use-access'
import { useSession } from '@/state/session-store'
import { useToastStore } from '@/state/toast-store'
import { logAudit } from '@/services/audit'
import { EmployeeAccessTab } from './access/EmployeeAccessTab'
import { PermissionMatrix } from './access/PermissionMatrix'

const SHIFT_META: Record<ShiftStatus, { label: string; color: string }> = {
  'on-shift':  { label: 'On Shift',  color: 'var(--status-online)' },
  'on-break':  { label: 'On Break',  color: 'var(--status-warming)' },
  'offline':   { label: 'Offline',   color: 'var(--status-offline)' },
  'completed': { label: 'Completed', color: 'var(--status-busy)' },
}

const t = (ms: number | null) =>
  ms ? new Date(ms).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }) : '—'

// Membership status badge — invited (amber), active (emerald), suspended (red).
const STATUS_META: Record<RosterStatus, { label: string; color: string }> = {
  invited:   { label: 'Invited',   color: 'var(--status-warming)' },
  active:    { label: 'Active',    color: 'var(--status-online)' },
  suspended: { label: 'Suspended', color: 'var(--status-error)' },
}

function StatusBadge({ status }: { status: RosterStatus }) {
  const m = STATUS_META[status]
  return (
    <span
      className="mono inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[8px] uppercase tracking-wider"
      style={{ color: m.color, borderColor: m.color }}
    >
      <span className="h-1 w-1 rounded-full" style={{ background: m.color }} />
      {m.label}
    </span>
  )
}

function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-black"
      style={{
        width: size, height: size, fontSize: size * 0.36,
        background: 'linear-gradient(135deg, var(--accent), #0e7490)',
      }}
    >
      {name.split(/[\s.]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()}
    </div>
  )
}

// ─── Date-range control ──────────────────────────────────────────────────────

function RangeControl({ rangeKey, setRangeKey, custom, setCustom }: {
  rangeKey: RangeKey
  setRangeKey: (k: RangeKey) => void
  custom: { start: string; end: string }
  setCustom: (c: { start: string; end: string }) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [draft, setDraft] = useState(custom)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const valid = draft.start !== '' && draft.end !== '' && draft.start <= draft.end

  return (
    <div ref={ref} className="relative flex items-center gap-1 rounded-lg border border-line bg-black/40 p-1">
      {RANGE_OPTIONS.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          onClick={() => {
            if (key === 'custom') {
              setDraft(custom)
              setPickerOpen(o => !o)
              return
            }
            setPickerOpen(false)
            setRangeKey(key)
          }}
          className={[
            'mono flex items-center gap-1 px-2.5 py-1.5 text-[9px] uppercase tracking-widest transition-colors',
            rangeKey === key ? 'bg-white text-black' : 'text-white/40 hover:text-white/70',
          ].join(' ')}
        >
          {key === 'custom' && <Calendar size={10} />}
          {key === 'custom' && rangeKey === 'custom' ? `${custom.start} → ${custom.end}` : label}
          {key === 'custom' && <ChevronDown size={9} className="opacity-50" />}
        </button>
      ))}
      <AnimatePresence>
        {pickerOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.14 }}
            className="absolute right-0 top-11 z-40 w-[250px] border border-line bg-elevated p-3 shadow-2xl"
          >
            <div className="label mb-2 text-fg-muted">Custom Range</div>
            <div className="space-y-2">
              <div>
                <div className="mb-1 text-[9px] uppercase tracking-wider text-white/25">Start</div>
                <input
                  type="date" value={draft.start} max={draft.end || undefined}
                  onChange={e => setDraft(d => ({ ...d, start: e.target.value }))}
                  className="mono h-8 w-full rounded-control border border-line bg-black/40 px-2 text-[11px] text-fg outline-none focus:border-[var(--accent-border)]"
                />
              </div>
              <div>
                <div className="mb-1 text-[9px] uppercase tracking-wider text-white/25">End</div>
                <input
                  type="date" value={draft.end} min={draft.start || undefined}
                  onChange={e => setDraft(d => ({ ...d, end: e.target.value }))}
                  className="mono h-8 w-full rounded-control border border-line bg-black/40 px-2 text-[11px] text-fg outline-none focus:border-[var(--accent-border)]"
                />
              </div>
            </div>
            {!valid && draft.start && draft.end && (
              <p className="mt-1.5 text-[10px] text-status-error">Start must not be after end.</p>
            )}
            <p className="mt-2 text-[9px] text-white/25">Timezone: {tzName}</p>
            <div className="mt-3 flex gap-1.5">
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="btn-ghost mono flex-1 py-1.5 text-[10px] uppercase tracking-widest"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!valid}
                onClick={() => { setCustom(draft); setRangeKey('custom'); setPickerOpen(false) }}
                className="btn-accent mono flex-1 py-1.5 text-[10px] uppercase tracking-widest"
              >
                Apply
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── KPI sections ────────────────────────────────────────────────────────────

function LiveKpis({ employees }: { employees: RosterMember[] }) {
  const onShift = employees.filter(e => e.shiftStatus === 'on-shift' || e.shiftStatus === 'on-break').length
  const active = employees.filter(e => e.shiftStatus === 'on-shift').length
  const controlling = employees.filter(e => e.currentPhone).length
  const items = [
    { label: 'Currently On Shift', value: String(onShift), color: 'var(--status-online)' },
    { label: 'Currently Active',   value: String(active) },
    { label: 'Phones In Use Now',  value: String(controlling), color: 'var(--status-busy)' },
  ]
  return (
    <>
      {items.map(({ label, value, color }, i) => (
        <motion.div
          key={label}
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: i * 0.04, ease: EXPO_OUT }}
          className="card-surface flex flex-col gap-1.5 p-3.5"
        >
          <span className="flex items-center justify-between">
            <span className="mono text-[9px] uppercase tracking-[0.15em] text-white/35">{label}</span>
            <span className="mono flex items-center gap-1 rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-1.5 text-[7px] uppercase tracking-wider text-[var(--accent-text)]">
              <span className="status-dot-pulse h-1 w-1 rounded-full bg-[var(--accent)]" /> Live
            </span>
          </span>
          <span className="mono text-xl font-bold tabular-nums" style={{ color: color ?? '#fff' }}>{value}</span>
        </motion.div>
      ))}
    </>
  )
}

function PeriodKpis({ employees, range, now }: { employees: RosterMember[]; range: DateRange; now: number }) {
  const totals = useMemo(() => sumStats(employees.map(e => periodStats(e, range, now))), [employees, range, now])
  const prevTotals = useMemo(() => {
    const prev = previousRange(range)
    return sumStats(employees.map(e => periodStats(e, prev, now)))
  }, [employees, range, now])
  const hoursDelta = deltaPct(totals.hoursMs, prevTotals.hoursMs)

  const items = [
    {
      label: 'Hours Worked', value: fmtDur(totals.hoursMs),
      delta: hoursDelta,
    },
    { label: 'Active Time', value: fmtDur(totals.activeMs) },
    { label: 'Avg Shift Length', value: totals.shifts ? fmtDur(totals.hoursMs / totals.shifts) : '—' },
    { label: 'Shifts Completed', value: String(totals.shifts) },
    { label: 'Phones Controlled', value: String(totals.phonesUsed) },
    { label: 'Jobs Completed', value: String(totals.jobs) },
  ]
  return (
    <>
      {items.map(({ label, value, delta }, i) => (
        <motion.div
          key={label}
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: 0.1 + i * 0.04, ease: EXPO_OUT }}
          className="card-surface flex flex-col gap-1 p-3.5"
        >
          <span className="mono text-[9px] uppercase tracking-[0.15em] text-white/35">{label}</span>
          <span className="mono text-xl font-bold tabular-nums text-white">{value}</span>
          <span className="flex items-center gap-2 text-[9px] text-white/25">
            {range.label}
            {delta !== null && delta !== undefined && (
              <span style={{ color: delta >= 0 ? 'var(--status-online)' : 'var(--status-error)' }}>
                {delta >= 0 ? '+' : ''}{delta.toFixed(1)}% vs previous
              </span>
            )}
          </span>
        </motion.div>
      ))}
    </>
  )
}

// ─── Employee detail drawer (inherits the selected range) ────────────────────

function EmployeeDrawer({ emp, roster, range, now, actor, actorName, allMembers, onClose }: {
  emp: RosterMember
  roster: Roster
  range: DateRange
  now: number
  actor: Member
  actorName: string
  allMembers: Member[]
  onClose: () => void
}) {
  const { startShift, endShift, toggleBreak, setSuspended, removeEmployee } = roster
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [tab, setTab] = useState<'overview' | 'access' | 'sessions' | 'history'>('overview')
  const target = toMember(emp)
  const manageable = canManageMember(actor, emp.id === actor.id ? actor : target)
  const removeCheck = canRemoveMember(actor, target, allMembers)
  const meta = SHIFT_META[emp.shiftStatus]
  const onDuty = emp.shiftStatus === 'on-shift' || emp.shiftStatus === 'on-break'
  const stats = useMemo(() => periodStats(emp, range, now), [emp, range, now])

  const inRange = (ts: number) => ts >= range.start && ts <= range.end
  const rangeSessions = useMemo(
    () => emp.history
      .flatMap(h => h.sessions.map((s, i) => ({ ...s, date: h.date, key: h.date + i })))
      .filter(s => inRange(s.start)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [emp.history, range],
  )
  const rangeShifts = useMemo(
    () => emp.history.filter(h => Math.max(h.start, range.start) <= Math.min(h.end ?? now, range.end)),
     
    [emp.history, range, now],
  )

  const timeline = useMemo(() => {
    const items: { time: string; text: string }[] = []
    if (emp.shiftStart && inRange(emp.shiftStart)) items.push({ time: t(emp.shiftStart), text: 'Shift started' })
    rangeSessions.slice(0, 8).forEach(s => {
      items.push({ time: t(s.start), text: `Opened ${s.phoneName}` })
    })
    if (emp.currentSessionStart && emp.currentPhone)
      items.push({ time: t(emp.currentSessionStart), text: `Controlling ${emp.currentPhone}` })
    if (emp.breakStart) items.push({ time: t(emp.breakStart), text: 'Break started' })
    return items.sort((a, b) => a.time.localeCompare(b.time))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emp, rangeSessions])

  const dialogRef = useDialog<HTMLDivElement>(onClose)

  return (
    <div className="fixed inset-0 z-50">
      <motion.div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
      />
      <motion.div
        ref={dialogRef} tabIndex={-1}
        role="dialog" aria-modal="true" aria-label={`Employee ${emp.name}`}
        className="absolute right-0 top-0 flex h-full w-[440px] max-w-[94vw] flex-col border-l border-line bg-panel focus:outline-none"
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ duration: 0.3, ease: EXPO_OUT }}
      >
        {/* header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={emp.name} size={34} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-fg">{emp.name}{emp.suspended && <span className="ml-2 text-[10px] uppercase text-status-error">Suspended</span>}</div>
              <div className="mono text-[10px] text-fg-muted">{emp.email}</div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-elevated hover:text-fg">
            <X size={15} />
          </button>
        </div>

        {/* live status strip */}
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <span className="flex items-center gap-2">
            <span className="status-dot-pulse h-2 w-2 rounded-full" style={{ background: meta.color }} />
            <span className="mono text-[11px] uppercase tracking-wider" style={{ color: meta.color }}>{meta.label}</span>
          </span>
          <div className="flex gap-1.5">
            {!onDuty ? (
              <button onClick={() => startShift(emp.id)} className="btn-accent mono flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] uppercase tracking-wider">
                <LogIn size={11} /> Start Shift
              </button>
            ) : (
              <>
                <button onClick={() => toggleBreak(emp.id)} className="btn-ghost mono flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] uppercase tracking-wider">
                  <Coffee size={11} /> {emp.shiftStatus === 'on-break' ? 'End Break' : 'Break'}
                </button>
                <button onClick={() => endShift(emp.id)} className="btn-ghost mono flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] uppercase tracking-wider">
                  <LogOut size={11} /> End Shift
                </button>
              </>
            )}
          </div>
        </div>

        {/* tabs */}
        <div className="flex border-b border-line">
          {([['overview', 'Overview'], ['access', 'Access'], ['sessions', 'Phone Usage'], ['history', 'Shift History']] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={[
                'relative flex-1 py-2.5 mono text-[10px] uppercase tracking-wider transition-colors',
                tab === id ? 'text-[var(--accent-text)]' : 'text-white/35 hover:text-white/60',
              ].join(' ')}
            >
              {label}
              {tab === id && <motion.span layoutId="emp-tab" className="absolute -bottom-px left-0 right-0 h-0.5" style={{ background: 'var(--accent)' }} />}
            </button>
          ))}
        </div>

        {/* range banner — the drawer inherits the page's selected period */}
        <div className="flex items-center gap-2 border-b border-line bg-black/30 px-5 py-2">
          <Calendar size={10} className="text-white/25" />
          <span className="mono text-[9px] uppercase tracking-wider text-white/35">{range.label}</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {tab === 'overview' && (
            <>
              {/* role + scope (read-only here — edit in the Access tab) */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {[
                  ['Role', emp.role.toUpperCase()],
                  ['Scope', SCOPE_LABELS[emp.scopeType]],
                  ['Groups', emp.groups.length ? emp.groups.join(', ') : '—'],
                  ['Phones', emp.phones.length ? `${emp.phones.length}` : '—'],
                ].map(([k, v]) => (
                  <div key={k}>
                    <div className="text-[9px] uppercase tracking-wider text-white/25">{k}</div>
                    <div className="mono text-[12px] text-white/75">{v}</div>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setTab('access')}
                className="btn-ghost mono flex w-full items-center justify-center gap-1.5 py-1.5 text-[10px] uppercase tracking-wider"
              >
                <ShieldCheck size={11} /> {manageable ? 'Edit Access' : 'View Access'}
              </button>

              {/* period summary */}
              <div>
                <div className="label mb-2 text-fg-muted">Period · {range.label}</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  {[
                    ['Hours Worked', fmtDur(stats.hoursMs)],
                    ['Active Time',  fmtDur(stats.activeMs)],
                    ['Break Time',   fmtDur(stats.breakMs)],
                    ['Shifts',       String(stats.shifts)],
                    ['Phones Used',  String(stats.phonesUsed)],
                    ['Jobs',         String(stats.jobs)],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <div className="text-[9px] uppercase tracking-wider text-white/25">{k}</div>
                      <div className="mono text-[12px] text-white/75">{v}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* live shift */}
              <div>
                <div className="label mb-2 flex items-center gap-2 text-fg-muted">
                  Current Shift
                  <span className="mono rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-1.5 text-[7px] uppercase tracking-wider text-[var(--accent-text)]">Live</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  {[
                    ['Shift Start', t(emp.shiftStart)],
                    ['Duration',    fmtDur(shiftDurationMs(emp))],
                    ['Active',      fmtDur(activeMs(emp))],
                    ['Break',       `${emp.breakMinutesToday}m`],
                    ['Current Phone', emp.currentPhone ?? '—'],
                    ['Session',     emp.currentSessionStart ? fmtDur(currentSessionMs(emp)) : '—'],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <div className="text-[9px] uppercase tracking-wider text-white/25">{k}</div>
                      <div className="mono text-[12px] text-white/75">{v}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* timeline */}
              <div>
                <div className="label mb-2 text-fg-muted">Timeline</div>
                {timeline.length === 0 ? (
                  <div className="mono text-[11px] text-white/25">No activity in this period.</div>
                ) : (
                  <div className="space-y-1.5 border-l border-line pl-3">
                    {timeline.map((item, i) => (
                      <div key={i} className="flex items-baseline gap-2.5">
                        <span className="mono text-[10px] tabular-nums text-white/30">{item.time}</span>
                        <span className="text-[11px] text-white/65">{item.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* danger zone — permission + invariant gated */}
              {manageable && (
                <div className="flex gap-2 border-t border-line pt-4">
                  <button
                    onClick={() => {
                      setSuspended(emp, !emp.suspended)
                      logAudit({ actor: actorName, action: emp.suspended ? 'employee.reinstated' : 'employee.suspended', target: emp.name, result: 'success' })
                    }}
                    disabled={roster.mutating}
                    className="btn-ghost mono flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] uppercase tracking-wider disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {emp.suspended ? <CheckCircle2 size={11} /> : <Ban size={11} />}
                    {emp.suspended ? 'Reinstate' : 'Suspend Access'}
                  </button>
                  {!confirmRemove ? (
                    <button
                      onClick={() => setConfirmRemove(true)}
                      disabled={!removeCheck.ok || roster.mutating}
                      title={removeCheck.reason}
                      className="mono flex items-center gap-1.5 border border-status-error/25 px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-status-error transition-colors hover:bg-status-error/10 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <Trash2 size={11} /> Remove
                    </button>
                  ) : (
                    <button
                      onClick={() => { removeEmployee(emp); logAudit({ actor: actorName, action: 'employee.removed', target: emp.name, result: 'success' }); onClose() }}
                      disabled={roster.mutating}
                      className="mono flex items-center gap-1.5 border border-status-error/50 bg-status-error/15 px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-status-error disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash2 size={11} /> Confirm Remove
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {tab === 'access' && (
            <EmployeeAccessTab employee={emp} roster={roster} allMembers={allMembers} actor={actor} actorName={actorName} />
          )}

          {tab === 'sessions' && (
            <div className="space-y-3">
              {emp.currentPhone && emp.currentSessionStart && range.end >= now - 1000 && (
                <div className="card-surface border-[var(--accent-border)] p-3">
                  <div className="flex items-center justify-between">
                    <span className="mono text-[11px] text-white/80">{emp.currentPhone}</span>
                    <span className="mono text-[10px] text-[var(--accent-text)]">LIVE · {fmtDur(currentSessionMs(emp))}</span>
                  </div>
                </div>
              )}
              {rangeSessions.map(s => (
                <div key={s.key} className="card-surface p-3">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="mono text-[11px] text-white/75">{s.phoneName}</span>
                    <span className="mono text-[10px] text-white/30">{s.date}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[10px]">
                    <div><span className="text-white/25">Time </span><span className="mono text-white/60">{s.end ? fmtDur(s.end - s.start) : 'live'}</span></div>
                    <div><span className="text-white/25">Jobs </span><span className="mono text-white/60">{s.jobsPerformed}</span></div>
                    <div><span className="text-white/25">Actions </span><span className="mono text-white/60">{s.actions}</span></div>
                  </div>
                </div>
              ))}
              {rangeSessions.length === 0 && !emp.currentPhone && (
                <div className="mono text-[11px] text-white/25">No phone sessions in this period.</div>
              )}
            </div>
          )}

          {tab === 'history' && (
            <div className="space-y-2">
              {rangeShifts.map((h) => (
                <div key={h.date + h.start} className="card-surface p-3">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="mono text-[11px] text-white/75">{h.date}</span>
                    <span className="mono text-[10px] text-white/40">{t(h.start)} – {t(h.end)}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[10px]">
                    <div><span className="text-white/25">Total </span><span className="mono text-white/60">{h.end ? fmtDur(h.end - h.start) : '—'}</span></div>
                    <div><span className="text-white/25">Break </span><span className="mono text-white/60">{h.breakMinutes}m</span></div>
                    <div><span className="text-white/25">Phones </span><span className="mono text-white/60">{h.sessions.length}</span></div>
                  </div>
                </div>
              ))}
              {rangeShifts.length === 0 && <div className="mono text-[11px] text-white/25">No shifts in this period.</div>}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  )
}

// ─── Add employee modal ──────────────────────────────────────────────────────

function AddEmployeeModal({ roster, onClose }: { roster: RosterApi; onClose: () => void }) {
  const roles = useTeam(s => s.roles)
  const addToast = useToastStore(s => s.addToast)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<RoleId>('operator')
  const [busy, setBusy] = useState(false)
  const [invite, setInvite] = useState<{ url: string; emailed: boolean } | null>(null)
  // Name is captured for the local demo profile; invited members set their own
  // name at signup, so in Supabase mode only email + role are required.
  const valid = /\S+@\S+\.\S+/.test(email) && (roster.enabled || name.trim().length > 1)
  const dialogRef = useDialog<HTMLDivElement>(onClose)

  const submit = async () => {
    setBusy(true)
    try {
      const res = await roster.addEmployee({ name: name.trim() || email.trim(), email: email.trim(), role })
      if (res.invited && res.url) {
        setInvite({ url: res.url, emailed: !!res.emailed })
        addToast(res.emailed ? 'Invitation email sent' : 'Invite created — share the link', res.emailed ? 'success' : 'info')
      } else {
        addToast('Employee added', 'success')
        onClose()
      }
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Could not create the invitation', 'error')
    } finally {
      setBusy(false)
    }
  }

  const copyLink = async () => {
    if (!invite) return
    try {
      await navigator.clipboard.writeText(invite.url)
      addToast('Copied to clipboard', 'success', 2500)
    } catch {
      addToast('Could not copy — select and copy the link manually', 'error')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        ref={dialogRef} tabIndex={-1}
        role="dialog" aria-modal="true" aria-label="Add employee"
        initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.2, ease: EXPO_OUT }}
        className="relative w-[420px] border border-line bg-panel p-5 focus:outline-none"
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="label text-fg">{roster.enabled ? 'Invite Employee' : 'Add Employee'}</span>
          <button onClick={onClose} aria-label="Close" className="text-fg-muted hover:text-fg"><X size={15} /></button>
        </div>

        {invite ? (
          // Invite created — surface the shareable link (always works, even if the
          // email send is not yet configured).
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-control border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-2">
              <CheckCircle2 size={15} className="text-[var(--accent-text)]" />
              <span className="text-[12px] text-white/80">
                Invitation created for <span className="text-white">{email}</span>
                {invite.emailed ? ' — email sent.' : '.'}
              </span>
            </div>
            <div>
              <div className="label text-fg-muted mb-1.5">Invite link</div>
              <div className="flex gap-2">
                <input
                  readOnly value={invite.url} onFocus={(e) => e.currentTarget.select()}
                  className="mono h-9 min-w-0 flex-1 rounded-control border border-line bg-elevated px-3 text-[11px] text-fg/80 outline-none"
                />
                <button onClick={copyLink} className="btn-accent mono flex h-9 shrink-0 items-center gap-1.5 px-3 text-[10px] uppercase tracking-wider">
                  <Copy size={12} /> Copy
                </button>
              </div>
              {!invite.emailed && (
                <p className="mt-2 text-[10px] leading-relaxed text-white/35">
                  Email delivery isn’t configured yet — share this link directly. It expires in 7 days.
                </p>
              )}
            </div>
            <button onClick={onClose} className="btn-ghost mono w-full py-2 text-[10px] uppercase tracking-widest">Done</button>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {!roster.enabled && (
                <div>
                  <div className="label text-fg-muted mb-1.5">Name</div>
                  <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name"
                    className="mono h-9 w-full rounded-control border border-line bg-elevated px-3 text-[12px] text-fg outline-none transition-colors focus:border-[var(--accent-border)]" />
                </div>
              )}
              <div>
                <div className="label text-fg-muted mb-1.5">Email</div>
                <input value={email} onChange={e => setEmail(e.target.value)} placeholder="name@company.com" type="email"
                  className="mono h-9 w-full rounded-control border border-line bg-elevated px-3 text-[12px] text-fg outline-none transition-colors focus:border-[var(--accent-border)]" />
              </div>
              <div>
                <div className="label text-fg-muted mb-1.5">Role</div>
                <select value={role} onChange={e => setRole(e.target.value as RoleId)}
                  className="mono h-9 w-full rounded-control border border-line bg-elevated px-2 text-[12px] text-fg-secondary outline-none focus:border-[var(--accent-border)]">
                  {roles.filter(r => r.id !== 'owner').map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
            </div>
            <button
              disabled={!valid || busy}
              onClick={submit}
              className="btn-accent mono mt-5 flex w-full items-center justify-center gap-1.5 py-2.5 text-[11px] uppercase tracking-widest disabled:opacity-40"
            >
              {roster.enabled ? <Mail size={12} /> : <Plus size={12} />}
              {busy ? 'Working…' : roster.enabled ? 'Send Invitation' : 'Create Employee'}
            </button>
          </>
        )}
      </motion.div>
    </div>
  )
}

// ─── Acting-as switcher ──────────────────────────────────────────────────────
// No login exists in the SPA, so the operator chooses who they're acting as.
// This is how the permission system is observable + testable; in production it
// is replaced by the authenticated session and hidden.

function ActingSwitcher() {
  const employees = useTeam((s) => s.employees)
  const { employee } = useActingEmployee()
  const setActingId = useSession((s) => s.setActingId)
  return (
    <label className="flex items-center gap-1.5 rounded-lg border border-line bg-black/40 px-2.5 py-1.5" title="Preview the dashboard as a different role (no login in this build)">
      <Eye size={11} className="text-white/35" />
      <span className="mono text-[8px] uppercase tracking-widest text-white/30">Acting as</span>
      <select
        value={employee.id}
        onChange={(e) => {
          const next = employees.find((x) => x.id === e.target.value)
          setActingId(e.target.value)
          logAudit({ actor: employee.name, action: 'acting.switched', target: next?.name, detail: next?.role, result: 'success' })
        }}
        className="mono cursor-pointer bg-transparent text-[10px] uppercase tracking-wider text-white/80 outline-none"
      >
        {employees.map((e) => <option key={e.id} value={e.id} className="bg-elevated">{e.name} · {e.role}</option>)}
      </select>
    </label>
  )
}

// ─── Railway-backed roster ───────────────────────────────────────────────────
// Wires the People list to the live Railway/Fastify API (GET/POST/DELETE/PATCH
// /v1/team/*), preserving the RosterApi shape the drawer + Access tab already
// consume. Shift actions stay Zustand-local (overlay). Falls back to the mock
// store when auth is unconfigured so the standalone demo build still works.
type Roster = RosterApi & { mutating: boolean }

const blankActivity = () => ({
  shiftStatus: 'offline' as const,
  shiftStart: null,
  breakStart: null,
  breakMinutesToday: 0,
  currentPhone: null,
  currentSessionStart: null,
  lastActivity: 0,
  history: [],
})

/** GET /v1/team/members row → the Employee/RosterMember shape. The endpoint
 *  returns identity + role only (no shift activity, no scope, no suspension), so
 *  activity is zeroed and suspension comes from the optimistic map. */
function memberToRoster(dto: TeamMemberDTO, isSuspended: boolean): RosterMember {
  return {
    id: dto.userId,
    userId: dto.userId,
    name: dto.name ?? dto.email,
    email: dto.email,
    role: dto.role,
    groups: [],
    phones: [],
    scopeType: 'workspace',
    overrides: dto.overrides ?? {},
    createdAt: dto.createdAt,
    suspended: isSuspended,
    status: isSuspended ? 'suspended' : 'active',
    ...blankActivity(),
  }
}

function useRailwayRoster(): Roster {
  const { enabled } = useAuth()
  const addToast = useToastStore((s) => s.addToast)

  // Mock store — unchanged behavior for the standalone (no-auth) demo build.
  const mockEmployees = useTeam((s) => s.employees)
  const mockAdd = useTeam((s) => s.addEmployee)
  const mockUpdate = useTeam((s) => s.updateEmployee)
  const mockSetOverride = useTeam((s) => s.setOverride)
  const mockSetSuspended = useTeam((s) => s.setSuspended)
  const mockRemove = useTeam((s) => s.removeEmployee)
  const mockStart = useTeam((s) => s.startShift)
  const mockEnd = useTeam((s) => s.endShift)
  const mockBreak = useTeam((s) => s.toggleBreak)

  // Ephemeral, in-session shift overlay (Zustand-local) for the live path.
  const overlay = useShiftOverlay((s) => s.overlay)
  const ovStart = useShiftOverlay((s) => s.startShift)
  const ovEnd = useShiftOverlay((s) => s.endShift)
  const ovBreak = useShiftOverlay((s) => s.toggleBreak)

  const [members, setMembers] = useState<TeamMemberDTO[]>([])
  // GET /v1/team/members omits suspension status, so reflect it optimistically.
  const [suspended, setSuspendedMap] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const [mutating, setMutating] = useState(false)

  const load = useCallback(async () => {
    if (!enabled) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      setMembers(await fetchTeamMembers())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load team members')
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    // Async data-load effect — the loading flag it sets is the intended pattern
    // (mirrors hooks/useTeam.ts).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const employees = useMemo<RosterMember[]>(() => {
    if (!enabled) {
      return mockEmployees.map((e) => ({ ...e, status: e.suspended ? 'suspended' : 'active', userId: e.id }))
    }
    return members.map((dto) => {
      const base = memberToRoster(dto, !!suspended[dto.userId])
      const ov = overlay[base.id]
      return ov ? { ...base, ...ov } : base
    })
  }, [enabled, mockEmployees, members, suspended, overlay])

  // Run a mutation, refetch on success, toast + (optional) revert on failure.
  const runMutation = (p: Promise<unknown>, errMsg: string, onError?: () => void) => {
    setMutating(true)
    p.then(() => load())
      .catch((e) => { onError?.(); addToast(`${errMsg}: ${e instanceof Error ? e.message : 'failed'}`, 'error') })
      .finally(() => setMutating(false))
  }

  return {
    enabled,
    loading: enabled ? loading : false,
    error: enabled ? error : null,
    employees,
    mutating,
    refresh: load,

    // Add = invite (the backend has no create-member endpoint). Returns the
    // shareable accept link (dev) so the modal can surface it.
    addEmployee: async (input) => {
      if (!enabled) { mockAdd({ name: input.name, email: input.email, role: input.role, groups: [] }); return { invited: false } }
      setMutating(true)
      try {
        const inv = await inviteTeamMember(input.email, input.role)
        await load()
        return { invited: true, url: inv.acceptUrl, emailed: true }
      } finally {
        setMutating(false)
      }
    },

    removeEmployee: (m) => {
      if (!enabled) { mockRemove(m.id); return }
      if (m.status === 'invited' || !m.userId) return
      runMutation(removeTeamMember(m.userId), 'Could not remove member')
    },

    setSuspended: (m, isSusp) => {
      if (!enabled) { mockSetSuspended(m.id, isSusp); return }
      if (!m.userId) return
      const uid = m.userId
      setSuspendedMap((prev) => ({ ...prev, [uid]: isSusp })) // optimistic — GET omits status
      runMutation(
        patchTeamMember(uid, { status: isSusp ? 'suspended' : 'active' }),
        'Could not update member',
        () => setSuspendedMap((prev) => ({ ...prev, [uid]: !isSusp })), // revert on failure
      )
    },

    // Role + scope persist via the same PATCH /v1/team/members/:userId endpoint.
    updateEmployee: (m, patch) => {
      if (!enabled) { mockUpdate(m.id, patch); return }
      if (!m.userId) return
      const body: MemberPatch = {}
      if (patch.role) body.role = patch.role
      if (patch.scopeType !== undefined) body.scopeType = patch.scopeType
      if (patch.groups !== undefined) body.scopeGroups = patch.groups
      if (patch.phones !== undefined) body.scopePhones = patch.phones
      if (Object.keys(body).length > 0) runMutation(patchTeamMember(m.userId, body), 'Could not update member')
    },

    setOverride: (m, key, effect) => {
      if (!enabled) { mockSetOverride(m.id, key, effect); return }
      if (!m.userId) return
      // Compute the full next override map (effect === null clears the key →
      // inherit) and PATCH it wholesale, matching the backend's contract.
      const next = { ...m.overrides }
      if (effect === null) delete next[key]
      else next[key] = effect
      runMutation(patchTeamMember(m.userId, { overrides: next }), 'Could not update permission')
    },

    // Shift actions stay Zustand-local (ephemeral overlay live / store in mock).
    // TODO: wire to /v1/agent/command
    startShift: (id) => (enabled ? ovStart(id) : mockStart(id)),
    endShift: (id) => (enabled ? ovEnd(id) : mockEnd(id)),
    toggleBreak: (id) => (enabled ? ovBreak(id) : mockBreak(id)),
  }
}

// ─── Main view ───────────────────────────────────────────────────────────────

export function TeamView() {
  const roster = useRailwayRoster()
  const employees = roster.employees
  const { member: actor, employee: actorEmployee } = useActingEmployee()
  // Anti-escalation / last-owner checks consider real members only (not pending invites).
  const allMembers = useMemo(() => employees.filter(e => e.status !== 'invited').map(toMember), [employees])
  const [tab, setTab] = useState<'people' | 'roles'>('people')
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const canInvite = can(actor, 'team.invite')
  const canSeeRoles = can(actor, 'roles.view')
  const addToast = useToastStore(s => s.addToast)

  const copyInvite = async (m: RosterMember) => {
    if (!m.inviteToken) return
    try {
      await navigator.clipboard.writeText(inviteUrl(m.inviteToken))
      addToast('Copied to clipboard', 'success', 2500)
    } catch {
      addToast('Could not copy the link', 'error')
    }
  }
  const revoke = (m: RosterMember) => {
    roster.removeEmployee(m)
    logAudit({ actor: actorEmployee.name, action: 'invite.revoked', target: m.email, result: 'success' })
    addToast('Invitation revoked', 'info')
  }

  // Shared date-range state — every historical widget reads this one range.
  const [rangeKey, setRangeKey] = useState<RangeKey>('today')
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const [custom, setCustom] = useState({ start: todayIso, end: todayIso })
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  const range = useMemo(() => rangeFor(rangeKey, now, custom), [rangeKey, now, custom])

  const rows = useMemo(
    () => employees
      .map(e => ({ e, stats: periodStats(e, range, now) }))
      .sort((a, b) => b.stats.hoursMs - a.stats.hoursMs),
    [employees, range, now],
  )

  const openEmp = employees.find(e => e.id === openId && e.status !== 'invited') ?? null

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <div>
          <p className="mono mb-1 text-[9px] uppercase tracking-[0.2em] text-white/30">Workspace</p>
          <h1 className="mono text-lg font-bold uppercase tracking-widest text-white">Team</h1>
        </div>
        <div className="flex items-center gap-2">
          {/* Acting-as is a dev tool for the standalone (no-auth) build only; with
              real auth the signed-in user's role governs access. */}
          {!roster.enabled && <ActingSwitcher />}
          {tab === 'people' && (
            <RangeControl rangeKey={rangeKey} setRangeKey={setRangeKey} custom={custom} setCustom={setCustom} />
          )}
          <div className="flex items-center gap-1 rounded-lg border border-line bg-black/40 p-1">
            {([['people', 'People', Users], ['roles', 'Roles & Permissions', ShieldCheck]] as const)
              .filter(([id]) => id === 'people' || canSeeRoles)
              .map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={[
                  'mono flex items-center gap-1.5 px-3 py-1.5 text-[9px] uppercase tracking-widest transition-colors',
                  tab === id ? 'bg-white text-black' : 'text-white/40 hover:text-white/70',
                ].join(' ')}
              >
                <Icon size={11} /> {label}
              </button>
            ))}
          </div>
          {canInvite && (
            <button onClick={() => setAdding(true)} className="btn-accent mono flex h-8 items-center gap-1.5 px-4 text-[10px] uppercase tracking-widest">
              <Plus size={12} /> Add Employee
            </button>
          )}
        </div>
      </div>

      {tab === 'people' ? (
        <>
          {roster.error && (
            <div role="alert" className="mx-6 mt-4 flex items-center justify-between gap-3 rounded-control border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
              <span>Couldn't load the team: {roster.error}</span>
              <button
                onClick={() => void roster.refresh()}
                className="mono shrink-0 rounded-control border border-red-500/40 px-2 py-1 text-[10px] uppercase tracking-widest transition-colors hover:bg-red-500/20"
              >
                Retry
              </button>
            </div>
          )}
          {roster.loading && employees.length === 0 ? (
            <div className="flex flex-1 items-center justify-center py-20"><Spinner size={24} /></div>
          ) : (
          <>
          {/* LIVE row + PERIOD row, clearly separated */}
          <div className="grid grid-cols-3 gap-3 border-b border-line px-6 pb-2 pt-4">
            <LiveKpis employees={employees} />
          </div>
          <div className="grid grid-cols-6 gap-3 border-b border-line px-6 pb-4 pt-2">
            <PeriodKpis employees={employees} range={range} now={now} />
          </div>

          {/* table */}
          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-black">
                <tr className="border-b border-line">
                  {[
                    { h: 'EMPLOYEE' }, { h: 'ROLE' }, { h: 'ACCESS' },
                    { h: 'SHIFT', live: true }, { h: 'CURRENT PHONE', live: true },
                    { h: 'HOURS' }, { h: 'ACTIVE' }, { h: 'BREAK' }, { h: 'SHIFTS' }, { h: 'PHONES' }, { h: 'JOBS' }, { h: '' },
                  ].map(({ h, live }) => (
                    <th scope="col" key={h || 'x'} className="mono whitespace-nowrap px-4 py-3 text-left text-[9px] font-medium uppercase tracking-[0.1em]"
                      style={{ color: live ? 'var(--accent-text)' : 'rgba(255,255,255,0.25)' }}>
                      {h}{live ? ' ·' : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ e, stats }, i) => {
                  const meta = SHIFT_META[e.shiftStatus]
                  const invited = e.status === 'invited'
                  return (
                    <motion.tr
                      key={e.id}
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      transition={{ duration: 0.25, delay: Math.min(i * 0.04, 0.4) }}
                      onClick={() => { if (!invited) setOpenId(e.id) }}
                      className={`border-b border-white/[0.04] transition-colors ${invited ? '' : 'cursor-pointer hover:bg-hover'}`}
                      style={{ opacity: e.suspended ? 0.45 : 1 }}
                    >
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2.5">
                          <Avatar name={e.name} size={26} />
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-[12px] text-white/80">{e.name}</span>
                              {e.status !== 'active' && <StatusBadge status={e.status} />}
                            </span>
                            <span className="mono text-[9px] text-white/25">{e.email}</span>
                          </span>
                        </span>
                      </td>
                      <td className="mono px-4 py-3 text-[10px] uppercase tracking-wider text-white/45">{e.role}</td>
                      <td className="px-4 py-3">
                        {invited ? (
                          <span className="mono text-[9px] uppercase tracking-wider text-white/30">Pending</span>
                        ) : e.suspended ? (
                          <span className="mono text-[9px] uppercase tracking-wider text-status-error">Suspended</span>
                        ) : (
                          <span className="mono text-[9px] uppercase tracking-wider text-white/40">{SCOPE_LABELS[e.scopeType]}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {invited ? (
                          <span className="mono flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-white/30">
                            <Clock size={11} /> Awaiting
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5">
                            <span className={`h-1.5 w-1.5 rounded-full ${e.shiftStatus === 'on-shift' ? 'status-dot-pulse' : ''}`} style={{ background: meta.color }} />
                            <span className="mono text-[10px] uppercase tracking-wider" style={{ color: meta.color }}>{meta.label}</span>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {e.currentPhone ? (
                          <span className="flex items-center gap-1.5 text-[11px] text-[var(--accent-text)]">
                            <Smartphone size={11} /> {e.currentPhone}
                          </span>
                        ) : (
                          <span className="mono text-[10px] text-white/20">—</span>
                        )}
                      </td>
                      <td className="mono px-4 py-3 text-[11px] tabular-nums text-white/65">{invited ? '—' : fmtDur(stats.hoursMs)}</td>
                      <td className="mono px-4 py-3 text-[11px] tabular-nums text-white/50">{invited ? '—' : fmtDur(stats.activeMs)}</td>
                      <td className="mono px-4 py-3 text-[11px] tabular-nums text-white/35">{invited || stats.breakMs <= 0 ? '—' : fmtDur(stats.breakMs)}</td>
                      <td className="mono px-4 py-3 text-[11px] tabular-nums text-white/45">{invited ? '—' : stats.shifts}</td>
                      <td className="mono px-4 py-3 text-[11px] tabular-nums text-white/45">{invited ? '—' : stats.phonesUsed}</td>
                      <td className="mono px-4 py-3 text-[11px] tabular-nums text-white/45">{invited ? '—' : stats.jobs}</td>
                      <td className="px-4 py-3 text-right">
                        {invited && canInvite ? (
                          <span className="flex items-center justify-end gap-1">
                            <button
                              onClick={(ev) => { ev.stopPropagation(); void copyInvite(e) }}
                              title="Copy invite link"
                              className="flex h-7 w-7 items-center justify-center rounded-control text-white/40 transition-colors hover:bg-hover hover:text-white/80"
                            >
                              <Copy size={12} />
                            </button>
                            <button
                              onClick={(ev) => { ev.stopPropagation(); revoke(e) }}
                              title="Revoke invitation"
                              className="flex h-7 w-7 items-center justify-center rounded-control text-status-error/70 transition-colors hover:bg-status-error/10 hover:text-status-error"
                            >
                              <X size={13} />
                            </button>
                          </span>
                        ) : invited ? (
                          <span className="mono text-[9px] text-white/20">—</span>
                        ) : (
                          <ChevronRight size={13} className="ml-auto text-white/20" />
                        )}
                      </td>
                    </motion.tr>
                  )
                })}
              </tbody>
            </table>
            <div className="flex items-center gap-2 px-6 py-4">
              <Calendar size={11} className="text-white/20" />
              <span className="text-[10px] text-white/25">
                Historical columns aggregate <span className="text-white/40">{range.label}</span> ({tzName}) — SHIFT and CURRENT PHONE are live.
                Tracked locally until backend session events are connected.
              </span>
            </div>
          </div>
          </>
          )}
        </>
      ) : (
        <PermissionMatrix actor={actor} actorName={actorEmployee.name} />
      )}

      <AnimatePresence>
        {openEmp && (
          <EmployeeDrawer
            key={openEmp.id}
            emp={openEmp}
            roster={roster}
            range={range}
            now={now}
            actor={actor}
            actorName={actorEmployee.name}
            allMembers={allMembers}
            onClose={() => setOpenId(null)}
          />
        )}
        {adding && <AddEmployeeModal key="add" roster={roster} onClose={() => setAdding(false)} />}
      </AnimatePresence>
    </div>
  )
}

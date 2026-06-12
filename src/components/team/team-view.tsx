import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Plus, X, Users, Clock, Smartphone, Coffee, LogOut, LogIn,
  ShieldCheck, Trash2, Ban, CheckCircle2, ChevronRight,
} from 'lucide-react'
import { EXPO_OUT } from '@/lib/motion'
import {
  useTeam, shiftDurationMs, activeMs, currentSessionMs, fmtDur, phonesUsedToday,
  PERMISSION_GROUPS, type Employee, type RoleId, type ShiftStatus, type PermissionId,
} from '@/services/team'

const SHIFT_META: Record<ShiftStatus, { label: string; color: string }> = {
  'on-shift':  { label: 'On Shift',  color: 'var(--status-online)' },
  'on-break':  { label: 'On Break',  color: 'var(--status-warming)' },
  'offline':   { label: 'Offline',   color: 'var(--status-offline)' },
  'completed': { label: 'Completed', color: 'var(--status-busy)' },
}

const t = (ms: number | null) =>
  ms ? new Date(ms).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }) : '—'

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

// ─── KPI strip ───────────────────────────────────────────────────────────────

function Kpis({ employees }: { employees: Employee[] }) {
  const onShift = employees.filter(e => e.shiftStatus === 'on-shift' || e.shiftStatus === 'on-break')
  const active = employees.filter(e => e.shiftStatus === 'on-shift')
  const hoursToday = employees.reduce((s, e) => s + activeMs(e), 0)
  const controlling = employees.filter(e => e.currentPhone).length

  const items = [
    { label: 'Employees',        value: String(employees.length) },
    { label: 'On Shift',         value: String(onShift.length), color: 'var(--status-online)' },
    { label: 'Currently Active', value: String(active.length) },
    { label: 'Hours Today',      value: fmtDur(hoursToday) },
    { label: 'Phones In Use',    value: String(controlling), color: 'var(--status-busy)' },
  ]
  return (
    <div className="grid grid-cols-5 gap-3 px-6 py-4 border-b border-line">
      {items.map(({ label, value, color }, i) => (
        <motion.div
          key={label}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: i * 0.05, ease: EXPO_OUT }}
          className="card-surface p-3.5 flex flex-col gap-1.5"
        >
          <span className="mono text-[9px] uppercase tracking-[0.15em] text-white/35">{label}</span>
          <span className="mono text-xl font-bold tabular-nums" style={{ color: color ?? '#fff' }}>{value}</span>
        </motion.div>
      ))}
    </div>
  )
}

// ─── Employee detail drawer ──────────────────────────────────────────────────

function EmployeeDrawer({ emp, onClose }: { emp: Employee; onClose: () => void }) {
  const { startShift, endShift, toggleBreak, setSuspended, removeEmployee, updateEmployee, roles } = useTeam()
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [tab, setTab] = useState<'overview' | 'sessions' | 'history'>('overview')
  const meta = SHIFT_META[emp.shiftStatus]
  const onDuty = emp.shiftStatus === 'on-shift' || emp.shiftStatus === 'on-break'

  const timeline = useMemo(() => {
    const items: { time: string; text: string }[] = []
    if (emp.shiftStart) items.push({ time: t(emp.shiftStart), text: 'Shift started' })
    const today = emp.history.find(h => h.date === new Date().toISOString().slice(0, 10))
    today?.sessions.forEach(s => {
      items.push({ time: t(s.start), text: `Opened ${s.phoneName}` })
      if (s.end) items.push({ time: t(s.end), text: `Closed ${s.phoneName}` })
    })
    if (emp.currentSessionStart && emp.currentPhone)
      items.push({ time: t(emp.currentSessionStart), text: `Controlling ${emp.currentPhone}` })
    if (emp.breakStart) items.push({ time: t(emp.breakStart), text: 'Break started' })
    return items.sort((a, b) => a.time.localeCompare(b.time))
  }, [emp])

  return (
    <div className="fixed inset-0 z-50">
      <motion.div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
      />
      <motion.div
        role="dialog" aria-modal="true" aria-label={`Employee ${emp.name}`}
        className="absolute right-0 top-0 flex h-full w-[440px] max-w-[94vw] flex-col border-l border-line bg-panel"
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ duration: 0.3, ease: EXPO_OUT }}
      >
        {/* header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar name={emp.name} size={34} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-fg">{emp.name}{emp.suspended && <span className="ml-2 text-[10px] text-status-error uppercase">Suspended</span>}</div>
              <div className="mono text-[10px] text-fg-muted">{emp.email}</div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-control text-fg-muted hover:bg-elevated hover:text-fg transition-colors">
            <X size={15} />
          </button>
        </div>

        {/* status strip */}
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full status-dot-pulse" style={{ background: meta.color }} />
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
          {([['overview', 'Overview'], ['sessions', 'Phone Usage'], ['history', 'Shift History']] as const).map(([id, label]) => (
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

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {tab === 'overview' && (
            <>
              {/* role + groups */}
              <div className="space-y-2.5">
                <div>
                  <div className="label text-fg-muted mb-1.5">Role</div>
                  <select
                    value={emp.role}
                    onChange={(e) => updateEmployee(emp.id, { role: e.target.value as RoleId })}
                    className="mono h-8 w-full rounded-control border border-line bg-elevated px-2 text-[12px] text-fg-secondary outline-none focus:border-[var(--accent-border)]"
                  >
                    {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
                <div>
                  <div className="label text-fg-muted mb-1">Groups</div>
                  <div className="mono text-[11px] text-fg-secondary">{emp.groups.length ? emp.groups.join(' · ') : '—'}</div>
                </div>
              </div>

              {/* current shift */}
              <div>
                <div className="label text-fg-muted mb-2">Current Shift</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  {[
                    ['Shift Start', t(emp.shiftStart)],
                    ['Duration',    fmtDur(shiftDurationMs(emp))],
                    ['Active Time', fmtDur(activeMs(emp))],
                    ['Break Time',  `${emp.breakMinutesToday}m`],
                    ['Current Phone', emp.currentPhone ?? '—'],
                    ['Phones Today',  String(phonesUsedToday(emp))],
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
                <div className="label text-fg-muted mb-2">Today</div>
                {timeline.length === 0 ? (
                  <div className="mono text-[11px] text-white/25">No activity recorded today.</div>
                ) : (
                  <div className="space-y-1.5 border-l border-line pl-3">
                    {timeline.map((item, i) => (
                      <div key={i} className="flex items-baseline gap-2.5">
                        <span className="mono text-[10px] text-white/30 tabular-nums">{item.time}</span>
                        <span className="text-[11px] text-white/65">{item.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* danger zone */}
              <div className="border-t border-line pt-4 flex gap-2">
                <button
                  onClick={() => setSuspended(emp.id, !emp.suspended)}
                  className="btn-ghost mono flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] uppercase tracking-wider"
                >
                  {emp.suspended ? <CheckCircle2 size={11} /> : <Ban size={11} />}
                  {emp.suspended ? 'Reinstate' : 'Suspend Access'}
                </button>
                {!confirmRemove ? (
                  <button
                    onClick={() => setConfirmRemove(true)}
                    disabled={emp.role === 'owner'}
                    title={emp.role === 'owner' ? 'The workspace owner cannot be removed' : undefined}
                    className="mono flex items-center gap-1.5 border border-status-error/25 px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-status-error transition-colors hover:bg-status-error/10 disabled:opacity-35 disabled:cursor-not-allowed"
                  >
                    <Trash2 size={11} /> Remove
                  </button>
                ) : (
                  <button
                    onClick={() => { removeEmployee(emp.id); onClose() }}
                    className="mono flex items-center gap-1.5 border border-status-error/50 bg-status-error/15 px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-status-error"
                  >
                    <Trash2 size={11} /> Confirm Remove
                  </button>
                )}
              </div>
            </>
          )}

          {tab === 'sessions' && (
            <div className="space-y-3">
              {emp.currentPhone && emp.currentSessionStart && (
                <div className="card-surface p-3 border-[var(--accent-border)]">
                  <div className="flex items-center justify-between">
                    <span className="mono text-[11px] text-white/80">{emp.currentPhone}</span>
                    <span className="mono text-[10px] text-[var(--accent-text)]">LIVE · {fmtDur(currentSessionMs(emp))}</span>
                  </div>
                </div>
              )}
              {emp.history.flatMap(h => h.sessions.map((s, i) => ({ ...s, date: h.date, key: h.date + i }))).map(s => (
                <div key={s.key} className="card-surface p-3">
                  <div className="flex items-center justify-between mb-1.5">
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
              {emp.history.length === 0 && !emp.currentPhone && (
                <div className="mono text-[11px] text-white/25">No phone sessions recorded.</div>
              )}
            </div>
          )}

          {tab === 'history' && (
            <div className="space-y-2">
              {emp.history.map((h) => (
                <div key={h.date + h.start} className="card-surface p-3">
                  <div className="flex items-center justify-between mb-1.5">
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
              {emp.history.length === 0 && <div className="mono text-[11px] text-white/25">No completed shifts yet.</div>}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  )
}

// ─── Add employee modal ──────────────────────────────────────────────────────

function AddEmployeeModal({ onClose }: { onClose: () => void }) {
  const addEmployee = useTeam(s => s.addEmployee)
  const roles = useTeam(s => s.roles)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<RoleId>('operator')
  const valid = name.trim().length > 1 && /\S+@\S+\.\S+/.test(email)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        role="dialog" aria-modal="true" aria-label="Add employee"
        initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.2, ease: EXPO_OUT }}
        className="relative w-[400px] border border-line bg-panel p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="label text-fg">Add Employee</span>
          <button onClick={onClose} aria-label="Close" className="text-fg-muted hover:text-fg"><X size={15} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <div className="label text-fg-muted mb-1.5">Name</div>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name"
              className="mono h-9 w-full rounded-control border border-line bg-elevated px-3 text-[12px] text-fg outline-none focus:border-[var(--accent-border)] transition-colors" />
          </div>
          <div>
            <div className="label text-fg-muted mb-1.5">Email</div>
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="name@company.com"
              className="mono h-9 w-full rounded-control border border-line bg-elevated px-3 text-[12px] text-fg outline-none focus:border-[var(--accent-border)] transition-colors" />
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
          disabled={!valid}
          onClick={() => { addEmployee({ name: name.trim(), email: email.trim(), role, groups: [] }); onClose() }}
          className="btn-accent mono mt-5 w-full py-2.5 text-[11px] uppercase tracking-widest disabled:opacity-40"
        >
          Create Employee
        </button>
      </motion.div>
    </div>
  )
}

// ─── Roles & permissions ─────────────────────────────────────────────────────

function RolesPanel() {
  const { roles, employees, setRolePermissions } = useTeam()
  const [activeRole, setActiveRole] = useState<RoleId>('manager')
  const role = roles.find(r => r.id === activeRole)!
  const usage = employees.filter(e => e.role === activeRole).length

  const togglePerm = (p: PermissionId) => {
    if (role.locked) return
    const next = role.permissions.includes(p)
      ? role.permissions.filter(x => x !== p)
      : [...role.permissions, p]
    setRolePermissions(role.id, next)
  }

  return (
    <div className="flex flex-1 min-h-0">
      {/* role list */}
      <div className="w-52 shrink-0 border-r border-line py-3">
        {roles.map(r => (
          <button
            key={r.id}
            onClick={() => setActiveRole(r.id)}
            className={[
              'flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors',
              activeRole === r.id ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]' : 'text-white/50 hover:bg-hover hover:text-white/80',
            ].join(' ')}
          >
            <span className="mono text-[11px] uppercase tracking-wider">{r.name}</span>
            <span className="mono text-[10px] text-white/25">{employees.filter(e => e.role === r.id).length}</span>
          </button>
        ))}
      </div>
      {/* permission matrix */}
      <div className="flex-1 overflow-y-auto p-5">
        <div className="mb-4 flex items-center gap-3">
          <ShieldCheck size={15} className="text-[var(--accent-text)]" />
          <span className="text-sm font-medium text-white/85">{role.name}</span>
          <span className="mono text-[10px] text-white/30">{usage} member{usage === 1 ? '' : 's'}</span>
          {role.locked && <span className="mono text-[9px] uppercase tracking-wider text-white/30 border border-line px-1.5 py-0.5">Locked — full access</span>}
        </div>
        <div className="grid grid-cols-2 gap-5">
          {PERMISSION_GROUPS.map(g => (
            <div key={g.group}>
              <div className="label text-fg-muted mb-2">{g.group}</div>
              <div className="space-y-1">
                {g.permissions.map(p => {
                  const on = role.permissions.includes(p.id)
                  return (
                    <button
                      key={p.id}
                      onClick={() => togglePerm(p.id)}
                      disabled={role.locked}
                      className={[
                        'flex w-full items-center justify-between border px-3 py-2 text-left transition-colors',
                        on ? 'border-[var(--accent-border)] bg-[var(--accent-soft)]' : 'border-line bg-transparent hover:bg-hover',
                        role.locked ? 'cursor-not-allowed opacity-60' : '',
                      ].join(' ')}
                    >
                      <span className="text-[11px] text-white/70">{p.label}</span>
                      <span className={['mono text-[9px] uppercase', on ? 'text-[var(--accent-text)]' : 'text-white/25'].join(' ')}>
                        {on ? 'Allowed' : 'Denied'}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Main view ───────────────────────────────────────────────────────────────

export function TeamView() {
  const employees = useTeam(s => s.employees)
  const [tab, setTab] = useState<'people' | 'roles'>('people')
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const openEmp = employees.find(e => e.id === openId) ?? null

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <div>
          <p className="mono text-[9px] uppercase tracking-[0.2em] text-white/30 mb-1">Workspace</p>
          <h1 className="mono text-lg font-bold tracking-widest text-white uppercase">Team</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-line bg-black/40 p-1">
            {([['people', 'People', Users], ['roles', 'Roles', ShieldCheck]] as const).map(([id, label, Icon]) => (
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
          <button onClick={() => setAdding(true)} className="btn-accent mono flex h-8 items-center gap-1.5 px-4 text-[10px] uppercase tracking-widest">
            <Plus size={12} /> Add Employee
          </button>
        </div>
      </div>

      {tab === 'people' ? (
        <>
          <Kpis employees={employees} />
          {/* table */}
          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-black">
                <tr className="border-b border-line">
                  {['EMPLOYEE', 'ROLE', 'SHIFT', 'SHIFT START', 'ACTIVE TIME', 'BREAK', 'PHONES', 'CURRENT PHONE', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left mono text-[9px] font-medium text-white/25 uppercase tracking-[0.1em] whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employees.map((e, i) => {
                  const meta = SHIFT_META[e.shiftStatus]
                  return (
                    <motion.tr
                      key={e.id}
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      transition={{ duration: 0.25, delay: Math.min(i * 0.04, 0.4) }}
                      onClick={() => setOpenId(e.id)}
                      className="cursor-pointer border-b border-white/[0.04] transition-colors hover:bg-hover"
                      style={{ opacity: e.suspended ? 0.45 : 1 }}
                    >
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-2.5">
                          <Avatar name={e.name} size={26} />
                          <span className="flex flex-col">
                            <span className="text-[12px] text-white/80">{e.name}{e.suspended && <span className="ml-1.5 text-[9px] uppercase text-status-error">suspended</span>}</span>
                            <span className="mono text-[9px] text-white/25">{e.email}</span>
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-3 mono text-[10px] uppercase tracking-wider text-white/45">{e.role}</td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5">
                          <span className={`h-1.5 w-1.5 rounded-full ${e.shiftStatus === 'on-shift' ? 'status-dot-pulse' : ''}`} style={{ background: meta.color }} />
                          <span className="mono text-[10px] uppercase tracking-wider" style={{ color: meta.color }}>{meta.label}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 mono text-[11px] text-white/40 tabular-nums">{t(e.shiftStart)}</td>
                      <td className="px-4 py-3 mono text-[11px] text-white/55 tabular-nums">{fmtDur(activeMs(e))}</td>
                      <td className="px-4 py-3 mono text-[11px] text-white/35 tabular-nums">{e.breakMinutesToday}m</td>
                      <td className="px-4 py-3 mono text-[11px] text-white/45 tabular-nums">{phonesUsedToday(e)}</td>
                      <td className="px-4 py-3">
                        {e.currentPhone ? (
                          <span className="flex items-center gap-1.5 text-[11px] text-[var(--accent-text)]">
                            <Smartphone size={11} /> {e.currentPhone}
                          </span>
                        ) : (
                          <span className="mono text-[10px] text-white/20">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <ChevronRight size={13} className="ml-auto text-white/20" />
                      </td>
                    </motion.tr>
                  )
                })}
              </tbody>
            </table>
            <div className="flex items-center gap-2 px-6 py-4">
              <Clock size={11} className="text-white/20" />
              <span className="text-[10px] text-white/25">
                Shift &amp; phone-time data is tracked locally until the backend session events are connected.
              </span>
            </div>
          </div>
        </>
      ) : (
        <RolesPanel />
      )}

      <AnimatePresence>
        {openEmp && <EmployeeDrawer key={openEmp.id} emp={openEmp} onClose={() => setOpenId(null)} />}
        {adding && <AddEmployeeModal key="add" onClose={() => setAdding(false)} />}
      </AnimatePresence>
    </div>
  )
}

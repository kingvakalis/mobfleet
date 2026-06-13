import { useMemo, useState } from 'react'
import { ChevronDown, ShieldCheck, Lock } from 'lucide-react'
import { useFleet } from '@/hooks/use-fleet'
import { useTeam, toMember, type Employee } from '@/services/team'
import { logAudit } from '@/services/audit'
import {
  PERMISSIONS_BY_CATEGORY, RISK_META, type PermissionKey,
  ROLE_TEMPLATES, SCOPE_LABELS, type ScopeType,
  resolvePermission, effectivePermissions, can,
  assignableRoles, canChangeRole, canManageMember, type Member,
} from '@/lib/authorization'

const SCOPE_TYPES: ScopeType[] = ['workspace', 'assigned_groups', 'assigned_phones', 'self']

/**
 * Per-employee access editor: role, resource scope, and permission overrides.
 * Enforces anti-escalation — the actor can only grant permissions they hold
 * and assign roles below their authority. Locked read-only when the actor may
 * not manage the target. Every change is written to the audit log.
 */
export function EmployeeAccessTab({ employee, actor, actorName }: {
  employee: Employee
  actor: Member
  actorName: string
}) {
  const snapshot = useFleet()
  const { employees, updateEmployee, setOverride } = useTeam()
  const target = toMember(employee)
  const manageable = canManageMember(actor, employee.id === actor.id ? actor : target)
  const [openCat, setOpenCat] = useState<string | null>('Phones')

  const fleetGroups = useMemo(() => [...new Set(snapshot.devices.map((d) => d.group))].sort(), [snapshot.devices])
  const fleetPhones = useMemo(() => snapshot.devices.map((d) => d.name).sort(), [snapshot.devices])
  const allMembers = useMemo(() => employees.map(toMember), [employees])

  const eff = useMemo(() => effectivePermissions(target), [target])
  const assignable = useMemo(() => assignableRoles(actor), [actor])
  const roleOptions = [...new Set([employee.role, ...assignable])]

  const changeRole = (next: typeof employee.role) => {
    const check = canChangeRole(actor, target, next, allMembers)
    if (!check.ok) { window.alert(check.reason); return }
    updateEmployee(employee.id, { role: next })
    logAudit({ actor: actorName, action: 'role.changed', target: employee.name, detail: `${employee.role} → ${next}`, result: 'success' })
  }

  const setScopeType = (t: ScopeType) => {
    updateEmployee(employee.id, { scopeType: t })
    logAudit({ actor: actorName, action: 'scope.changed', target: employee.name, detail: `scope → ${SCOPE_LABELS[t]}`, result: 'success' })
  }

  const toggleScopeItem = (kind: 'groups' | 'phones', value: string) => {
    const list = kind === 'groups' ? employee.groups : employee.phones
    const next = list.includes(value) ? list.filter((x) => x !== value) : [...list, value]
    updateEmployee(employee.id, { [kind]: next })
    logAudit({ actor: actorName, action: 'scope.changed', target: employee.name, detail: `${kind}: ${next.join(', ') || 'none'}`, result: 'success' })
  }

  const applyOverride = (key: PermissionKey, effect: 'inherit' | 'allow' | 'deny') => {
    // Anti-escalation: cannot grant (allow) a permission the actor lacks.
    if (effect === 'allow' && !can(actor, key)) {
      logAudit({ actor: actorName, action: 'permission.denied', target: employee.name, detail: `attempt to grant ${key} (not held by actor)`, result: 'denied' })
      window.alert('You cannot grant a permission you do not hold.')
      return
    }
    setOverride(employee.id, key, effect === 'inherit' ? null : effect)
    logAudit({
      actor: actorName,
      action: effect === 'allow' ? 'permission.granted' : effect === 'deny' ? 'permission.denied' : 'permission.inherited',
      target: employee.name,
      detail: key,
      result: 'success',
    })
  }

  if (!manageable) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <Lock size={16} className="text-white/30" />
        <span className="mono text-[11px] uppercase tracking-wider text-white/40">Read-only</span>
        <p className="mono max-w-[260px] text-[10px] leading-relaxed text-white/30">
          You can view this member’s access but cannot modify it (insufficient authority, or this is an Owner).
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Role */}
      <div>
        <div className="label mb-1.5 text-fg-muted">Role</div>
        <select
          value={employee.role}
          onChange={(e) => changeRole(e.target.value as typeof employee.role)}
          className="mono h-8 w-full rounded-control border border-line bg-elevated px-2 text-[12px] text-fg-secondary outline-none focus:border-[var(--accent-border)]"
        >
          {roleOptions.map((r) => <option key={r} value={r}>{ROLE_TEMPLATES[r].name}</option>)}
        </select>
        <p className="mt-1.5 text-[10px] leading-snug text-white/30">{ROLE_TEMPLATES[employee.role].description}</p>
      </div>

      {/* Resource scope */}
      <div>
        <div className="label mb-1.5 text-fg-muted">Resource Scope</div>
        <div className="flex flex-wrap gap-1.5">
          {SCOPE_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setScopeType(t)}
              className={[
                'mono border px-2 py-1 text-[9px] uppercase tracking-wider transition-colors',
                employee.scopeType === t ? 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]' : 'border-line text-white/45 hover:bg-hover',
              ].join(' ')}
            >
              {SCOPE_LABELS[t]}
            </button>
          ))}
        </div>
        {employee.scopeType === 'assigned_groups' && (
          <div className="mt-2 flex flex-wrap gap-1">
            {fleetGroups.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => toggleScopeItem('groups', g)}
                className={[
                  'mono rounded-full border px-2 py-0.5 text-[9px] transition-colors',
                  employee.groups.includes(g) ? 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]' : 'border-line text-white/40 hover:text-white/70',
                ].join(' ')}
              >
                {g}
              </button>
            ))}
          </div>
        )}
        {employee.scopeType === 'assigned_phones' && (
          <div className="mt-2 flex max-h-24 flex-wrap gap-1 overflow-y-auto">
            {fleetPhones.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => toggleScopeItem('phones', p)}
                className={[
                  'mono rounded-full border px-2 py-0.5 text-[9px] transition-colors',
                  employee.phones.includes(p) ? 'border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]' : 'border-line text-white/40 hover:text-white/70',
                ].join(' ')}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Permission overrides */}
      <div>
        <div className="label mb-1.5 text-fg-muted">Permission Overrides</div>
        <p className="mb-2 text-[10px] text-white/30">
          Inherit follows the role. Allow grants extra access (only permissions you hold). Deny always wins.
        </p>
        <div className="space-y-1">
          {PERMISSIONS_BY_CATEGORY.map(({ category, permissions }) => {
            const open = openCat === category
            return (
              <div key={category} className="border border-line">
                <button
                  type="button"
                  onClick={() => setOpenCat(open ? null : category)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-hover"
                >
                  <span className="mono text-[10px] uppercase tracking-wider text-white/60">{category}</span>
                  <ChevronDown size={12} className={`text-white/30 transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>
                {open && (
                  <div className="divide-y divide-white/[0.04] border-t border-line">
                    {permissions.map((p) => {
                      const res = resolvePermission(target, p.key)
                      const ovr = employee.overrides[p.key] ?? 'inherit'
                      const canGrant = can(actor, p.key)
                      return (
                        <div key={p.key} className="flex items-center justify-between gap-2 px-3 py-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] text-white/75">{p.label}</span>
                              <span className="rounded px-1 text-[7px] uppercase tracking-wider" style={{ color: RISK_META[p.risk].color, border: `1px solid ${RISK_META[p.risk].color}` }}>{p.risk}</span>
                            </div>
                            <div className="mono mt-0.5 text-[8.5px] uppercase tracking-wider" style={{ color: res.allowed ? 'var(--status-online)' : 'var(--status-offline)' }}>
                              {res.allowed ? 'Allowed' : 'Denied'} · {res.source === 'role' ? 'via role' : res.source === 'granted' ? 'granted' : res.source === 'denied' ? 'denied directly' : 'not in role'}
                            </div>
                          </div>
                          <div className="flex shrink-0 overflow-hidden rounded border border-line">
                            {(['inherit', 'allow', 'deny'] as const).map((opt) => {
                              const active = ovr === opt
                              const disabled = opt === 'allow' && !canGrant
                              return (
                                <button
                                  key={opt}
                                  type="button"
                                  disabled={disabled}
                                  title={disabled ? 'You cannot grant a permission you do not hold' : undefined}
                                  onClick={() => applyOverride(p.key, opt)}
                                  className="mono px-2 py-1 text-[8px] uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-30"
                                  style={
                                    active
                                      ? opt === 'deny'
                                        ? { background: 'var(--status-error)', color: '#000' }
                                        : opt === 'allow'
                                        ? { background: 'var(--accent)', color: '#000' }
                                        : { background: 'var(--bg-hover)', color: '#fff' }
                                      : { color: 'rgba(255,255,255,0.4)' }
                                  }
                                >
                                  {opt}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Summary */}
      <div className="border-t border-line pt-3">
        <div className="label mb-2 text-fg-muted">Effective Summary</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {[
            ['Permissions', `${eff.size} granted`],
            ['Scope', SCOPE_LABELS[employee.scopeType]],
            ['Groups', employee.scopeType === 'assigned_groups' ? `${employee.groups.length}` : '—'],
            ['Phones', employee.scopeType === 'assigned_phones' ? `${employee.phones.length}` : '—'],
            ['Reveal passwords', eff.has('accounts.reveal_password') ? 'Yes' : 'No'],
            ['Export accounts', eff.has('accounts.export') ? 'Yes' : 'No'],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between">
              <span className="text-[10px] text-white/30">{k}</span>
              <span className="mono text-[11px] text-white/70">{v}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-[9px] text-white/25">
          <ShieldCheck size={10} /> Changes are recorded in the security audit log.
        </div>
      </div>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { Search, Check, ChevronDown, Lock } from 'lucide-react'
import { useTeam } from '@/services/team'
import { logAudit } from '@/services/audit'
import {
  PERMISSIONS_BY_CATEGORY, RISK_META, type PermissionKey,
  ROLE_ORDER, ROLE_TEMPLATES, can, type Member,
} from '@/lib/authorization'

/**
 * Roles × permissions matrix. Read for everyone with roles.view; editable
 * (toggle a role's default permission) for non-locked roles when the actor
 * holds roles.manage_permissions and the permission itself (anti-escalation).
 */
export function PermissionMatrix({ actor, actorName }: { actor: Member; actorName: string }) {
  const roles = useTeam((s) => s.roles)
  const setRolePermissions = useTeam((s) => s.setRolePermissions)
  const [q, setQ] = useState('')
  const [openCat, setOpenCat] = useState<string | null>(null)
  const mayEdit = can(actor, 'roles.manage_permissions')

  const roleSets = useMemo(
    () => Object.fromEntries(roles.map((r) => [r.id, new Set(r.permissions)])) as Record<string, Set<PermissionKey>>,
    [roles],
  )

  const filtered = useMemo(() => {
    if (!q) return PERMISSIONS_BY_CATEGORY
    const needle = q.toLowerCase()
    return PERMISSIONS_BY_CATEGORY
      .map((g) => ({ ...g, permissions: g.permissions.filter((p) => p.label.toLowerCase().includes(needle) || p.key.includes(needle)) }))
      .filter((g) => g.permissions.length > 0)
  }, [q])

  const toggle = (roleId: typeof ROLE_ORDER[number], key: PermissionKey) => {
    const role = roles.find((r) => r.id === roleId)
    if (!role || role.locked) return
    if (!mayEdit) return
    const has = roleSets[roleId].has(key)
    if (!has && !can(actor, key)) {
      window.alert('You cannot grant a permission you do not hold.')
      return
    }
    const next = has ? role.permissions.filter((k) => k !== key) : [...role.permissions, key]
    setRolePermissions(roleId, next)
    logAudit({ actor: actorName, action: has ? 'permission.denied' : 'permission.granted', target: `${role.name} role`, detail: key, result: 'success' })
  }

  return (
    <div className="flex h-full flex-col">
      {/* toolbar */}
      <div className="flex items-center gap-3 border-b border-line px-5 py-3">
        <div className="relative">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search permissions…"
            className="mono h-8 w-64 rounded-lg border border-line bg-white/[0.03] pl-8 pr-3 text-[11px] text-white/80 placeholder-white/25 outline-none focus:border-[var(--accent-border)]"
          />
        </div>
        <span className="mono ml-auto flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-white/25">
          {mayEdit ? 'Toggle a cell to edit role defaults' : <><Lock size={10} /> Read-only</>}
        </span>
      </div>

      <div className="flex-1 overflow-auto">
        {/* header row */}
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-black px-5 py-2">
          <div className="flex-1 mono text-[9px] uppercase tracking-wider text-white/25">Permission</div>
          {ROLE_ORDER.map((rid) => (
            <div key={rid} className="w-16 text-center mono text-[9px] uppercase tracking-wider text-white/45" title={ROLE_TEMPLATES[rid].description}>
              {ROLE_TEMPLATES[rid].name}
            </div>
          ))}
        </div>

        {filtered.map(({ category, permissions }) => {
          const open = openCat === null || openCat === category || q !== ''
          return (
            <div key={category}>
              <button
                type="button"
                onClick={() => setOpenCat(open && openCat === category ? '∅' : category)}
                className="flex w-full items-center gap-2 border-b border-line bg-white/[0.015] px-5 py-1.5 text-left"
              >
                <ChevronDown size={11} className={`text-white/30 transition-transform ${open ? 'rotate-180' : ''}`} />
                <span className="mono text-[9px] uppercase tracking-widest text-white/45">{category}</span>
                <span className="mono text-[8px] text-white/20">{permissions.length}</span>
              </button>
              {open && permissions.map((p) => (
                <div key={p.key} className="flex items-center gap-2 border-b border-white/[0.03] px-5 py-1.5 transition-colors hover:bg-hover">
                  <div className="flex flex-1 items-center gap-1.5 min-w-0">
                    <span className="truncate text-[11px] text-white/70" title={p.description}>{p.label}</span>
                    <span className="shrink-0 rounded px-1 text-[7px] uppercase tracking-wider" style={{ color: RISK_META[p.risk].color, border: `1px solid ${RISK_META[p.risk].color}` }}>{p.risk}</span>
                  </div>
                  {ROLE_ORDER.map((rid) => {
                    const has = roleSets[rid].has(p.key)
                    const locked = ROLE_TEMPLATES[rid].locked
                    const editable = mayEdit && !locked
                    return (
                      <button
                        key={rid}
                        type="button"
                        disabled={!editable}
                        onClick={() => toggle(rid, p.key)}
                        className="flex w-16 items-center justify-center"
                        title={locked ? `${ROLE_TEMPLATES[rid].name} permissions are locked` : editable ? 'Toggle' : 'Read-only'}
                      >
                        <span
                          className="flex h-4 w-4 items-center justify-center rounded-[3px] border transition-colors"
                          style={{
                            borderColor: has ? 'var(--accent-border)' : 'var(--border)',
                            background: has ? 'var(--accent-soft)' : 'transparent',
                            cursor: editable ? 'pointer' : 'default',
                          }}
                        >
                          {has && <Check size={10} style={{ color: 'var(--accent-text)' }} />}
                        </span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

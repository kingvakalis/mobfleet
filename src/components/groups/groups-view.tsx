import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus, Smartphone, Zap, Users, Clock, ArrowUpRight, Play, Settings, X, Check, Search } from 'lucide-react'
import { useFleet } from '@/hooks/use-fleet'
import { client } from '@/lib/provider'
import { STATUS } from '@/lib/status'
import { EXPO_OUT, fadeRise, staggerContainer } from '@/lib/motion'
import { useUIStore } from '@/state/ui-store'
import { useActingEmployee, useScopedDevices, groupInScope } from '@/lib/authorization/use-access'
import { can } from '@/lib/authorization'
import { logAudit } from '@/services/audit'
import { AUTH_SOURCE } from '@/auth/auth-source'
import { isSupabaseConfigured } from '@/lib/supabase'
import { useTeamContext } from '@/contexts/TeamContext'
import { useDeviceGroups } from '@/hooks/useDeviceGroups'

/** Searchable multi-select phone picker used by New Group / Assign / Edit flows. */
function PhonePicker({
  title, confirmLabel, initialName, askName, preselected, onConfirm, onClose,
}: {
  title: string
  confirmLabel: string
  /** Show a group-name input (New Group / Rename). */
  askName?: boolean
  initialName?: string
  preselected?: Set<string>
  onConfirm: (name: string, deviceIds: string[]) => Promise<void> | void
  onClose: () => void
}) {
  const snapshot = useFleet()
  const [name, setName] = useState(initialName ?? '')
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Set<string>>(() => new Set(preselected ?? []))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const visible = snapshot.devices.filter(d => d.name.toLowerCase().includes(search.toLowerCase()))
  const valid = (!askName || name.trim().length > 0) && (askName ? true : picked.size > 0)

  const toggle = (id: string) =>
    setPicked(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const submit = async () => {
    if (!valid || saving) return
    setSaving(true)
    setError(null)
    try {
      await onConfirm(name.trim(), [...picked])
      onClose()
    } catch {
      setError('Failed to save — try again')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        role="dialog" aria-modal="true" aria-label={title}
        initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
        transition={{ duration: 0.2, ease: EXPO_OUT }}
        className="relative flex max-h-[80vh] w-[460px] flex-col border border-line bg-panel"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <span className="label text-fg">{title}</span>
          <button onClick={onClose} aria-label="Close" className="text-fg-muted hover:text-fg"><X size={15} /></button>
        </div>

        <div className="space-y-3 p-5 pb-3">
          {askName && (
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Group name"
              className="h-9 w-full rounded-control border border-line bg-elevated px-3 text-[12px] text-fg outline-none transition-colors focus:border-[var(--accent-border)]"
            />
          )}
          <div className="relative">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search phones..."
              className="h-9 w-full rounded-control border border-line bg-elevated pl-8 pr-3 text-[12px] text-fg outline-none transition-colors focus:border-[var(--accent-border)]"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          {visible.map(d => {
            const on = picked.has(d.id)
            return (
              <button
                key={d.id}
                onClick={() => toggle(d.id)}
                className={[
                  'mb-1 flex w-full items-center gap-2.5 border px-3 py-2 text-left transition-colors',
                  on ? 'border-[var(--accent-border)] bg-[var(--accent-soft)]' : 'border-line hover:bg-hover',
                ].join(' ')}
              >
                <span
                  className="flex h-3.5 w-3.5 shrink-0 items-center justify-center border border-white/20"
                  style={{ background: on ? 'var(--accent)' : 'transparent' }}
                >
                  {on && <Check size={9} className="text-black" />}
                </span>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS[d.status].color }} />
                <span className="mono flex-1 truncate text-[11px] text-white/70">{d.name}</span>
                <span className="text-[9px] uppercase text-white/25">{d.group}</span>
              </button>
            )
          })}
        </div>

        <div className="border-t border-line p-4">
          {error && <p className="mb-2 text-[11px] text-status-error">{error}</p>}
          <button
            onClick={submit}
            disabled={!valid || saving}
            className="btn-accent w-full py-2.5 text-[11px] uppercase tracking-widest"
          >
            {saving ? 'Saving…' : `${confirmLabel}${picked.size > 0 ? ` (${picked.size})` : ''}`}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

type Modal =
  | { kind: 'new' }
  | { kind: 'assign'; group: string }
  | { kind: 'edit'; group: string }
  | null

export function GroupsView() {
  // Scope-filtered devices → a member only sees groups containing in-scope phones.
  const devices = useScopedDevices()
  const { employee, member } = useActingEmployee()
  const focusGroup = useUIStore(s => s.focusGroup)
  const openSubmit = useUIStore(s => s.openSubmit)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<Modal>(null)

  // supabase-mode persists groups to Supabase (device_groups + devices.group_name via RLS);
  // demo/me-mode keeps the in-memory provider. Devices already carry the real group_name
  // (useFleet → mapDevice), so display + assigned_groups scope are real here.
  const { team } = useTeamContext()
  const supabaseMode = AUTH_SOURCE === 'supabase' && isSupabaseConfigured
  const dg = useDeviceGroups(supabaseMode ? (team?.id ?? null) : null)

  const persistGroup = async (name: string, ids: string[], oldName?: string) => {
    if (supabaseMode) {
      if (oldName && oldName !== name) { const r = await dg.renameGroup(oldName, name); if (r.error) throw new Error(r.error) }
      const r = await dg.assignDevices(ids, name); if (r.error) throw new Error(r.error)
      // group.created/updated + device.updated activity is recorded by DB triggers.
    } else {
      await client.assignGroup(ids, name)
      logAudit({ actor: employee.name, action: 'scope.changed', target: `group ${name}`, result: 'success' })
    }
  }

  const canCreate    = can(member, 'groups.create')
  const canEdit      = can(member, 'groups.edit')
  const canAssign    = can(member, 'groups.assign_phones')
  const canRunAuto   = can(member, 'groups.run_automation')

  const groups = useMemo(() => {
    const map = new Map<string, typeof devices>()
    for (const d of devices) {
      const arr = map.get(d.group) ?? []
      arr.push(d)
      map.set(d.group, arr)
    }
    // Include explicit Supabase groups that currently have no in-scope devices (freshly
    // created / emptied), scope-filtered by name so a restricted member sees only theirs.
    for (const g of dg.groups) if (groupInScope(member.scope, g.name) && !map.has(g.name)) map.set(g.name, [])
    return [...map.entries()]
      .map(([name, groupDevices]) => ({
        name,
        devices: groupDevices,
        online: groupDevices.filter(d => d.status === 'online').length,
        busy: groupDevices.filter(d => d.status === 'busy').length,
        offline: groupDevices.filter(d => d.status === 'offline' || d.status === 'error').length,
        regions: new Set(groupDevices.map(d => d.region)).size,
        users: [...new Set(groupDevices.map(d => d.assignedUser).filter(Boolean))] as string[],
      }))
      .sort((a, b) => b.devices.length - a.devices.length)
  }, [devices, dg.groups, member])

  const visible = groups.filter(g => search === '' || g.name.toLowerCase().includes(search.toLowerCase()))
  const totalBusy = devices.filter(d => d.status === 'busy').length
  const totalOnline = devices.filter(d => d.status !== 'offline' && d.status !== 'error').length

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <div>
          <p className="mb-1 text-[9px] uppercase tracking-[0.2em] text-white/30">Fleet</p>
          <h1 className="text-lg font-bold uppercase tracking-widest text-white">Groups</h1>
        </div>
        <button
          onClick={() => setModal({ kind: 'new' })}
          disabled={!canCreate}
          title={canCreate ? 'Create a new group' : 'Requires create-groups permission'}
          className="btn-accent flex h-8 items-center gap-1.5 px-4 text-[10px] uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={12} /> New Group
        </button>
      </div>

      {/* KPI row */}
      <div className="flex gap-4 border-b border-line px-6 py-3">
        {[
          { label: 'Total Groups', value: groups.length },
          { label: 'Total Phones', value: devices.length },
          { label: 'Online',       value: totalOnline },
          { label: 'Running Jobs', value: totalBusy },
        ].map(k => (
          <div key={k.label} className="card-surface flex flex-col px-4 py-2">
            <span className="text-[10px] uppercase tracking-wider text-white/30">{k.label}</span>
            <span className="mono mt-0.5 text-xl font-semibold tabular-nums text-white/90">{k.value}</span>
          </div>
        ))}
        <div className="ml-auto flex items-center">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search groups..."
            className="h-8 w-52 rounded-lg border border-line bg-white/[0.03] px-3 text-xs text-white/80 placeholder-white/25 outline-none transition-colors focus:border-[var(--accent-border)]"
          />
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto p-6">
        <motion.div variants={staggerContainer} initial="hidden" animate="show" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map(g => (
            <motion.div
              key={g.name}
              variants={fadeRise}
              whileHover={{ y: -2 }}
              className="card-surface flex flex-col gap-4 rounded-2xl p-5"
            >
              {/* Card header */}
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-white/90">{g.name}</h2>
                  <p className="mt-0.5 text-[11px] text-white/35">{g.devices.length} devices · {g.regions} region{g.regions === 1 ? '' : 's'}</p>
                </div>
                <span className={[
                  'rounded-full px-2 py-0.5 text-[10px] font-medium',
                  g.busy > 0 ? 'bg-emerald-400/10 text-emerald-400' : 'bg-white/[0.05] text-white/30',
                ].join(' ')}>
                  {g.busy > 0 ? 'Active' : 'Idle'}
                </span>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  { icon: <Smartphone size={13} className="mb-1 text-white/30" />, value: g.devices.length, label: 'Phones', color: 'text-white/80' },
                  { icon: <span className="mb-1 block h-2 w-2 rounded-full bg-emerald-400" />, value: g.online + g.busy, label: 'Online', color: 'text-emerald-400' },
                  { icon: <Zap size={13} className="mb-1 text-[var(--accent-text)]" />, value: g.busy, label: 'Jobs', color: 'text-white/80' },
                  { icon: <span className="mb-1 block h-2 w-2 rounded-full bg-white/20" />, value: g.offline, label: 'Offline', color: 'text-white/40' },
                ].map((s, i) => (
                  <div key={i} className="flex flex-col items-center rounded-lg bg-white/[0.03] py-2">
                    {s.icon}
                    <span className={`text-sm font-semibold tabular-nums ${s.color}`}>{s.value}</span>
                    <span className="text-[9px] text-white/25">{s.label}</span>
                  </div>
                ))}
              </div>

              {/* Assigned users + activity */}
              <div className="flex items-center gap-1.5">
                <Users size={11} className="text-white/25" />
                <span className="truncate text-[10px] text-white/35">
                  {g.users.length ? g.users.slice(0, 3).join(', ') + (g.users.length > 3 ? ` +${g.users.length - 3}` : '') : 'Unassigned'}
                </span>
                <Clock size={11} className="ml-auto text-white/25" />
                <span className="text-[10px] text-white/30">{g.busy > 0 ? 'active now' : 'idle'}</span>
              </div>

              {/* Actions — all functional */}
              <div className="grid grid-cols-2 gap-1.5 border-t border-line pt-3">
                <button
                  type="button"
                  onClick={() => focusGroup(g.name)}
                  className="btn-ghost flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[10px]"
                >
                  <ArrowUpRight size={11} /> View Group
                </button>
                <button
                  type="button"
                  onClick={() => setModal({ kind: 'assign', group: g.name })}
                  disabled={!canAssign}
                  title={canAssign ? undefined : 'Requires assign-phones permission'}
                  className="btn-ghost flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[10px] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Smartphone size={11} /> Assign Phones
                </button>
                <button
                  type="button"
                  onClick={() => { openSubmit(); logAudit({ actor: employee.name, action: 'automation.run', target: `group ${g.name}`, result: 'success' }) }}
                  disabled={!canRunAuto}
                  title={canRunAuto ? undefined : 'Requires run-automation permission'}
                  className="btn-accent flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[10px] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Play size={11} /> Run Automation
                </button>
                <button
                  type="button"
                  onClick={() => setModal({ kind: 'edit', group: g.name })}
                  disabled={!canEdit}
                  title={canEdit ? undefined : 'Requires edit-groups permission'}
                  className="btn-ghost flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[10px] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Settings size={11} /> Edit
                </button>
              </div>
            </motion.div>
          ))}
        </motion.div>
        {visible.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center text-sm text-white/40">
            No groups match "{search}"
          </div>
        )}
      </div>

      {/* Modals */}
      <AnimatePresence>
        {modal?.kind === 'new' && (
          <PhonePicker
            key="new"
            title="New Group"
            confirmLabel="Create Group"
            askName
            onConfirm={(name, ids) => persistGroup(name, ids)}
            onClose={() => setModal(null)}
          />
        )}
        {modal?.kind === 'assign' && (
          <PhonePicker
            key={'assign-' + modal.group}
            title={`Assign Phones — ${modal.group}`}
            confirmLabel="Assign"
            preselected={new Set(devices.filter(d => d.group === modal.group).map(d => d.id))}
            onConfirm={(_, ids) => persistGroup(modal.group, ids)}
            onClose={() => setModal(null)}
          />
        )}
        {modal?.kind === 'edit' && (
          <PhonePicker
            key={'edit-' + modal.group}
            title={`Edit Group — ${modal.group}`}
            confirmLabel="Save"
            askName
            initialName={modal.group}
            preselected={new Set(devices.filter(d => d.group === modal.group).map(d => d.id))}
            onConfirm={(name, ids) => persistGroup(name, ids, modal.group)}
            onClose={() => setModal(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

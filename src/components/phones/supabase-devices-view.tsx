import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Search, Plus, Check, X, ChevronDown, QrCode, Trash2, Download, FolderInput, Activity } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { STATUS, ALL_STATUSES } from '@/lib/status'
import { useDevices } from '@/hooks/useDevices'
import { useNow } from '@/hooks/use-now'
import { isHeartbeatStale } from '@/shared/heartbeat'
import { useTeamContext } from '@/contexts/TeamContext'
import { useUIStore } from '@/state/ui-store'
import type { DeviceStatusEnum } from '@/lib/database.types'

/* ──────────────────────────────────────────────────────────────────────────
 * Live "DEVICE REGISTRY" — the product-grade Phones page, backed by REAL
 * Supabase devices (see useDevices: RLS-scoped + realtime). Visual language
 * matches the intended design reference (phones-view.tsx): KPI HUD cards,
 * animated counters, search + filter toolbar, a selectable data table, and a
 * floating bulk-action bar. Every action here is a real Supabase mutation —
 * no mock data, no backend /v1/* calls.
 * ────────────────────────────────────────────────────────────────────────── */

/** Relative age of an ISO heartbeat timestamp, against a live clock. */
function hbAgo(iso: string | null, now: number): string {
  if (!iso) return 'never'
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

/** Count-up counter for the KPI cards. Re-animates whenever the target moves. */
function AnimatedCounter({ target, color }: { target: number; color: string }) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    let cur = 0
    let t: ReturnType<typeof setTimeout>
    const step = () => {
      cur = Math.min(cur + 1, target)
      setValue(cur)
      if (cur < target) t = setTimeout(step, 20)
    }
    t = setTimeout(step, 0)
    return () => clearTimeout(t)
  }, [target])
  return <span className="mono text-3xl font-bold tabular-nums" style={{ color }}>{value}</span>
}

/** Dropdown filter — closes on outside click; the null option clears it. */
function FilterSelect({
  label, options, value, onChange,
}: {
  label: string
  options: string[]
  value: string | null
  onChange: (v: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={[
          'mono h-8 px-3 text-[9px] uppercase tracking-widest border transition-colors flex items-center gap-1.5',
          value
            ? 'text-[var(--accent-text)] border-[var(--accent-border)] bg-[var(--accent-soft)]'
            : 'text-white/30 border-transparent hover:text-white/60 hover:border-white/20',
        ].join(' ')}
      >
        {label}{value ? `: ${value}` : ''} <ChevronDown size={10} className="text-white/30" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.14 }}
            className="absolute left-0 top-9 z-30 min-w-[150px] max-h-64 overflow-y-auto border border-line bg-elevated shadow-2xl py-1"
          >
            <button
              type="button"
              onClick={() => { onChange(null); setOpen(false) }}
              className="mono w-full px-3 py-1.5 text-left text-[10px] uppercase tracking-wider text-white/40 hover:bg-hover hover:text-white/80 transition-colors"
            >
              All
            </button>
            {options.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => { onChange(o); setOpen(false) }}
                className={[
                  'mono w-full px-3 py-1.5 text-left text-[10px] uppercase tracking-wider transition-colors',
                  value === o ? 'text-[var(--accent-text)] bg-[var(--accent-soft)]' : 'text-white/55 hover:bg-hover hover:text-white/90',
                ].join(' ')}
              >
                {o}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function SupabaseDevicesView() {
  const { team, role } = useTeamContext()
  const { devices, loading, error, addDevice, updateStatus, updateDevice, deleteDevice } = useDevices(team?.id ?? null)
  // Mirror the server (RLS) boundaries exactly so the UI never offers an action
  // that would 42501 at the database: can_write_team = owner/admin/operator
  // (insert/update); devices_delete = is_team_admin = owner/admin only.
  const canWrite = role === 'owner' || role === 'admin' || role === 'operator'
  const canDelete = role === 'owner' || role === 'admin'
  const now = useNow() // ticks so heartbeat freshness self-updates
  const openPair = useUIStore((s) => s.openPair) // opens the (supabase-aware) DevicePairingModal
  const openPhoneControl = useUIStore((s) => s.openPhoneControl) // routes to the existing Phone Control view

  // Toolbar / selection state
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [groupFilter, setGroupFilter] = useState<string | null>(null)
  const [platformFilter, setPlatformFilter] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Inline "add manually" form (real addDevice)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  // Bulk-action bar
  const [bulkMenu, setBulkMenu] = useState<'status' | 'group' | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [groupDraft, setGroupDraft] = useState('')
  const barRef = useRef<HTMLDivElement>(null)

  // Live selection: intersect the raw selection set with the current device list
  // on every read, so realtime deletes and team switches (which replace the list
  // wholesale) silently drop stale ids — no pruning effect, no cascading renders.
  const selectedIds = useMemo(() => devices.filter((d) => selected.has(d.id)).map((d) => d.id), [devices, selected])
  const selectedCount = selectedIds.length

  // Close the bulk menus on an outside click.
  useEffect(() => {
    if (!bulkMenu) return
    const onDoc = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setBulkMenu(null)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [bulkMenu])

  const groups = useMemo(() => [...new Set(devices.map((d) => d.group_name).filter(Boolean))].sort(), [devices])
  const platforms = useMemo(() => [...new Set(devices.map((d) => d.platform).filter(Boolean))].sort(), [devices])

  const visible = useMemo(
    () => devices.filter((d) => {
      const q = search.trim().toLowerCase()
      return (
        (!q || d.name.toLowerCase().includes(q) || (d.udid ?? '').toLowerCase().includes(q)) &&
        (!statusFilter || STATUS[d.status].label === statusFilter) &&
        (!groupFilter || d.group_name === groupFilter) &&
        (!platformFilter || d.platform === platformFilter)
      )
    }),
    [devices, search, statusFilter, groupFilter, platformFilter],
  )

  const kpis = useMemo(() => {
    const online = devices.filter((d) => d.status === 'online' || d.status === 'busy' || d.status === 'warming').length
    const fault = devices.filter((d) => d.status === 'error').length
    const offline = devices.filter((d) => d.status === 'offline').length
    return [
      { label: 'TOTAL UNITS', value: devices.length, color: '#ffffff', topBorder: 'rgba(255,255,255,0.3)' },
      { label: 'ONLINE', value: online, color: 'var(--accent-green)', topBorder: 'var(--accent-green)' },
      { label: 'FAULT', value: fault, color: 'var(--accent-red)', topBorder: 'var(--accent-red)' },
      { label: 'OFFLINE', value: offline, color: 'rgba(255,255,255,0.3)', topBorder: 'rgba(255,255,255,0.15)' },
    ]
  }, [devices])

  const filtersActive = Boolean(statusFilter || groupFilter || platformFilter)
  const clearFilters = () => { setStatusFilter(null); setGroupFilter(null); setPlatformFilter(null) }

  function toggleAll() {
    // Toggle only the currently-visible rows, preserving any selection that's
    // filtered out — and stay in sync with the header checkbox (allVisibleSelected).
    setSelected((prev) => {
      const allSel = visible.length > 0 && visible.every((d) => prev.has(d.id))
      const n = new Set(prev)
      if (allSel) visible.forEach((d) => n.delete(d.id))
      else visible.forEach((d) => n.add(d.id))
      return n
    })
  }
  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  const submitAdd = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !canWrite) return
    setBusy(true)
    const { error: err } = await addDevice({ name: name.trim() })
    setBusy(false)
    if (err) setActionError(err)
    else { setName(''); setAdding(false) }
  }

  // ── Bulk actions — every one is a real Supabase mutation ────────────────
  // Returns the first error (or undefined). Callers clear the selection ONLY on a
  // clean run, so a failed/partial action leaves the affected rows selected for
  // retry — for deletes, rows that DID succeed drop from `devices` and the live
  // selectedIds intersection narrows the remaining selection to just the failures.
  const runBulk = async (fn: (id: string) => Promise<{ error?: string }>) => {
    if (!canWrite || selectedIds.length === 0) return 'No devices selected'
    setBulkBusy(true)
    setActionError(null)
    const results = await Promise.all(selectedIds.map(fn))
    setBulkBusy(false)
    const firstErr = results.find((r) => r.error)?.error
    if (firstErr) setActionError(firstErr)
    return firstErr
  }

  const bulkSetStatus = async (status: DeviceStatusEnum) => {
    setBulkMenu(null)
    const err = await runBulk((id) => updateStatus(id, status))
    if (!err) setSelected(new Set())
  }

  const bulkAssignGroup = async (group: string) => {
    const g = group.trim()
    if (!g) return
    setBulkMenu(null)
    setGroupDraft('')
    const err = await runBulk((id) => updateDevice(id, { group_name: g }))
    if (!err) setSelected(new Set())
  }

  const bulkDelete = async () => {
    if (!canDelete || selectedIds.length === 0) return
    if (!window.confirm(`Delete ${selectedIds.length} device${selectedIds.length === 1 ? '' : 's'}? This cannot be undone.`)) return
    const err = await runBulk((id) => deleteDevice(id))
    if (!err) setSelected(new Set())
  }

  const exportSelected = () => {
    if (selectedIds.length === 0) return
    const rows = devices
      .filter((d) => selected.has(d.id))
      .map((d) => ({
        id: d.id, name: d.name, udid: d.udid, status: d.status, group: d.group_name,
        platform: d.platform, os_version: d.os_version, ip_address: d.ip_address,
        wda_port: d.wda_port, last_heartbeat: d.last_heartbeat,
      }))
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'mobfleet-devices.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const allVisibleSelected = visible.length > 0 && visible.every((d) => selected.has(d.id))

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-line gap-3 flex-wrap">
        <div>
          <p className="mono text-[9px] uppercase tracking-[0.2em] text-white/30 mb-1">
            {team?.name ?? 'Workspace'} · <span style={{ color: 'var(--status-online)' }}>Live</span>
          </p>
          <h1 className="mono text-lg font-bold tracking-widest text-white uppercase">DEVICE REGISTRY</h1>
          <p className="mono text-[10px] text-white/30 tracking-wider mt-0.5">{devices.length} UNITS TRACKED</p>
        </div>
        {canWrite && (
          adding ? (
            <form onSubmit={submitAdd} className="flex items-center gap-2">
              <input
                autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Device name"
                className="mono h-8 w-44 rounded-control border border-line bg-elevated px-2.5 text-[12px] text-fg outline-none focus:border-[var(--accent-border)]"
              />
              <Button type="submit" variant="primary" size="sm" disabled={busy}>{busy ? '…' : 'Add'}</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => { setAdding(false); setName('') }}>Cancel</Button>
            </form>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setAdding(true)}><Plus size={13} /> Add manually</Button>
              <Button variant="primary" size="sm" onClick={openPair}><QrCode size={13} /> Pair device</Button>
            </div>
          )
        )}
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-6 py-4 border-b border-line">
        {kpis.map(({ label, value, color, topBorder }, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
            className="hud-corners p-4 flex flex-col gap-2"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderTop: `2px solid ${topBorder}`,
              ['--hud-c' as string]: `${topBorder}`,
            }}
          >
            <span className="mono text-[9px] uppercase tracking-[0.15em]" style={{ color: 'rgba(255,255,255,0.4)' }}>{label}</span>
            <AnimatedCounter target={value} color={color} />
          </motion.div>
        ))}
      </div>

      {/* Toolbar — search + filters */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-line flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="SEARCH UNITS..."
            className="w-full h-8 pl-8 pr-3 bg-transparent border border-line text-[10px] mono text-white/70 placeholder-white/20 outline-none focus:border-[var(--accent-border)] tracking-wider transition-colors"
          />
        </div>
        <FilterSelect label="Status" options={ALL_STATUSES.map((s) => STATUS[s].label)} value={statusFilter} onChange={setStatusFilter} />
        <FilterSelect label="Group" options={groups} value={groupFilter} onChange={setGroupFilter} />
        <FilterSelect label="Platform" options={platforms} value={platformFilter} onChange={setPlatformFilter} />
        {filtersActive && (
          <button
            type="button"
            onClick={clearFilters}
            className="mono h-8 px-2 text-[9px] uppercase tracking-widest text-white/40 hover:text-white/80 transition-colors"
          >
            Clear
          </button>
        )}
        <span className="mono ml-auto text-[9px] uppercase tracking-widest text-white/25">{visible.length} SHOWN</span>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {error && (
          <div role="alert" className="mx-6 mt-4 rounded-control border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">{error}</div>
        )}
        {actionError && (
          <div role="alert" className="mx-6 mt-4 rounded-control border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">{actionError}</div>
        )}

        {loading ? (
          <div className="flex h-full items-center justify-center"><Spinner size={22} /></div>
        ) : devices.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-elevated">
              <Activity size={20} className="text-white/30" />
            </div>
            <p className="mono text-[11px] uppercase tracking-widest text-fg-secondary">No devices yet</p>
            <p className="mono max-w-[300px] text-[11px] leading-relaxed text-fg-muted">
              This workspace has no registered devices. Pair one to start tracking live status.
            </p>
            {canWrite && (
              <Button variant="primary" size="sm" className="mt-1" onClick={openPair}><QrCode size={13} /> Pair device</Button>
            )}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-black">
              <tr className="border-b border-line">
                {canWrite && (
                  <th className="px-4 py-3 text-left w-8">
                    <button
                      onClick={toggleAll}
                      aria-label="Select all"
                      className="w-3.5 h-3.5 border border-white/20 flex items-center justify-center transition-colors hover:border-white/50"
                      style={{ background: allVisibleSelected ? 'rgba(255,255,255,0.9)' : 'transparent' }}
                    >
                      {allVisibleSelected && <Check size={8} className="text-black" />}
                    </button>
                  </th>
                )}
                {['NAME', 'STATUS', 'GROUP', 'PLATFORM', 'ADDRESS', 'HEARTBEAT', ''].map((h) => (
                  <th key={h} className="px-3 py-3 text-left mono text-[9px] font-medium text-white/25 uppercase tracking-[0.1em] whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((d, i) => {
                const meta = STATUS[d.status]
                const isSel = selected.has(d.id)
                const lhMs = d.last_heartbeat ? Date.parse(d.last_heartbeat) : null
                const stale = isHeartbeatStale(lhMs, now)
                const addr = d.ip_address ? `${d.ip_address}${d.wda_port ? `:${d.wda_port}` : ''}` : '—'
                return (
                  <motion.tr
                    key={d.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.25, delay: Math.min(i * 0.018, 0.5) }}
                    onClick={() => canWrite && toggle(d.id)}
                    className={`border-b border-white/[0.04] transition-all duration-100 ${canWrite ? 'cursor-pointer' : ''}`}
                    style={{
                      borderLeft: isSel ? '2px solid var(--accent)' : '2px solid transparent',
                      background: isSel ? 'var(--accent-soft)' : 'transparent',
                    }}
                  >
                    {canWrite && (
                      <td className="px-4 py-3">
                        <div
                          className="w-3.5 h-3.5 border border-white/15 flex items-center justify-center transition-colors"
                          style={{ background: isSel ? 'rgba(255,255,255,0.9)' : 'transparent' }}
                        >
                          {isSel && <Check size={8} className="text-black" />}
                        </div>
                      </td>
                    )}
                    <td className="px-3 py-3 whitespace-nowrap">
                      <div className="mono text-white/75 text-[11px]">{d.name}</div>
                      <div className="mono text-white/25 text-[9px] truncate max-w-[200px]">{d.udid ?? 'no udid'}</div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="flex items-center gap-1.5">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${d.status !== 'offline' ? 'status-dot-pulse' : ''}`}
                          style={{ background: meta.color, boxShadow: d.status !== 'offline' ? `0 0 5px ${meta.color}` : 'none' }}
                        />
                        <span className="mono text-[10px] uppercase tracking-wider" style={{ color: meta.color }}>{meta.label}</span>
                      </span>
                    </td>
                    <td className="px-3 py-3 mono text-white/45 text-[11px] whitespace-nowrap">{d.group_name || '—'}</td>
                    <td className="px-3 py-3 mono text-white/35 text-[11px] whitespace-nowrap">
                      {d.platform}{d.os_version ? ` ${d.os_version}` : ''}
                    </td>
                    <td className="px-3 py-3 mono text-white/35 text-[11px] whitespace-nowrap">{addr}</td>
                    <td className="px-3 py-3">
                      <span className="flex items-center gap-1.5" title={stale ? 'No heartbeat in 30s+ — device offline' : 'Heartbeat fresh'}>
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${stale ? '' : 'status-dot-pulse'}`}
                          style={{
                            background: stale ? 'var(--status-offline)' : 'var(--status-online)',
                            boxShadow: stale ? 'none' : '0 0 5px var(--status-online)',
                          }}
                        />
                        <span className="mono text-[10px]" style={{ color: stale ? 'var(--status-error)' : 'rgba(255,255,255,0.45)' }}>
                          {hbAgo(d.last_heartbeat, now)}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); openPhoneControl(d.id) }}
                        title="Open live phone control"
                        className="mono px-2.5 py-1 text-[9px] uppercase tracking-widest text-white/30 border border-white/[0.12] hover:border-[var(--accent-border)] hover:text-[var(--accent-text)] hover:bg-[var(--accent-soft)] transition-colors"
                      >
                        CONTROL →
                      </button>
                    </td>
                  </motion.tr>
                )
              })}
            </tbody>
          </table>
        )}

        {!loading && devices.length > 0 && visible.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <span className="mono text-[10px] uppercase tracking-widest text-white/30">No devices match the current filters</span>
            {filtersActive && (
              <button type="button" onClick={clearFilters} className="mono text-[9px] uppercase tracking-widest text-[var(--accent-text)] hover:underline">
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Floating bulk-action bar — real Supabase mutations across the selection */}
      <AnimatePresence>
        {canWrite && selectedCount > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30"
          >
            <div ref={barRef} className="relative flex items-center gap-2 px-4 py-2.5 border border-white/[0.15] bg-black shadow-2xl">
              <span className="mono text-[9px] text-white/40 mr-1 whitespace-nowrap uppercase tracking-widest">{selectedCount} SELECTED</span>
              <div className="w-px h-4 bg-white/[0.08]" />

              {/* Set status */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setBulkMenu((m) => (m === 'status' ? null : 'status'))}
                  disabled={bulkBusy}
                  className="mono flex items-center gap-1.5 px-3 py-1.5 text-[9px] uppercase tracking-widest text-white/50 transition-colors enabled:hover:text-white/90 enabled:hover:bg-white/[0.06] disabled:opacity-40"
                >
                  <Activity size={11} /> Set status <ChevronDown size={9} className="text-white/30" />
                </button>
                <AnimatePresence>
                  {bulkMenu === 'status' && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 6 }}
                      transition={{ duration: 0.14 }}
                      className="absolute bottom-9 left-0 min-w-[150px] border border-line bg-elevated shadow-2xl py-1"
                    >
                      {ALL_STATUSES.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => void bulkSetStatus(s)}
                          className="mono w-full px-3 py-1.5 text-left text-[10px] uppercase tracking-wider transition-colors hover:bg-hover flex items-center gap-2"
                          style={{ color: STATUS[s].color }}
                        >
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS[s].color }} />
                          {STATUS[s].label}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Assign group */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setBulkMenu((m) => (m === 'group' ? null : 'group'))}
                  disabled={bulkBusy}
                  className="mono flex items-center gap-1.5 px-3 py-1.5 text-[9px] uppercase tracking-widest text-white/50 transition-colors enabled:hover:text-white/90 enabled:hover:bg-white/[0.06] disabled:opacity-40"
                >
                  <FolderInput size={11} /> Group <ChevronDown size={9} className="text-white/30" />
                </button>
                <AnimatePresence>
                  {bulkMenu === 'group' && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 6 }}
                      transition={{ duration: 0.14 }}
                      className="absolute bottom-9 left-0 min-w-[180px] border border-line bg-elevated shadow-2xl py-1"
                    >
                      <form
                        onSubmit={(e) => { e.preventDefault(); void bulkAssignGroup(groupDraft) }}
                        className="px-2 py-1.5"
                      >
                        <input
                          value={groupDraft}
                          onChange={(e) => setGroupDraft(e.target.value)}
                          placeholder="New group name…"
                          className="mono w-full h-7 rounded-control border border-line bg-panel px-2 text-[10px] text-fg outline-none focus:border-[var(--accent-border)]"
                        />
                      </form>
                      {groups.length > 0 && <div className="my-1 h-px bg-white/[0.06]" />}
                      {groups.map((g) => (
                        <button
                          key={g}
                          type="button"
                          onClick={() => void bulkAssignGroup(g)}
                          className="mono w-full px-3 py-1.5 text-left text-[10px] uppercase tracking-wider text-white/55 hover:bg-hover hover:text-white/90 transition-colors"
                        >
                          {g}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Export */}
              <button
                type="button"
                onClick={exportSelected}
                disabled={bulkBusy}
                className="mono flex items-center gap-1.5 px-3 py-1.5 text-[9px] uppercase tracking-widest text-white/50 transition-colors enabled:hover:text-white/90 enabled:hover:bg-white/[0.06] disabled:opacity-40"
              >
                <Download size={11} /> Export
              </button>

              {/* Delete — owner/admin only (RLS devices_delete = is_team_admin) */}
              {canDelete && (
                <button
                  type="button"
                  onClick={() => void bulkDelete()}
                  disabled={bulkBusy}
                  className="mono flex items-center gap-1.5 px-3 py-1.5 text-[9px] uppercase tracking-widest text-status-error transition-colors enabled:hover:bg-[rgba(255,77,77,0.1)] disabled:opacity-40"
                >
                  <Trash2 size={11} /> Delete
                </button>
              )}

              <div className="w-px h-4 bg-white/[0.08]" />
              <button
                onClick={() => { setSelected(new Set()); setBulkMenu(null) }}
                aria-label="Clear selection"
                className="flex items-center justify-center w-6 h-6 text-white/30 hover:text-white/70 hover:bg-white/[0.08] transition-colors"
              >
                <X size={12} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

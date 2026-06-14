import { useState, useMemo, useEffect, useRef } from 'react'
import { Search, Upload, Plus, Check, Briefcase, RotateCcw, UserPlus, Download, X, ChevronDown } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useFleet } from '@/hooks/use-fleet'
import { useNow } from '@/hooks/use-now'
import { isHeartbeatStale } from '@/shared/heartbeat'
import { client, safe } from '@/lib/provider'
import { STATUS, ALL_STATUSES } from '@/lib/status'
import { useUIStore } from '@/state/ui-store'
import { useActingEmployee, useScopedDevices } from '@/lib/authorization/use-access'
import { can } from '@/lib/authorization'
import { logAudit } from '@/services/audit'

const STATUS_COLORS: Record<string, string> = {
  online:  'var(--status-online)',
  busy:    'var(--status-busy)',
  warming: 'var(--status-warming)',
  offline: 'var(--status-offline)',
  error:   'var(--status-error)',
}

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

/** Dropdown filter — closes on outside click; null option clears. */
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
        onClick={() => setOpen(o => !o)}
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
            {options.map(o => (
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

/** Relative age of the last heartbeat (epoch ms), against a live clock. */
function hbAgo(lastHeartbeat: number | null | undefined, now: number): string {
  if (lastHeartbeat == null) return 'never'
  const s = Math.max(0, Math.round((now - lastHeartbeat) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function PhonesView() {
  const snapshot              = useFleet()
  const now                   = useNow() // ticks so heartbeat freshness self-updates
  const [search, setSearch]   = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [groupFilter, setGroupFilter]   = useState<string | null>(null)
  const [modelFilter, setModelFilter]   = useState<string | null>(null)
  const [jobFilter, setJobFilter]       = useState<string | null>(null)
  const [groupMenuOpen, setGroupMenuOpen] = useState(false)
  const openPhoneControl      = useUIStore((s) => s.openPhoneControl)
  const openDrawer            = useUIStore((s) => s.openDrawer)
  const openScale             = useUIStore((s) => s.openScale)

  // Scope-filtered at the selector boundary — out-of-scope devices never reach
  // the table. The same predicate must run server-side (see lib/authorization).
  const { employee, member } = useActingEmployee()
  const devices = useScopedDevices()
  const canReboot      = can(member, 'phones.reboot')
  const canExport      = can(member, 'phones.export')
  const canAssignGroup = can(member, 'phones.assign_group')
  const canRunJob      = can(member, 'automations.run')
  const canImport      = can(member, 'phones.import')
  const jobById = useMemo(() => new Map(snapshot.jobs.map(j => [j.id, j])), [snapshot.jobs])

  const groups = useMemo(() => [...new Set(devices.map(d => d.group))].sort(), [devices])
  const models = useMemo(() => [...new Set(devices.map(d => d.model))].sort(), [devices])
  const jobTypes = useMemo(
    () => [...new Set(devices.map(d => (d.jobId ? jobById.get(d.jobId)?.type : null)).filter(Boolean) as string[])].sort(),
    [devices, jobById],
  )

  const visible = useMemo(
    () => devices.filter(d => {
      const job = d.jobId ? jobById.get(d.jobId) : null
      return (
        d.name.toLowerCase().includes(search.toLowerCase()) &&
        (!statusFilter || STATUS[d.status].label === statusFilter) &&
        (!groupFilter || d.group === groupFilter) &&
        (!modelFilter || d.model === modelFilter) &&
        (!jobFilter || job?.type === jobFilter)
      )
    }),
    [devices, jobById, search, statusFilter, groupFilter, modelFilter, jobFilter],
  )

  const onlineCount  = devices.filter(d => d.status === 'online' || d.status === 'busy' || d.status === 'warming').length
  const errorCount   = devices.filter(d => d.status === 'error').length
  const offlineCount = devices.filter(d => d.status === 'offline').length

  const kpis = [
    { label: 'TOTAL UNITS',   value: devices.length, color: '#ffffff',              topBorder: 'rgba(255,255,255,0.3)' },
    { label: 'ONLINE',        value: onlineCount,    color: 'var(--accent-green)',   topBorder: 'var(--accent-green)' },
    { label: 'FAULT',         value: errorCount,     color: 'var(--accent-red)',     topBorder: 'var(--accent-red)' },
    { label: 'OFFLINE',       value: offlineCount,   color: 'rgba(255,255,255,0.3)', topBorder: 'rgba(255,255,255,0.15)' },
  ]

  function toggleAll() {
    setSelected(prev => prev.size === visible.length ? new Set() : new Set(visible.map(d => d.id)))
  }
  function toggle(id: string) {
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const exportSelected = () => {
    if (!canExport) return
    const rows = devices
      .filter(d => selected.has(d.id))
      .map(d => ({ id: d.id, name: d.name, status: d.status, group: d.group, model: d.model, os: d.osVersion, battery: d.battery }))
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'mobfleet-devices.json'
    a.click()
    URL.revokeObjectURL(url)
    logAudit({ actor: employee.name, action: 'phone.command', target: `${rows.length} devices`, detail: 'export device registry', result: 'success' })
  }

  const rebootSelected = () => {
    if (!canReboot) return
    const names = devices.filter(d => selected.has(d.id)).map(d => d.name)
    selected.forEach(id => {
      safe(client.stop(id).then(() => client.start(id)), 'Could not reboot device')
    })
    logAudit({ actor: employee.name, action: 'phone.rebooted', target: `${names.length} devices`, detail: names.join(', '), result: 'success' })
    setSelected(new Set())
  }

  const runJobSelected = () => {
    if (!canRunJob) return
    selected.forEach(id => safe(client.runTask(id, { type: 'upload', label: 'Manual upload' }), 'Could not run job'))
    logAudit({ actor: employee.name, action: 'automation.run', target: `${selected.size} devices`, detail: 'manual upload job', result: 'success' })
    setSelected(new Set())
  }

  const assignGroupSelected = (g: string) => {
    if (!canAssignGroup) return
    safe(client.assignGroup([...selected], g), 'Could not reassign group')
    logAudit({ actor: employee.name, action: 'phone.command', target: `${selected.size} devices`, detail: `assign group → ${g}`, result: 'success' })
    setGroupMenuOpen(false)
    setSelected(new Set())
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-line">
        <div>
          <p className="mono text-[9px] uppercase tracking-[0.2em] text-white/30 mb-1">Fleet Registry</p>
          <h1 className="mono text-lg font-bold tracking-widest text-white uppercase">DEVICE REGISTRY</h1>
          <p className="mono text-[10px] text-white/30 tracking-wider mt-0.5">{devices.length} UNITS TRACKED</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            disabled
            title="Bulk import requires the backend connection (VITE_USE_BACKEND)"
            className="mono h-8 px-4 text-[10px] uppercase tracking-widest text-white/20 border border-white/[0.08] cursor-not-allowed"
          >
            <Upload size={11} className="inline mr-1.5" />IMPORT
          </button>
          <button
            onClick={openScale}
            disabled={!canImport}
            title={canImport ? 'Add a device to the fleet' : 'Requires import permission'}
            className="mono h-8 px-4 text-[10px] uppercase tracking-widest text-white border border-white/30 transition-colors enabled:hover:bg-white enabled:hover:text-black disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Plus size={11} className="inline mr-1.5" />ADD UNIT
          </button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-3 px-6 py-4 border-b border-line">
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

      {/* Toolbar — search + the four primary filters */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-line">
        <div className="relative flex-1 max-w-xs">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="SEARCH UNITS..."
            className="w-full h-8 pl-8 pr-3 bg-transparent border border-line text-[10px] mono text-white/70 placeholder-white/20 outline-none focus:border-[var(--accent-border)] tracking-wider transition-colors"
          />
        </div>
        <FilterSelect label="Status" options={ALL_STATUSES.map(s => STATUS[s].label)} value={statusFilter} onChange={setStatusFilter} />
        <FilterSelect label="Group"  options={groups} value={groupFilter} onChange={setGroupFilter} />
        <FilterSelect label="Model"  options={models} value={modelFilter} onChange={setModelFilter} />
        <FilterSelect label="Job"    options={jobTypes} value={jobFilter} onChange={setJobFilter} />
        {(statusFilter || groupFilter || modelFilter || jobFilter) && (
          <button
            type="button"
            onClick={() => { setStatusFilter(null); setGroupFilter(null); setModelFilter(null); setJobFilter(null) }}
            className="mono h-8 px-2 text-[9px] uppercase tracking-widest text-white/40 hover:text-white/80 transition-colors"
          >
            Clear
          </button>
        )}
        <span className="mono ml-auto text-[9px] uppercase tracking-widest text-white/25">{visible.length} SHOWN</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-black">
            <tr className="border-b border-line">
              <th className="px-4 py-3 text-left w-8">
                <button
                  onClick={toggleAll}
                  aria-label="Select all"
                  className="w-3.5 h-3.5 border border-white/20 flex items-center justify-center transition-colors hover:border-white/50"
                  style={{ background: selected.size === visible.length && visible.length > 0 ? 'rgba(255,255,255,0.9)' : 'transparent' }}
                >
                  {selected.size === visible.length && visible.length > 0 && <Check size={8} className="text-black" />}
                </button>
              </th>
              {['NAME', 'STATUS', 'GROUP', 'MODEL', 'JOB', 'HEARTBEAT', ''].map(h => (
                <th key={h} className="px-3 py-3 text-left mono text-[9px] font-medium text-white/25 uppercase tracking-[0.1em] whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((d, i) => {
              const meta   = STATUS[d.status]
              const isSel  = selected.has(d.id)
              const job    = d.jobId ? jobById.get(d.jobId) : null
              const dotColor = STATUS_COLORS[d.status] ?? meta?.color ?? 'rgba(255,255,255,0.3)'
              const stale  = isHeartbeatStale(d.lastHeartbeat, now)
              return (
                <motion.tr
                  key={d.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.25, delay: Math.min(i * 0.018, 0.5) }}
                  onClick={() => toggle(d.id)}
                  onDoubleClick={() => openDrawer(d.id)}
                  title="Double-click for live control"
                  className="border-b border-white/[0.04] cursor-pointer transition-all duration-100"
                  style={{
                    borderLeft: isSel ? '2px solid var(--accent)' : '2px solid transparent',
                    background: isSel ? 'var(--accent-soft)' : 'transparent',
                  }}
                >
                  <td className="px-4 py-3">
                    <div
                      className="w-3.5 h-3.5 border border-white/15 flex items-center justify-center transition-colors"
                      style={{ background: isSel ? 'rgba(255,255,255,0.9)' : 'transparent' }}
                    >
                      {isSel && <Check size={8} className="text-black" />}
                    </div>
                  </td>
                  <td className="px-3 py-3 mono text-white/70 text-[11px] whitespace-nowrap">{d.name}</td>
                  <td className="px-3 py-3">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${d.status !== 'offline' ? 'status-dot-pulse' : ''}`}
                        style={{ background: dotColor, boxShadow: d.status !== 'offline' ? `0 0 5px ${dotColor}` : 'none' }}
                      />
                      <span className="mono text-[10px] uppercase tracking-wider" style={{ color: dotColor }}>{meta?.label ?? d.status}</span>
                    </span>
                  </td>
                  <td className="px-3 py-3 mono text-white/45 text-[11px]">{d.group}</td>
                  <td className="px-3 py-3 mono text-white/35 text-[11px]">{d.model}</td>
                  <td className="px-3 py-3">
                    {job ? (
                      <span className="flex items-center gap-2">
                        <span className="mono text-[10px] uppercase tracking-wider text-[#4fc3f7]">{job.type}</span>
                        <span className="w-12 h-0.5 bg-white/[0.08] overflow-hidden">
                          <span className="block h-full transition-[width] duration-500" style={{ width: `${Math.round(job.progress * 100)}%`, background: 'var(--status-busy)' }} />
                        </span>
                      </span>
                    ) : (
                      <span className="mono text-[10px] text-white/20">—</span>
                    )}
                  </td>
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
                        {hbAgo(d.lastHeartbeat, now)}
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <button
                      onClick={e => { e.stopPropagation(); openPhoneControl(d.id) }}
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
        {visible.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <span className="mono text-[10px] uppercase tracking-widest text-white/30">No devices match the current filters</span>
          </div>
        )}
      </div>

      {/* Floating bulk action bar */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30"
          >
            <div className="relative flex items-center gap-2 px-4 py-2.5 border border-white/[0.15] bg-black shadow-2xl">
              <span className="mono text-[9px] text-white/40 mr-1 whitespace-nowrap uppercase tracking-widest">{selected.size} SELECTED</span>
              <div className="w-px h-4 bg-white/[0.08]" />
              <button
                type="button"
                onClick={runJobSelected}
                disabled={!canRunJob}
                title={canRunJob ? 'Run a job on the selected devices' : 'Requires run-automation permission'}
                className="mono flex items-center gap-1.5 px-3 py-1.5 text-[9px] uppercase tracking-widest text-white/50 transition-colors enabled:hover:text-white/90 enabled:hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-30"
              >
                <Briefcase size={11} /> RUN JOB
              </button>
              <button
                type="button"
                onClick={rebootSelected}
                disabled={!canReboot}
                title={canReboot ? 'Reboot the selected devices' : 'Requires reboot permission'}
                className="mono flex items-center gap-1.5 px-3 py-1.5 text-[9px] uppercase tracking-widest text-white/50 transition-colors enabled:hover:text-white/90 enabled:hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-30"
              >
                <RotateCcw size={11} /> REBOOT
              </button>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => { if (!canAssignGroup) return; setGroupMenuOpen(o => !o) }}
                  disabled={!canAssignGroup}
                  title={canAssignGroup ? 'Assign the selected devices to a group' : 'Requires assign-group permission'}
                  className="mono flex items-center gap-1.5 px-3 py-1.5 text-[9px] uppercase tracking-widest text-white/50 transition-colors enabled:hover:text-white/90 enabled:hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <UserPlus size={11} /> GROUP
                </button>
                <AnimatePresence>
                  {groupMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 6 }}
                      transition={{ duration: 0.14 }}
                      className="absolute bottom-9 left-0 min-w-[150px] border border-line bg-elevated shadow-2xl py-1"
                    >
                      {groups.map(g => (
                        <button
                          key={g}
                          type="button"
                          onClick={() => assignGroupSelected(g)}
                          className="mono w-full px-3 py-1.5 text-left text-[10px] uppercase tracking-wider text-white/55 hover:bg-hover hover:text-white/90 transition-colors"
                        >
                          {g}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <button
                type="button"
                onClick={exportSelected}
                disabled={!canExport}
                title={canExport ? 'Export the selected devices' : 'Requires export permission'}
                className="mono flex items-center gap-1.5 px-3 py-1.5 text-[9px] uppercase tracking-widest text-white/50 transition-colors enabled:hover:text-white/90 enabled:hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-30"
              >
                <Download size={11} /> EXPORT
              </button>
              <div className="w-px h-4 bg-white/[0.08]" />
              <button
                onClick={() => { setSelected(new Set()); setGroupMenuOpen(false) }}
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

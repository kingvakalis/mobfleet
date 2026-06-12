import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Search, RotateCcw, Maximize2, ChevronDown, X, Check,
  Lock, Unlock, Crosshair, Eye, EyeOff,
} from 'lucide-react'
import { STATUS, ALL_STATUSES } from '@/lib/status'
import { graphBus } from '@/lib/graph-bus'
import { useFleet } from '@/hooks/use-fleet'
import { matchesDevice, groupColor } from '@/lib/fleet-filtering'
import { EMPTY_FLEET_FILTERS, fleetFiltersActive, type FleetFilters } from '@/state/ui-store'

export type { FleetFilters }

function useOutside(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [onClose])
  return ref
}

/** Single-select dropdown with per-option counts. */
function CountDropdown({ label, value, options, onSelect }: {
  label: string
  value: string | null
  options: { id: string; label: string; count: number; color?: string }[]
  onSelect: (v: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useOutside(() => setOpen(false))
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={[
          'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors',
          value ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]' : 'text-white/50 hover:bg-white/[0.05] hover:text-white/80',
        ].join(' ')}
      >
        {value ?? label}
        <ChevronDown size={11} className="opacity-50" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-1 min-w-[170px] rounded-xl border border-line bg-elevated py-1 shadow-2xl">
          <button
            type="button"
            onClick={() => { onSelect(null); setOpen(false) }}
            className="w-full px-3 py-1.5 text-left text-xs text-white/40 transition-colors hover:bg-white/[0.04] hover:text-white/80"
          >
            All
          </button>
          {options.map(o => (
            <button
              key={o.id}
              type="button"
              onClick={() => { onSelect(o.id); setOpen(false) }}
              className={[
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
                value === o.id ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]' : 'text-white/60 hover:bg-white/[0.04] hover:text-white/90',
              ].join(' ')}
            >
              {o.color && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: o.color }} />}
              <span className="flex-1">{o.label}</span>
              <span className="mono text-[10px] tabular-nums text-white/30">{o.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Multi-select group dropdown with search + counts. */
function GroupMultiSelect({ groups, selected, onChange }: {
  groups: { name: string; count: number }[]
  selected: string[]
  onChange: (groups: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useOutside(() => setOpen(false))
  const visible = groups.filter(g => g.name.toLowerCase().includes(q.toLowerCase()))

  const toggle = (name: string) =>
    onChange(selected.includes(name) ? selected.filter(g => g !== name) : [...selected, name])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={[
          'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors',
          selected.length ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]' : 'text-white/50 hover:bg-white/[0.05] hover:text-white/80',
        ].join(' ')}
      >
        {selected.length === 0 ? 'Group' : selected.length === 1 ? selected[0] : `${selected.length} groups`}
        <ChevronDown size={11} className="opacity-50" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-1 w-[210px] rounded-xl border border-line bg-elevated py-1 shadow-2xl">
          <div className="px-2 pb-1 pt-1.5">
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search groups…"
              className="h-7 w-full rounded-md border border-line bg-black/40 px-2 text-[11px] text-white/80 placeholder-white/25 outline-none focus:border-[var(--accent-border)]"
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {visible.map(g => {
              const on = selected.includes(g.name)
              const color = groupColor(selected, g.name)
              return (
                <button
                  key={g.name}
                  type="button"
                  onClick={() => toggle(g.name)}
                  className={[
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
                    on ? 'text-[var(--accent-text)]' : 'text-white/60 hover:bg-white/[0.04] hover:text-white/90',
                  ].join(' ')}
                >
                  <span
                    className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border border-white/20"
                    style={{ background: on ? (color ?? 'var(--accent)') : 'transparent' }}
                  >
                    {on && <Check size={9} className="text-black" />}
                  </span>
                  <span className="flex-1 truncate">{g.name}</span>
                  <span className="mono text-[10px] tabular-nums text-white/30">{g.count}</span>
                </button>
              )
            })}
            {visible.length === 0 && <div className="px-3 py-2 text-[11px] text-white/25">No groups match</div>}
          </div>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 w-full border-t border-line px-3 py-1.5 text-left text-[11px] text-white/35 hover:text-white/70"
            >
              Clear groups
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Chip({ label, color, onRemove }: { label: string; color?: string; onRemove: () => void }) {
  return (
    <span
      className="flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px]"
      style={{
        borderColor: color ? `${color}55` : 'var(--accent-border)',
        background: color ? `${color}14` : 'var(--accent-soft)',
        color: color ?? 'var(--accent-text)',
      }}
    >
      {label}
      <button type="button" onClick={onRemove} aria-label={`Remove filter ${label}`} className="opacity-60 transition-opacity hover:opacity-100">
        <X size={10} />
      </button>
    </span>
  )
}

export interface FleetControlsProps {
  filters: FleetFilters
  setFilters: (f: FleetFilters) => void
  locked: boolean
  setLocked: (v: boolean) => void
  onResetPositions: () => void
  onFocusMatches: () => void
}

/** Floating fleet filter + layout bar. Shared by the 2D and 3D views. */
export function FleetControls({ filters, setFilters, locked, setLocked, onResetPositions, onFocusMatches }: FleetControlsProps) {
  const snapshot = useFleet()
  // Debounce search so the graph doesn't recompute per keystroke.
  const [searchDraft, setSearchDraft] = useState(filters.search)
  // External clears (chips / Clear all) re-sync the draft — render-adjustment pattern.
  const [lastExternal, setLastExternal] = useState(filters.search)
  if (filters.search !== lastExternal) {
    setLastExternal(filters.search)
    setSearchDraft(filters.search)
  }
  useEffect(() => {
    const id = setTimeout(() => {
      if (searchDraft !== filters.search) setFilters({ ...filters, search: searchDraft })
    }, 220)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft])

  const jobById = useMemo(() => new Map(snapshot.jobs.map(j => [j.id, j])), [snapshot.jobs])

  const statusOptions = useMemo(
    () => ALL_STATUSES.map(s => ({
      id: STATUS[s].label,
      label: STATUS[s].label,
      color: STATUS[s].color,
      count: snapshot.devices.filter(d => d.status === s).length,
    })),
    [snapshot.devices],
  )

  const groupOptions = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of snapshot.devices) m.set(d.group, (m.get(d.group) ?? 0) + 1)
    return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name))
  }, [snapshot.devices])

  const modelOptions = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of snapshot.devices) m.set(d.model, (m.get(d.model) ?? 0) + 1)
    return [...m.entries()].map(([id, count]) => ({ id, label: id, count })).sort((a, b) => a.id.localeCompare(b.id))
  }, [snapshot.devices])

  const jobOptions = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of snapshot.devices) {
      const t = d.jobId ? jobById.get(d.jobId)?.type : undefined
      if (t) m.set(t, (m.get(t) ?? 0) + 1)
    }
    return [...m.entries()].map(([id, count]) => ({ id, label: id, count }))
  }, [snapshot.devices, jobById])

  const matching = useMemo(
    () => snapshot.devices.filter(d => matchesDevice(filters, d, d.jobId ? jobById.get(d.jobId) : null)).length,
    [snapshot.devices, jobById, filters],
  )

  const active = fleetFiltersActive(filters)

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Active filter chips + count + legend */}
      {active && (
        <div className="flex max-w-[760px] flex-wrap items-center justify-center gap-1.5 rounded-xl border border-line bg-panel/80 px-3 py-2 backdrop-blur-md">
          <span className="mono mr-1 text-[10px] tabular-nums text-white/55">
            {matching} of {snapshot.devices.length} match
          </span>
          {filters.status && <Chip label={`Status: ${filters.status}`} onRemove={() => setFilters({ ...filters, status: null })} />}
          {filters.groups.map(g => (
            <Chip
              key={g}
              label={g}
              color={groupColor(filters.groups, g) ?? undefined}
              onRemove={() => setFilters({ ...filters, groups: filters.groups.filter(x => x !== g) })}
            />
          ))}
          {filters.model && <Chip label={`Model: ${filters.model}`} onRemove={() => setFilters({ ...filters, model: null })} />}
          {filters.job && <Chip label={`Job: ${filters.job}`} onRemove={() => setFilters({ ...filters, job: null })} />}
          {filters.search && <Chip label={`"${filters.search}"`} onRemove={() => setFilters({ ...filters, search: '' })} />}
          <button
            type="button"
            onClick={() => setFilters({ ...filters, hideNonMatching: !filters.hideNonMatching })}
            title={filters.hideNonMatching ? 'Show non-matching (dimmed)' : 'Hide non-matching'}
            className="flex items-center gap-1 rounded-full border border-line px-2 py-1 text-[10px] text-white/45 transition-colors hover:text-white/80"
          >
            {filters.hideNonMatching ? <EyeOff size={10} /> : <Eye size={10} />}
            {filters.hideNonMatching ? 'Hidden' : 'Dimmed'}
          </button>
          <button
            type="button"
            onClick={onFocusMatches}
            title="Fit matching phones in the viewport"
            className="flex items-center gap-1 rounded-full border border-line px-2 py-1 text-[10px] text-white/45 transition-colors hover:text-white/80"
          >
            <Crosshair size={10} /> Focus
          </button>
          <button
            type="button"
            onClick={() => setFilters({ ...EMPTY_FLEET_FILTERS })}
            className="rounded-full px-2 py-1 text-[10px] text-white/35 transition-colors hover:text-white/75"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Main bar */}
      <div className="flex items-center gap-1 rounded-xl border border-line bg-panel/80 px-2 py-1.5 backdrop-blur-md">
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/25" />
          <input
            value={searchDraft}
            onChange={e => setSearchDraft(e.target.value)}
            placeholder="Search devices"
            aria-label="Search devices"
            className="h-7 w-36 rounded-lg border border-transparent bg-white/[0.04] pl-7 pr-2 text-xs text-white/80 placeholder-white/25 outline-none transition-colors focus:border-[var(--accent-border)]"
          />
        </div>
        <CountDropdown label="Status" value={filters.status} options={statusOptions} onSelect={status => setFilters({ ...filters, status })} />
        <GroupMultiSelect groups={groupOptions} selected={filters.groups} onChange={groups => setFilters({ ...filters, groups })} />
        <CountDropdown label="Model" value={filters.model} options={modelOptions} onSelect={model => setFilters({ ...filters, model })} />
        <CountDropdown label="Job" value={filters.job} options={jobOptions} onSelect={job => setFilters({ ...filters, job })} />
        <div className="mx-1 h-5 w-px bg-line" />
        <button
          type="button"
          title={locked ? 'Unlock layout (allow dragging phones)' : 'Lock layout (prevent dragging phones)'}
          aria-pressed={locked}
          onClick={() => setLocked(!locked)}
          className={[
            'flex h-7 items-center gap-1.5 rounded-lg px-2 text-[10px] transition-colors',
            locked ? 'bg-amber-400/10 text-amber-400' : 'text-white/40 hover:bg-white/[0.06] hover:text-white/80',
          ].join(' ')}
        >
          {locked ? <Lock size={11} /> : <Unlock size={11} />}
          {locked ? 'Locked' : 'Lock'}
        </button>
        <button
          type="button"
          title="Reset all phone positions (asks for confirmation)"
          onClick={onResetPositions}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white/80"
        >
          <RotateCcw size={12} />
        </button>
        <button
          type="button"
          title="Fit view"
          onClick={() => graphBus.fitView?.()}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white/80"
        >
          <Maximize2 size={12} />
        </button>
      </div>
    </div>
  )
}

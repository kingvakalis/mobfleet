import { useEffect, useRef, useState } from 'react'
import { Search, RotateCcw, Maximize2, ChevronDown } from 'lucide-react'
import { STATUS, ALL_STATUSES } from '@/lib/status'
import { graphBus } from '@/lib/graph-bus'

export interface FleetFilters {
  search: string
  status: string | null
  group: string | null
}

export interface FleetControlsProps {
  filters: FleetFilters
  setFilters: (f: FleetFilters) => void
  groups: string[]
}

interface DropdownProps {
  label: string
  value: string | null
  options: string[]
  onSelect: (v: string | null) => void
}

function Dropdown({ label, value, options, onSelect }: DropdownProps) {
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
          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors',
          value
            ? 'text-[var(--accent-text)] bg-[var(--accent-soft)]'
            : 'text-white/50 hover:text-white/80 hover:bg-white/[0.05]',
        ].join(' ')}
      >
        {value ? value : label}
        <ChevronDown size={11} className="opacity-50" />
      </button>
      {open && (
        <div className="absolute bottom-full mb-1 left-0 z-50 min-w-[130px] rounded-xl bg-elevated border border-line shadow-2xl py-1 backdrop-blur-xl">
          <button
            type="button"
            onClick={() => { onSelect(null); setOpen(false) }}
            className="w-full text-left px-3 py-1.5 text-xs text-white/40 hover:text-white/80 hover:bg-white/[0.04] transition-colors"
          >
            All
          </button>
          {options.map(opt => (
            <button
              key={opt}
              type="button"
              onClick={() => { onSelect(opt); setOpen(false) }}
              className={[
                'w-full text-left px-3 py-1.5 text-xs transition-colors',
                value === opt
                  ? 'text-[var(--accent-text)] bg-[var(--accent-soft)]'
                  : 'text-white/60 hover:text-white/90 hover:bg-white/[0.04]',
              ].join(' ')}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Floating filter bar for the fleet canvas — search, status, group, reset, fit. */
export function FleetControls({ filters, setFilters, groups }: FleetControlsProps) {
  return (
    <div className="flex items-center gap-1 rounded-xl border border-line bg-panel/80 px-2 py-1.5 backdrop-blur-md">
      <div className="relative">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/25" />
        <input
          value={filters.search}
          onChange={e => setFilters({ ...filters, search: e.target.value })}
          placeholder="Search devices"
          className="h-7 w-40 rounded-lg bg-white/[0.04] border border-transparent pl-7 pr-2 text-xs text-white/80 placeholder-white/25 outline-none focus:border-[var(--accent-border)] transition-colors"
        />
      </div>
      <Dropdown
        label="Status"
        value={filters.status}
        options={ALL_STATUSES.map(s => STATUS[s].label)}
        onSelect={status => setFilters({ ...filters, status })}
      />
      <Dropdown
        label="Group"
        value={filters.group}
        options={groups}
        onSelect={group => setFilters({ ...filters, group })}
      />
      <div className="mx-1 h-5 w-px bg-line" />
      <button
        type="button"
        title="Reset filters"
        onClick={() => setFilters({ search: '', status: null, group: null })}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white/80 transition-colors"
      >
        <RotateCcw size={12} />
      </button>
      <button
        type="button"
        title="Fit view"
        onClick={() => graphBus.fitView?.()}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-white/40 hover:bg-white/[0.06] hover:text-white/80 transition-colors"
      >
        <Maximize2 size={12} />
      </button>
    </div>
  )
}

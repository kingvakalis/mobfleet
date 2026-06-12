import { useState } from 'react'
import {
  Search,
  Filter,
  LayoutGrid,
  RotateCcw,
  Maximize2,
  Pause,
  Play,
  ChevronDown,
} from 'lucide-react'

export type LayoutMode = 'constellation' | 'groups' | 'regions' | 'status' | 'grid' | 'compact'

export interface FleetControlsProps {
  search: string
  setSearch: (v: string) => void
  statusFilter: string | null
  setStatusFilter: (v: string | null) => void
  groupFilter: string | null
  setGroupFilter: (v: string | null) => void
  layout: LayoutMode
  setLayout: (v: LayoutMode) => void
  paused: boolean
  setPaused: (v: boolean) => void
  onReset: () => void
}

const STATUS_OPTIONS = ['online', 'running', 'warning', 'offline', 'booting']
const GROUP_OPTIONS  = ['Group A', 'Group B', 'Group C', 'Group D']
const LAYOUT_OPTIONS: LayoutMode[] = ['constellation', 'groups', 'regions', 'status', 'grid', 'compact']

interface DropdownProps {
  label: string
  value: string | null
  options: string[]
  onSelect: (v: string | null) => void
  icon?: React.ReactNode
}

function Dropdown({ label, value, options, onSelect, icon }: DropdownProps) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={[
          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors',
          value ? 'text-indigo-300 bg-indigo-500/15' : 'text-white/50 hover:text-white/80 hover:bg-white/[0.05]',
        ].join(' ')}
      >
        {icon}
        {value ? value : label}
        <ChevronDown size={11} className="opacity-50" />
      </button>
      {open && (
        <div className="absolute bottom-full mb-1 left-0 z-50 min-w-[130px] rounded-xl bg-[#12121a] border border-white/[0.08] shadow-2xl py-1 backdrop-blur-xl">
          <button
            onClick={() => { onSelect(null); setOpen(false) }}
            className="w-full text-left px-3 py-1.5 text-xs text-white/40 hover:text-white/80 hover:bg-white/[0.04] transition-colors"
          >
            All
          </button>
          {options.map(opt => (
            <button
              key={opt}
              onClick={() => { onSelect(opt); setOpen(false) }}
              className={[
                'w-full text-left px-3 py-1.5 text-xs transition-colors',
                value === opt ? 'text-indigo-300 bg-indigo-500/10' : 'text-white/60 hover:text-white/90 hover:bg-white/[0.04]',
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

export function FleetControls({
  search, setSearch,
  statusFilter, setStatusFilter,
  groupFilter, setGroupFilter,
  layout, setLayout,
  paused, setPaused,
  onReset,
}: FleetControlsProps) {
  return (
    <div className="bg-black/60 backdrop-blur-xl border border-white/[0.08] rounded-2xl px-4 py-2 flex items-center gap-3">
      {/* Search */}
      <div className="relative flex items-center">
        <Search size={12} className="absolute left-2.5 text-white/30 pointer-events-none" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search devices"
          className="pl-7 pr-3 h-7 w-36 rounded-lg bg-white/[0.04] border border-white/[0.06] text-xs text-white/70 placeholder-white/25 outline-none focus:border-white/20 transition-colors"
        />
      </div>

      <div className="w-px h-4 bg-white/[0.08]" />

      {/* Status filter */}
      <Dropdown
        label="Status"
        value={statusFilter}
        options={STATUS_OPTIONS}
        onSelect={setStatusFilter}
        icon={<Filter size={11} />}
      />

      {/* Group filter */}
      <Dropdown
        label="Group"
        value={groupFilter}
        options={GROUP_OPTIONS}
        onSelect={setGroupFilter}
      />

      {/* Layout */}
      <Dropdown
        label="Constellation"
        value={layout === 'constellation' ? null : layout}
        options={LAYOUT_OPTIONS}
        onSelect={v => setLayout((v as LayoutMode) ?? 'constellation')}
        icon={<LayoutGrid size={11} />}
      />

      <div className="w-px h-4 bg-white/[0.08]" />

      {/* Reset */}
      <button
        onClick={onReset}
        title="Reset view"
        className="flex items-center justify-center w-7 h-7 rounded-lg text-white/40 hover:text-white/80 hover:bg-white/[0.06] transition-colors"
      >
        <RotateCcw size={13} />
      </button>

      {/* Fullscreen */}
      <button
        onClick={() => document.documentElement.requestFullscreen?.()}
        title="Fullscreen"
        className="flex items-center justify-center w-7 h-7 rounded-lg text-white/40 hover:text-white/80 hover:bg-white/[0.06] transition-colors"
      >
        <Maximize2 size={13} />
      </button>

      {/* Pause/Play */}
      <button
        onClick={() => setPaused(!paused)}
        title={paused ? 'Resume' : 'Pause'}
        className={[
          'flex items-center justify-center w-7 h-7 rounded-lg transition-colors',
          paused ? 'text-amber-400 bg-amber-500/10' : 'text-white/40 hover:text-white/80 hover:bg-white/[0.06]',
        ].join(' ')}
      >
        {paused ? <Play size={13} /> : <Pause size={13} />}
      </button>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Minus, Plus, X } from 'lucide-react'
import { Counter } from '@/components/ui/counter'
import { Label } from '@/components/ui/label'
import { useFleet, useFleetStats } from '@/hooks/use-fleet'
import { REGIONS, regionLabel, regionRate } from '@/data/regions'
import { client, safe } from '@/lib/provider'
import { formatCost } from '@/lib/format'
import { EXPO_OUT } from '@/lib/motion'
import type { DeviceStatus } from '@/lib/status'
import type { Device } from '@/lib/provider/types'
import { useUIStore } from '@/state/ui-store'

const MAX_FLEET = 80

// Retire spares running work: kill offline/errored first, busy only as last resort.
const RETIRE_RANK: Record<DeviceStatus, number> = {
  offline: 0,
  error: 1,
  warming: 2,
  online: 3,
  busy: 4,
}
function pickRetirees(devices: Device[], n: number): Device[] {
  return [...devices].sort((a, b) => RETIRE_RANK[a.status] - RETIRE_RANK[b.status]).slice(0, n)
}

function Stepper({
  value,
  onChange,
  min = 1,
  max = 20,
}: {
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
}) {
  const step = 'flex h-9 w-9 items-center justify-center text-fg-muted transition-colors hover:bg-elevated hover:text-fg disabled:opacity-40'
  return (
    <div className="flex items-center rounded-control border border-line">
      <button type="button" className={step} disabled={value <= min} onClick={() => onChange(value - 1)} aria-label="Decrease">
        <Minus size={14} />
      </button>
      <div className="mono w-10 text-center text-sm text-fg tabular-nums">{value}</div>
      <button type="button" className={step} disabled={value >= max} onClick={() => onChange(value + 1)} aria-label="Increase">
        <Plus size={14} />
      </button>
    </div>
  )
}

function ActionButton({
  tone,
  icon: Icon,
  label,
  delta,
  disabled,
  onClick,
}: {
  tone: 'provision' | 'retire'
  icon: typeof Plus
  label: string
  delta: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        'group rounded-control border border-line bg-elevated px-4 py-3 text-left transition-colors disabled:pointer-events-none disabled:opacity-40 ' +
        (tone === 'provision' ? 'hover:border-accent/40' : 'hover:border-status-error/40')
      }
    >
      <div
        className={
          'label flex items-center gap-2 ' +
          (tone === 'provision' ? 'text-fg' : 'text-status-error')
        }
      >
        <Icon size={13} /> {label}
      </div>
      <div className="mono mt-1.5 text-[11px] text-fg-muted">{delta}</div>
    </button>
  )
}

function Inner({ onClose }: { onClose: () => void }) {
  const snapshot = useFleet()
  const stats = useFleetStats()
  const [qty, setQty] = useState(4)
  const [region, setRegion] = useState(REGIONS[0].id)

  const count = snapshot.devices.length
  const addable = Math.max(0, Math.min(qty, MAX_FLEET - count))
  const provisionCost = addable * regionRate(region)
  const victims = useMemo(
    () => pickRetirees(snapshot.devices, Math.min(qty, count)),
    [snapshot.devices, qty, count],
  )
  const retireCost = victims.reduce((s, d) => s + regionRate(d.region), 0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const provision = () => {
    if (addable > 0) safe(client.createDevices(addable, { region }), 'Could not provision devices')
  }
  const retire = () => {
    for (const d of victims) safe(client.delete(d.id), 'Could not retire device')
  }

  return (
    // Light backdrop, NO blur → the constellation warps in/out visibly behind.
    <div className="fixed inset-0 z-40 flex items-center justify-center p-6">
      <motion.div
        className="absolute inset-0 bg-black/30"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Scale fleet"
        className="relative w-[440px] max-w-full rounded-card border border-line bg-panel/95 p-6 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.85)] backdrop-blur-sm"
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 6 }}
        transition={{ duration: 0.22, ease: EXPO_OUT }}
      >
        <div className="flex items-center justify-between">
          <Label className="text-fg">Scale Fleet</Label>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-elevated hover:text-fg"
          >
            <X size={15} />
          </button>
        </div>

        {/* capacity */}
        <div className="mt-5 flex items-end justify-between">
          <div className="flex items-baseline gap-2">
            <Counter value={count} className="text-3xl text-fg" />
            <span className="label text-fg-muted">/ MAX {MAX_FLEET}</span>
          </div>
          <div className="mono text-right text-xs text-fg-muted">
            <Counter value={stats.costPerHr} format={formatCost} className="text-accent" />
            /hr
          </div>
        </div>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-elevated">
          <div
            className="h-full rounded-full transition-[width] duration-500 ease-expo-out"
            style={{ width: `${(count / MAX_FLEET) * 100}%`, background: 'var(--accent)' }}
          />
        </div>

        {/* controls */}
        <div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-5">
          <div>
            <Label className="text-fg-muted">Quantity</Label>
            <div className="mt-2">
              <Stepper value={qty} onChange={setQty} />
            </div>
          </div>
          <div className="flex-1">
            <Label className="text-fg-muted">Region</Label>
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="mono mt-2 h-9 w-full rounded-control border border-line bg-elevated px-3 text-[12px] text-fg outline-none focus:border-accent/40"
            >
              {REGIONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {regionLabel(r.id)} · {formatCost(r.ratePerHour)}/hr
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <ActionButton
            tone="provision"
            icon={Plus}
            label="Provision"
            delta={`+${addable} · +${formatCost(provisionCost)}/hr`}
            disabled={addable === 0}
            onClick={provision}
          />
          <ActionButton
            tone="retire"
            icon={Minus}
            label="Retire"
            delta={`−${victims.length} · −${formatCost(retireCost)}/hr`}
            disabled={count === 0}
            onClick={retire}
          />
        </div>

        {count >= MAX_FLEET && (
          <p className="label mt-3 text-status-warming">Fleet at capacity · MAX {MAX_FLEET}</p>
        )}
      </motion.div>
    </div>
  )
}

/** Scale overlay — provision/retire the pool and watch the constellation react. */
export function ScalePanel() {
  const open = useUIStore((s) => s.scaleOpen)
  const close = useUIStore((s) => s.closeScale)
  return <AnimatePresence>{open && <Inner onClose={close} />}</AnimatePresence>
}

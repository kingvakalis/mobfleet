import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Minus, Plus, Upload, UserPlus, Server } from 'lucide-react'
import { useFleet, useFleetStats } from '@/hooks/use-fleet'
import { useNow } from '@/hooks/use-now'
import { REGIONS, regionLabel, regionRate } from '@/data/regions'
import { client, safe } from '@/lib/provider'
import { formatCost } from '@/lib/format'
import { useActingMember } from '@/lib/authorization/use-access'
import { can } from '@/lib/authorization'
import { useToastStore } from '@/state/toast-store'
import { AccessDenied } from '@/components/access/Can'
import { useUIStore } from '@/state/ui-store'
import type { DeviceStatus } from '@/lib/status'
import type { Device } from '@/lib/provider/types'

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

function Stepper({ value, onChange, min = 1, max = 20, disabled }: {
  value: number; onChange: (n: number) => void; min?: number; max?: number; disabled?: boolean
}) {
  const step = 'flex h-9 w-9 items-center justify-center text-fg-muted transition-colors hover:bg-elevated hover:text-fg disabled:opacity-40 disabled:pointer-events-none'
  return (
    <div className="flex items-center rounded-control border border-line">
      <button type="button" className={step} disabled={disabled || value <= min} onClick={() => onChange(value - 1)} aria-label="Decrease">
        <Minus size={14} />
      </button>
      <div className="mono w-12 text-center text-sm text-fg tabular-nums">{value}</div>
      <button type="button" className={step} disabled={disabled || value >= max} onClick={() => onChange(value + 1)} aria-label="Increase">
        <Plus size={14} />
      </button>
    </div>
  )
}

export function ScaleView() {
  const snapshot = useFleet()
  const stats = useFleetStats()
  const now = useNow()
  const member = useActingMember()
  const addToast = useToastStore((s) => s.addToast)
  const openPair = useUIStore((s) => s.openPair)

  // Route is gated on phones.provision OR phones.retire (see VIEW_REQUIRED proposal);
  // the action buttons gate individually so a retire-only user can't provision and vice-versa.
  const canProvision = can(member, 'phones.provision')
  const canRetire = can(member, 'phones.retire')
  // Existing-but-unbacked product surfaces — no endpoint exists yet (see memory:
  // Device.assignedUser is read-only; no device-import endpoint).
  const canAssignEmployee = can(member, 'phones.assign_employee')
  const canImport = can(member, 'phones.import')

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

  const provision = () => {
    if (!canProvision || addable <= 0) return
    safe(client.createDevices(addable, { region }), 'Could not provision devices')
    addToast(`Provisioning ${addable} device${addable === 1 ? '' : 's'} in ${regionLabel(region)}`, 'info')
  }
  const retire = () => {
    if (!canRetire || victims.length === 0) return
    for (const d of victims) safe(client.delete(d.id), 'Could not retire device')
    addToast(`Retiring ${victims.length} device${victims.length === 1 ? '' : 's'}`, 'info')
  }

  if (!canProvision && !canRetire) {
    return <AccessDenied message="You do not have permission to scale the fleet. Requires provision or retire access." />
  }

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-line">
        <div>
          <p className="text-[9px] uppercase tracking-[0.2em] text-white/30 mb-1">Capacity</p>
          <h1 className="text-lg font-bold tracking-widest text-white uppercase">SCALE FLEET</h1>
          <p className="mono text-[10px] text-white/30 tracking-wider mt-0.5">{count} / {MAX_FLEET} UNITS · {formatCost(stats.costPerHr)}/HR</p>
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl px-6 py-8 flex flex-col gap-8">
        {/* Capacity bar */}
        <section className="rounded-card border border-line bg-panel/60 p-6">
          <div className="flex items-end justify-between">
            <div className="flex items-baseline gap-2">
              <span className="mono text-4xl font-bold tabular-nums text-white">{count}</span>
              <span className="text-[10px] uppercase tracking-widest text-white/40">/ MAX {MAX_FLEET}</span>
            </div>
            <div className="mono text-right text-xs text-white/40">
              <span className="text-[var(--accent)]">{formatCost(stats.costPerHr)}</span>/hr
            </div>
          </div>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-elevated">
            <motion.div
              className="h-full rounded-full"
              style={{ background: 'var(--accent)' }}
              animate={{ width: `${(count / MAX_FLEET) * 100}%` }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
          {count >= MAX_FLEET && (
            <p className="mt-3 text-[10px] uppercase tracking-widest text-[var(--status-warming)]">Fleet at capacity · MAX {MAX_FLEET}</p>
          )}
        </section>

        {/* Provision / Retire controls */}
        <section className="rounded-card border border-line bg-panel/60 p-6">
          <div className="flex items-center justify-between gap-4 border-b border-line pb-5">
            <div>
              <p className="text-[9px] uppercase tracking-widest text-white/40 mb-2">Quantity</p>
              <Stepper value={qty} onChange={setQty} />
            </div>
            <div className="flex-1">
              <p className="text-[9px] uppercase tracking-widest text-white/40 mb-2">Region</p>
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="h-9 w-full rounded-control border border-line bg-elevated px-3 text-[12px] text-fg outline-none focus:border-accent/40"
              >
                {REGIONS.map((r) => (
                  <option key={r.id} value={r.id}>{regionLabel(r.id)} · {formatCost(r.ratePerHour)}/hr</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={provision}
              disabled={!canProvision || addable === 0}
              title={canProvision ? 'Provision new cloud devices' : 'Requires provision permission'}
              className="group rounded-control border border-line bg-elevated px-4 py-3 text-left transition-colors enabled:hover:border-accent/40 disabled:pointer-events-none disabled:opacity-40"
            >
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-fg">
                <Plus size={13} /> Provision
              </div>
              <div className="mono mt-1.5 text-[11px] text-fg-muted">+{addable} · +{formatCost(provisionCost)}/hr</div>
            </button>
            <button
              type="button"
              onClick={retire}
              disabled={!canRetire || count === 0}
              title={canRetire ? 'Retire devices (offline/errored first)' : 'Requires retire permission'}
              className="group rounded-control border border-line bg-elevated px-4 py-3 text-left transition-colors enabled:hover:border-[var(--status-error)]/40 disabled:pointer-events-none disabled:opacity-40"
            >
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[var(--status-error)]">
                <Minus size={13} /> Retire
              </div>
              <div className="mono mt-1.5 text-[11px] text-fg-muted">−{victims.length} · −{formatCost(retireCost)}/hr</div>
            </button>
          </div>

          {/* Pairing — provisioning a real device via QR (this DOES have a backend). */}
          <button
            type="button"
            onClick={openPair}
            disabled={!canProvision}
            title={canProvision ? 'Pair a physical device via QR code' : 'Requires provision permission'}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-control border border-line px-4 py-2.5 text-[10px] uppercase tracking-widest text-white/70 transition-colors enabled:hover:border-white/40 enabled:hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Server size={12} /> Pair a physical device
          </button>
        </section>

        {/* Truthful disabled product surfaces — no backend endpoint exists yet. */}
        <section className="rounded-card border border-dashed border-line bg-panel/30 p-6">
          <p className="text-[9px] uppercase tracking-[0.2em] text-white/25 mb-4">Not yet available</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-control border border-line bg-elevated/40 px-4 py-3 opacity-60">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/40">
                <Upload size={13} /> Bulk import devices
              </div>
              <p className="mt-1.5 text-[10px] leading-relaxed text-white/30">
                {canImport
                  ? 'No device-import endpoint exists on the backend yet. This action is disabled until it ships.'
                  : 'Requires import permission — and no device-import endpoint exists on the backend yet.'}
              </p>
            </div>
            <div className="rounded-control border border-line bg-elevated/40 px-4 py-3 opacity-60">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/40">
                <UserPlus size={13} /> Assign operator
              </div>
              <p className="mt-1.5 text-[10px] leading-relaxed text-white/30">
                {canAssignEmployee
                  ? 'Device→operator assignment is read-only today (no assignment endpoint). Disabled until it ships.'
                  : 'Requires assign-operator permission — and no assignment endpoint exists on the backend yet.'}
              </p>
            </div>
          </div>
          <p className="mono mt-4 text-[9px] tracking-wider text-white/20">Last fleet update {Math.max(0, Math.round((now - snapshot.ts) / 1000))}s ago</p>
        </section>
      </div>
    </div>
  )
}

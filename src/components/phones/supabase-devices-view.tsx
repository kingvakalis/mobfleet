import { useMemo, useState, type FormEvent } from 'react'
import { Plus, Trash2, Wifi, RefreshCw, Cpu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { STATUS } from '@/lib/status'
import { useDevices } from '@/hooks/useDevices'
import { useTeamContext } from '@/contexts/TeamContext'
import type { DeviceRow, DeviceStatusEnum } from '@/lib/database.types'

const STATUS_ORDER: DeviceStatusEnum[] = ['online', 'busy', 'warming', 'offline', 'error']

function relTime(iso: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

function StatusPill({ status }: { status: DeviceStatusEnum }) {
  const meta = STATUS[status]
  return (
    <span className="mono inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wider"
      style={{ color: meta.color, background: `color-mix(in srgb, ${meta.color} 12%, transparent)` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
      {meta.label}
    </span>
  )
}

function DeviceCard({ device, canWrite, onStatus, onDelete }: {
  device: DeviceRow
  canWrite: boolean
  onStatus: (id: string, s: DeviceStatusEnum) => void
  onDelete: (id: string) => void
}) {
  const color = STATUS[device.status].color
  return (
    <div className="card-surface relative flex flex-col gap-3 rounded-card border border-line p-4" style={{ borderTop: `2px solid ${color}` }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-fg">{device.name}</div>
          <div className="mono mt-0.5 truncate text-[10px] text-fg-muted">{device.udid ?? 'no udid'}</div>
        </div>
        <StatusPill status={device.status} />
      </div>

      <div className="mono grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px] text-white/55">
        <span className="flex items-center gap-1.5"><Cpu size={11} className="text-white/30" /> {device.platform}{device.os_version ? ` · ${device.os_version}` : ''}</span>
        <span className="flex items-center gap-1.5"><Wifi size={11} className="text-white/30" /> {device.ip_address ?? '—'}{device.wda_port ? `:${device.wda_port}` : ''}</span>
        <span className="flex items-center gap-1.5 col-span-2"><RefreshCw size={11} className="text-white/30" /> heartbeat {relTime(device.last_heartbeat)}</span>
      </div>

      {canWrite && (
        <div className="mt-1 flex items-center gap-2 border-t border-line pt-3">
          <select
            aria-label={`Set status for ${device.name}`}
            value={device.status}
            onChange={(e) => onStatus(device.id, e.target.value as DeviceStatusEnum)}
            className="mono h-7 flex-1 rounded-control border border-line bg-elevated px-2 text-[10px] uppercase tracking-wider text-fg-secondary outline-none focus:border-[var(--accent-border)]"
          >
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
          </select>
          <button
            type="button"
            onClick={() => onDelete(device.id)}
            aria-label={`Delete ${device.name}`}
            className="flex h-7 w-7 items-center justify-center rounded-control border border-line text-white/40 transition-colors hover:border-[rgba(255,59,59,0.4)] hover:text-[#ff3b3b]"
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  )
}

/** Live device grid backed by Supabase (real status, realtime updates). Used in
 *  place of the mock fleet when Supabase is configured + a team is loaded. */
export function SupabaseDevicesView() {
  const { team, role } = useTeamContext()
  const { devices, loading, error, addDevice, updateStatus, deleteDevice } = useDevices(team?.id ?? null)
  const canWrite = role === 'owner' || role === 'admin' || role === 'operator'

  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const counts = useMemo(() => {
    const c = { online: 0, busy: 0, warming: 0, offline: 0, error: 0 } as Record<DeviceStatusEnum, number>
    for (const d of devices) c[d.status]++
    return c
  }, [devices])

  const submitAdd = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    const { error: err } = await addDevice({ name: name.trim() })
    setBusy(false)
    if (!err) { setName(''); setAdding(false) }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4">
        <div className="flex items-center gap-4">
          <div>
            <p className="mono mb-0.5 text-[9px] uppercase tracking-[0.2em] text-white/30">{team?.name ?? 'Workspace'} · Live</p>
            <Label className="text-fg">Devices</Label>
          </div>
          <div className="mono flex items-center gap-3 text-[10px]">
            {STATUS_ORDER.map((s) => (
              <span key={s} className="flex items-center gap-1.5" style={{ color: STATUS[s].color }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS[s].color }} />
                {counts[s]}
              </span>
            ))}
          </div>
        </div>
        {canWrite && !adding && (
          <Button variant="primary" size="sm" onClick={() => setAdding(true)}><Plus size={14} /> Add device</Button>
        )}
        {canWrite && adding && (
          <form onSubmit={submitAdd} className="flex items-center gap-2">
            <input
              autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Device name"
              className="mono h-8 w-44 rounded-control border border-line bg-elevated px-2.5 text-[12px] text-fg outline-none focus:border-[var(--accent-border)]"
            />
            <Button type="submit" variant="primary" size="sm" disabled={busy}>{busy ? '…' : 'Add'}</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => { setAdding(false); setName('') }}>Cancel</Button>
          </form>
        )}
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {error && <div role="alert" className="mb-4 rounded-control border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">{error}</div>}
        {loading ? (
          <div className="flex h-full items-center justify-center"><Spinner size={22} /></div>
        ) : devices.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Label className="text-fg-secondary">No devices yet</Label>
            <p className="mono max-w-[280px] text-[11px] leading-relaxed text-fg-muted">This team has no registered devices. Add one to start tracking live status.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {devices.map((d) => (
              <DeviceCard key={d.id} device={d} canWrite={canWrite} onStatus={updateStatus} onDelete={deleteDevice} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

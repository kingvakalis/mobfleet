import { useState, type ComponentType } from 'react'
import { Check, Copy, Play, ScrollText, Send, Square, Trash2 } from 'lucide-react'
import { regionLabel } from '@/data/regions'
import { client } from '@/lib/provider'
import { useUIStore } from '@/state/ui-store'
import { uptimeSince } from '@/lib/format'
import { STATUS } from '@/lib/status'
import type { Device, Job } from '@/lib/provider/types'
import { cn } from '@/lib/utils'

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-[3px]">
      <span className="label text-fg-muted">{label}</span>
      <span
        className="mono max-w-[160px] truncate text-[11px] text-fg-secondary"
        style={color ? { color } : undefined}
      >
        {value}
      </span>
    </div>
  )
}

function Action({
  icon: Icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: ComponentType<{ size?: number }>
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'label nodrag flex items-center gap-1.5 rounded-control border border-line px-2 py-1.5 transition-colors disabled:pointer-events-none disabled:opacity-40',
        danger
          ? 'text-status-error hover:border-status-error/40 hover:bg-status-error/10'
          : 'text-fg-secondary hover:bg-elevated hover:text-fg',
      )}
    >
      <Icon size={12} />
      {label}
    </button>
  )
}

/** Vercel-clean telemetry panel shown for the SELECTED node. */
export function TelemetryCard({ device, job, noMatch }: { device: Device; job?: Job | null; noMatch?: boolean }) {
  const [copied, setCopied] = useState(false)
  const openDrawer = useUIStore((s) => s.openDrawer)
  const meta = STATUS[device.status]
  const canStart = device.status === 'offline' || device.status === 'error'
  const idle = device.status === 'online'

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(device.id)
    } catch {
      /* clipboard may be blocked — ignore */
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div
      className="nodrag w-[280px] cursor-default rounded-card border border-line bg-panel p-4 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.85)]"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: meta.color, boxShadow: `0 0 6px ${meta.color}` }}
        />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-fg">{device.name}</div>
          <div className="mono truncate text-[10px] text-fg-muted">{device.id}</div>
        </div>
      </div>

      {noMatch && (
        <div className="mono mt-2 rounded-control border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[10px] text-amber-400">
          Does not match current filters
        </div>
      )}

      <div className="mt-3 border-t border-line pt-2">
        <Row label="Status" value={meta.label} color={meta.color} />
        <Row label="Group" value={device.group} />
        <Row label="Model" value={`${device.model} · ${device.osVersion}`} />
        <Row label="Region" value={regionLabel(device.region)} />
        <Row label="Battery" value={`${device.battery}%`} />
        <Row
          label="Job"
          value={job ? `${job.type.toUpperCase()} · ${Math.round(job.progress * 100)}%` : '—'}
        />
        <Row label="Operator" value={device.assignedUser ?? 'Unassigned'} />
        <Row label="Uptime" value={uptimeSince(device.createdAt)} />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
        {canStart ? (
          <Action icon={Play} label="Start" onClick={() => void client.start(device.id)} />
        ) : (
          <Action icon={Square} label="Stop" onClick={() => void client.stop(device.id)} />
        )}
        <Action
          icon={Send}
          label="Assign"
          disabled={!idle}
          onClick={() => void client.runTask(device.id, { type: 'upload', label: 'Manual upload' })}
        />
        <Action icon={ScrollText} label="Logs" onClick={() => openDrawer(device.id)} />
        <Action
          icon={copied ? Check : Copy}
          label={copied ? 'Copied' : 'Copy ID'}
          onClick={copyId}
        />
        <Action icon={Trash2} label="Retire" danger onClick={() => void client.delete(device.id)} />
      </div>
    </div>
  )
}

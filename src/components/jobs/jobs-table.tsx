import { RotateCw, Copy } from 'lucide-react'
import { useMemo } from 'react'
import { client } from '@/lib/provider'
import { useFleet } from '@/hooks/use-fleet'
import { useUIStore } from '@/state/ui-store'
import { formatDuration, formatRelative } from '@/lib/format'
import type { Job, TaskType } from '@/lib/provider/types'
import { JobStatusPill } from './job-status-pill'

/** Operators read task names, not raw IDs — IDs stay one click away (copy). */
const TASK_LABEL: Record<TaskType, string> = {
  warmup: 'Account Warmup',
  upload: 'Content Upload',
  engage: 'Account Check',
  post:   'App Install Flow',
}

function duration(job: Job): string {
  if (job.status === 'queued') return '—'
  if (!job.startedAt) return '—'
  const end = job.finishedAt ?? Date.now()
  return formatDuration(end - job.startedAt)
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={`label px-4 py-2.5 font-normal text-fg-muted ${className ?? ''}`}>{children}</th>
  )
}

function Progress({ job }: { job: Job }) {
  const pct = Math.round(job.progress * 100)
  const color =
    job.status === 'failed' ? 'var(--status-error)'
    : job.status === 'succeeded' ? 'var(--status-online)'
    : 'var(--status-busy)'
  if (job.status === 'queued') return <span className="mono text-[11px] text-fg-muted">queued</span>
  return (
    <span className="flex items-center gap-2">
      <span className="h-1 w-16 overflow-hidden rounded-full bg-white/[0.08]">
        <span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: color }} />
      </span>
      <span className="mono text-[10px] tabular-nums text-fg-muted">{pct}%</span>
    </span>
  )
}

function JobRow({ job, deviceName }: { job: Job; deviceName: string | null }) {
  const openDrawer = useUIStore((s) => s.openDrawer)
  return (
    <tr className="border-b border-line transition-colors hover:bg-panel">
      <td className="px-4 py-2.5">
        <JobStatusPill status={job.status} />
      </td>
      <td className="px-4 py-2.5">
        <span className="flex items-center gap-2">
          <span className="text-[12px] text-fg">{TASK_LABEL[job.type] ?? job.type}</span>
          <button
            type="button"
            title={`Copy job ID (${job.id})`}
            onClick={() => void navigator.clipboard?.writeText(job.id)}
            className="text-fg-muted/50 transition-colors hover:text-fg-secondary"
          >
            <Copy size={10} />
          </button>
        </span>
        {job.error && <div className="mt-0.5 text-[10px] text-status-error">{job.error}</div>}
      </td>
      <td className="px-4 py-2.5">
        {job.deviceId ? (
          <button
            type="button"
            onClick={() => openDrawer(job.deviceId!)}
            className="mono text-[12px] text-fg-secondary transition-colors hover:text-[var(--accent-text)]"
          >
            {deviceName ?? job.deviceId.slice(-6)}
          </button>
        ) : (
          <span className="mono text-[12px] text-fg-muted">unassigned</span>
        )}
      </td>
      <td className="px-4 py-2.5"><Progress job={job} /></td>
      <td className="mono px-4 py-2.5 text-[12px] tabular-nums text-fg-secondary">{duration(job)}</td>
      <td className="mono px-4 py-2.5 text-[12px] text-fg-muted">{formatRelative(job.createdAt)}</td>
      <td className="px-4 py-2.5 text-right">
        {job.status === 'failed' && (
          <button
            type="button"
            onClick={() => void client.retryJob(job.id)}
            className="label inline-flex items-center gap-1.5 rounded-control border border-line px-2 py-1 text-fg-secondary transition-colors hover:bg-elevated hover:text-fg"
          >
            <RotateCw size={11} /> Retry
          </button>
        )}
      </td>
    </tr>
  )
}

export function JobsTable({ jobs }: { jobs: Job[] }) {
  const snapshot = useFleet()
  const nameById = useMemo(
    () => new Map(snapshot.devices.map((d) => [d.id, d.name])),
    [snapshot.devices],
  )
  return (
    <table className="w-full border-collapse text-left">
      <thead className="sticky top-0 z-10 bg-canvas">
        <tr className="border-b border-line">
          <Th>Status</Th>
          <Th>Job</Th>
          <Th>Phone</Th>
          <Th>Progress</Th>
          <Th>Duration</Th>
          <Th>Age</Th>
          <Th className="text-right" />
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => (
          <JobRow key={job.id} job={job} deviceName={job.deviceId ? nameById.get(job.deviceId) ?? null : null} />
        ))}
      </tbody>
    </table>
  )
}

import { RotateCw } from 'lucide-react'
import { client } from '@/lib/provider'
import { useUIStore } from '@/state/ui-store'
import { formatDuration, formatRelative } from '@/lib/format'
import type { Job } from '@/lib/provider/types'
import { JobStatusPill } from './job-status-pill'

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

function JobRow({ job }: { job: Job }) {
  const openDrawer = useUIStore((s) => s.openDrawer)
  return (
    <tr className="border-b border-line transition-colors hover:bg-panel">
      <td className="px-4 py-2.5">
        <JobStatusPill status={job.status} />
      </td>
      <td className="mono px-4 py-2.5 text-[12px] text-fg-secondary">{job.id}</td>
      <td className="label px-4 py-2.5 text-fg-secondary">{job.type.toUpperCase()}</td>
      <td className="px-4 py-2.5">
        {job.deviceId ? (
          <button
            type="button"
            onClick={() => openDrawer(job.deviceId!)}
            className="mono text-[12px] text-fg-secondary transition-colors hover:text-accent"
          >
            {job.deviceId.slice(-6)}
          </button>
        ) : (
          <span className="mono text-[12px] text-fg-muted">—</span>
        )}
      </td>
      <td className="mono px-4 py-2.5 text-[12px] text-fg-secondary tabular-nums">{duration(job)}</td>
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
  return (
    <table className="w-full border-collapse text-left">
      <thead className="sticky top-0 z-10 bg-canvas">
        <tr className="border-b border-line">
          <Th>Status</Th>
          <Th>Job</Th>
          <Th>Type</Th>
          <Th>Device</Th>
          <Th>Duration</Th>
          <Th>Age</Th>
          <Th className="text-right" />
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => (
          <JobRow key={job.id} job={job} />
        ))}
      </tbody>
    </table>
  )
}

import type { JobStatus } from '@/lib/provider/types'

const META: Record<JobStatus, { label: string; color: string }> = {
  queued: { label: 'QUEUED', color: 'var(--status-warming)' },
  running: { label: 'RUNNING', color: 'var(--status-busy)' },
  succeeded: { label: 'SUCCEEDED', color: 'var(--status-online)' },
  failed: { label: 'FAILED', color: 'var(--status-error)' },
}

export function JobStatusPill({ status }: { status: JobStatus }) {
  const m = META[status]
  return (
    <span
      className="label inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-elevated px-2.5 py-1"
      style={{ color: m.color }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: m.color, boxShadow: `0 0 5px ${m.color}` }}
      />
      {m.label}
    </span>
  )
}

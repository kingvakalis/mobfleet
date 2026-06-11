import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useFleet } from '@/hooks/use-fleet'
import { useUIStore } from '@/state/ui-store'
import type { Job, JobStatus } from '@/lib/provider/types'
import { cn } from '@/lib/utils'
import { JobsTable } from './jobs-table'
import { SubmitJobDialog } from './submit-job-dialog'

type Filter = 'all' | 'active' | 'done' | 'failed'

const FILTERS: { id: Filter; label: string; match: (s: JobStatus) => boolean }[] = [
  { id: 'all', label: 'ALL', match: () => true },
  { id: 'active', label: 'ACTIVE', match: (s) => s === 'running' || s === 'queued' },
  { id: 'done', label: 'DONE', match: (s) => s === 'succeeded' },
  { id: 'failed', label: 'FAILED', match: (s) => s === 'failed' },
]

// Active first (running, then queued), then history newest-first.
const RANK: Record<JobStatus, number> = { running: 0, queued: 1, succeeded: 2, failed: 2 }
function sortJobs(a: Job, b: Job): number {
  if (RANK[a.status] !== RANK[b.status]) return RANK[a.status] - RANK[b.status]
  const at = a.finishedAt ?? a.startedAt ?? a.createdAt
  const bt = b.finishedAt ?? b.startedAt ?? b.createdAt
  return bt - at
}

function FilterTabs({
  value,
  onChange,
  counts,
}: {
  value: Filter
  onChange: (f: Filter) => void
  counts: Record<Filter, number>
}) {
  return (
    <div className="flex items-center gap-1 rounded-control border border-line bg-panel p-1">
      {FILTERS.map((f) => (
        <button
          key={f.id}
          type="button"
          onClick={() => onChange(f.id)}
          className={cn(
            'label flex items-center gap-1.5 rounded-[4px] px-2.5 py-1.5 transition-colors',
            value === f.id ? 'bg-elevated text-fg' : 'text-fg-muted hover:text-fg-secondary',
          )}
        >
          {f.label}
          <span className="mono text-[10px] text-fg-muted">{counts[f.id]}</span>
        </button>
      ))}
    </div>
  )
}

export function JobsView() {
  const snapshot = useFleet()
  const [filter, setFilter] = useState<Filter>('all')
  const dialogOpen = useUIStore((s) => s.submitOpen)
  const openSubmit = useUIStore((s) => s.openSubmit)
  const closeSubmit = useUIStore((s) => s.closeSubmit)

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, active: 0, done: 0, failed: 0 }
    for (const j of snapshot.jobs) {
      for (const f of FILTERS) if (f.match(j.status)) c[f.id]++
    }
    return c
  }, [snapshot.jobs])

  const rows = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter)!
    return snapshot.jobs.filter((j) => f.match(j.status)).sort(sortJobs)
  }, [snapshot.jobs, filter])

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-6 py-4">
        <div className="flex items-center gap-4">
          <Label className="text-fg">Job Pipeline</Label>
          <FilterTabs value={filter} onChange={setFilter} counts={counts} />
        </div>
        <Button variant="primary" size="sm" onClick={openSubmit}>
          <Plus size={14} /> Dispatch Job
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!snapshot.ready ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rows.length > 0 ? (
          <JobsTable jobs={rows} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <Label className="text-fg-muted">No {filter === 'all' ? '' : filter} jobs</Label>
            <Button variant="outline" size="sm" onClick={openSubmit}>
              <Plus size={14} /> Dispatch one
            </Button>
          </div>
        )}
      </div>

      <SubmitJobDialog open={dialogOpen} onClose={closeSubmit} />
    </div>
  )
}

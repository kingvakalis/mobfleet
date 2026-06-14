import { useMemo, useState, type FormEvent } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { useJobs } from '@/hooks/useJobs'
import { useDevices } from '@/hooks/useDevices'
import { useTeamContext } from '@/contexts/TeamContext'
import type { AutomationJobRow, JobStatusEnum } from '@/lib/database.types'

const JOB_COLOR: Record<JobStatusEnum, string> = {
  queued: 'var(--status-warming)',
  running: 'var(--status-busy)',
  succeeded: 'var(--status-online)',
  failed: 'var(--status-error)',
  cancelled: 'var(--status-offline)',
}
const JOB_STATUSES: JobStatusEnum[] = ['queued', 'running', 'succeeded', 'failed', 'cancelled']
const JOB_TYPES = ['upload', 'warmup', 'engage', 'post', 'account-check']

type Filter = 'all' | 'active' | 'done' | 'failed'
const FILTERS: { id: Filter; label: string; match: (s: JobStatusEnum) => boolean }[] = [
  { id: 'all', label: 'ALL', match: () => true },
  { id: 'active', label: 'ACTIVE', match: (s) => s === 'running' || s === 'queued' },
  { id: 'done', label: 'DONE', match: (s) => s === 'succeeded' },
  { id: 'failed', label: 'FAILED', match: (s) => s === 'failed' || s === 'cancelled' },
]

function relTime(iso: string | null): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

/** Live automation-jobs pipeline backed by Supabase. */
export function SupabaseJobsView() {
  const { team, role } = useTeamContext()
  const teamId = team?.id ?? null
  const { jobs, loading, error, createJob, updateStatus, deleteJob } = useJobs(teamId)
  const { devices } = useDevices(teamId)
  const canWrite = role === 'owner' || role === 'admin' || role === 'operator'

  const [filter, setFilter] = useState<Filter>('all')
  const [adding, setAdding] = useState(false)
  const [type, setType] = useState(JOB_TYPES[0])
  const [deviceId, setDeviceId] = useState<string>('')
  const [busy, setBusy] = useState(false)

  const deviceName = useMemo(() => new Map(devices.map((d) => [d.id, d.name])), [devices])
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, active: 0, done: 0, failed: 0 }
    for (const j of jobs) for (const f of FILTERS) if (f.match(j.status)) c[f.id]++
    return c
  }, [jobs])
  const rows = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter)!
    return jobs.filter((j) => f.match(j.status))
  }, [jobs, filter])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const { error: err } = await createJob({ type, device_id: deviceId || null })
    setBusy(false)
    if (!err) { setAdding(false); setDeviceId('') }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4">
        <div className="flex items-center gap-4">
          <Label className="text-fg">Job Pipeline</Label>
          <div className="flex items-center gap-1 rounded-control border border-line bg-panel p-1">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" onClick={() => setFilter(f.id)}
                className={['label flex items-center gap-1.5 rounded-[4px] px-2.5 py-1.5 transition-colors',
                  filter === f.id ? 'bg-elevated text-fg' : 'text-fg-muted hover:text-fg-secondary'].join(' ')}>
                {f.label}<span className="mono text-[10px] text-fg-muted">{counts[f.id]}</span>
              </button>
            ))}
          </div>
        </div>
        {canWrite && !adding && <Button variant="primary" size="sm" onClick={() => setAdding(true)}><Plus size={14} /> Dispatch job</Button>}
        {canWrite && adding && (
          <form onSubmit={submit} className="flex items-center gap-2">
            <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Job type"
              className="mono h-8 rounded-control border border-line bg-elevated px-2 text-[11px] text-fg-secondary outline-none focus:border-[var(--accent-border)]">
              {JOB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} aria-label="Target device"
              className="mono h-8 rounded-control border border-line bg-elevated px-2 text-[11px] text-fg-secondary outline-none focus:border-[var(--accent-border)]">
              <option value="">Unassigned</option>
              {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <Button type="submit" variant="primary" size="sm" disabled={busy}>{busy ? '…' : 'Dispatch'}</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
          </form>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && <div role="alert" className="m-4 rounded-control border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">{error}</div>}
        {loading ? (
          <div className="flex h-full items-center justify-center"><Spinner size={22} /></div>
        ) : rows.length === 0 ? (
          <div className="flex h-full items-center justify-center"><Label className="text-fg-muted">No {filter === 'all' ? '' : filter} jobs</Label></div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-black">
              <tr className="border-b border-line">
                {['TYPE', 'DEVICE', 'STATUS', 'STARTED', 'FINISHED', ''].map((h) => (
                  <th key={h || 'x'} scope="col" className="mono px-4 py-3 text-left text-[9px] font-medium uppercase tracking-[0.1em] text-white/25">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((j: AutomationJobRow) => (
                <tr key={j.id} className="border-b border-white/[0.04] hover:bg-hover">
                  <td className="mono px-4 py-3 text-[12px] text-fg">{j.type}</td>
                  <td className="mono px-4 py-3 text-[11px] text-white/55">{j.device_id ? deviceName.get(j.device_id) ?? j.device_id.slice(0, 8) : '—'}</td>
                  <td className="px-4 py-3">
                    {canWrite ? (
                      <select value={j.status} onChange={(e) => updateStatus(j.id, e.target.value as JobStatusEnum)} aria-label="Job status"
                        className="mono h-7 rounded-control border border-line bg-elevated px-2 text-[10px] uppercase tracking-wider outline-none focus:border-[var(--accent-border)]"
                        style={{ color: JOB_COLOR[j.status] }}>
                        {JOB_STATUSES.map((s) => <option key={s} value={s} style={{ color: 'var(--text)' }}>{s}</option>)}
                      </select>
                    ) : (
                      <span className="mono text-[10px] uppercase tracking-wider" style={{ color: JOB_COLOR[j.status] }}>{j.status}</span>
                    )}
                    {j.error && <span className="mono ml-2 text-[10px] text-[var(--status-error)]">{j.error}</span>}
                  </td>
                  <td className="mono px-4 py-3 text-[10px] text-white/30">{relTime(j.started_at)}</td>
                  <td className="mono px-4 py-3 text-[10px] text-white/30">{relTime(j.finished_at)}</td>
                  <td className="px-4 py-3 text-right">
                    {canWrite && (
                      <button type="button" onClick={() => deleteJob(j.id)} aria-label="Delete job"
                        className="text-white/30 transition-colors hover:text-[#ff3b3b]"><Trash2 size={13} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

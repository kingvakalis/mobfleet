import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Search, Clock, Pause, Play, ShieldAlert, Activity as ActivityIcon, Download, Lock } from 'lucide-react'
import { useActivityFeed, type ActivityEvent } from '@/components/fleet/fleet-activity'
import { useAudit, AUDIT_LABEL, type AuditEvent } from '@/services/audit'
import { useAuthz } from '@/contexts/AuthzContext'
import { fetchActivity, ApiError, type ActivityItem } from '@/services/activity'
import { usePermission } from '@/lib/authorization/use-access'
import { fadeIn, staggerContainer } from '@/lib/motion'
import { useTeamContext } from '@/contexts/TeamContext'
import { useActivityEvents } from '@/hooks/useActivityEvents'
import { AUTH_SOURCE } from '@/auth/auth-source'
import { isSupabaseConfigured } from '@/lib/supabase'
import type { ActivityCategory, ActivityEventRow } from '@/lib/database.types'

const SUPABASE_MODE = AUTH_SOURCE === 'supabase' && isSupabaseConfigured

/**
 * Activity — plain-language operational events (was "Logs").
 * Raw developer logs stay out of the operator interface; per-device technical
 * streams live in the device drawer's Live Log.
 *
 * The Security Audit tab surfaces the append-only authorization log (role /
 * permission / scope / sensitive-reveal / ownership events). It is only
 * available to members with the `activity.view_security` permission.
 */

const levelStyle: Record<ActivityEvent['level'], string> = {
  INFO:  'text-white/45',
  WARN:  'text-amber-400',
  ERROR: 'text-red-400',
  OK:    'text-emerald-400',
}
const levelBg: Record<ActivityEvent['level'], string> = {
  INFO:  'bg-white/[0.04] text-white/40',
  WARN:  'bg-amber-400/10 text-amber-400',
  ERROR: 'bg-red-400/10 text-red-400',
  OK:    'bg-emerald-400/10 text-emerald-400',
}

const RESULT_FILTERS: ('ALL' | ActivityEvent['level'])[] = ['ALL', 'OK', 'INFO', 'WARN', 'ERROR']

/** Pure epoch→clock formatter (deterministic; safe in render). */
function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ─── Security audit tab — authoritative source dispatcher ─────────────────────
// In the authoritative "me" path the audit trail is the server's append-only
// AuditLog (GET /v1/activity). In demo / supabase-mode there is no Prisma-keyed
// backend for it, so the session-scoped local store is shown instead.
function SecurityAudit({ canExport }: { canExport: boolean }) {
  const { active } = useAuthz()
  return active ? <BackendSecurityAudit canExport={canExport} /> : <LocalSecurityAudit canExport={canExport} />
}

/** Humanize a backend dotted action name (e.g. `role.change` → `Role change`). */
function humanizeAction(action: string): string {
  const s = action.replace(/[._]/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Pure epoch→date+clock for the persisted audit trail (rows span days, not one session). */
function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString('en-US', { hour12: false, month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ─── Backend security audit (GET /v1/activity) ────────────────────────────────
function BackendSecurityAudit({ canExport }: { canExport: boolean }) {
  const { teamEpoch } = useAuthz()
  const [items, setItems] = useState<ActivityItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<{ status: number | null; message: string } | null>(null)
  const [search, setSearch] = useState('')
  const [result, setResult] = useState<'ALL' | 'allowed' | 'denied'>('ALL')

  const actorOf = (e: ActivityItem) => e.actorName ?? e.actorEmail ?? e.actorId

  // Reload the first page on mount AND whenever the active team changes (teamEpoch),
  // so a team switch drops the previous team's rows and reloads — never cross-tenant.
  const loadFirst = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const page = await fetchActivity({ limit: 50 })
      setItems(page.items); setNextCursor(page.nextCursor)
    } catch (e) {
      setItems([]); setNextCursor(null)
      setError({
        status: e instanceof ApiError ? e.status : null,
        message: e instanceof ApiError && e.status === 403
          ? 'You do not have permission to view the security audit log.'
          : 'Could not load the activity log. Please try again.',
      })
    } finally {
      setLoading(false)
    }
  }, [])

  // Async data-load effect — the loading flag it sets is the intended pattern.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadFirst() }, [loadFirst, teamEpoch])

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await fetchActivity({ cursor: nextCursor, limit: 50 })
      setItems((cur) => [...cur, ...page.items]); setNextCursor(page.nextCursor)
    } catch {
      setError({ status: null, message: 'Could not load more activity.' })
    } finally {
      setLoadingMore(false)
    }
  }

  const visible = useMemo(
    () => items.filter((e) =>
      (result === 'ALL' || e.result === result) &&
      (search === '' ||
        actorOf(e).toLowerCase().includes(search.toLowerCase()) ||
        e.action.toLowerCase().includes(search.toLowerCase()) ||
        (e.target ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (e.detail ?? '').toLowerCase().includes(search.toLowerCase())),
    ),
    [items, search, result],
  )

  const exportCsv = () => {
    if (!canExport) return
    const header = 'time,actor,action,target,detail,result'
    const rows = visible.map((e) =>
      [fmtDateTime(e.createdAt), actorOf(e), e.action, e.target ?? '', (e.detail ?? '').replace(/,/g, ';'), e.result].join(','),
    )
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'mobfleet-audit-log.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-3">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search loaded events..."
            className="h-8 w-64 rounded-lg border border-line bg-white/[0.03] pl-8 pr-3 text-xs text-white/80 placeholder-white/25 outline-none transition-colors focus:border-[var(--accent-border)]"
          />
        </div>
        <div className="flex gap-1">
          {(['ALL', 'allowed', 'denied'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setResult(f)}
              className={[
                'rounded-md px-3 py-1 text-xs capitalize transition-colors',
                result === f ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]' : 'text-white/35 hover:text-white/60',
              ].join(' ')}
            >
              {f}
            </button>
          ))}
        </div>
        <button
          onClick={exportCsv}
          disabled={!canExport || visible.length === 0}
          title={canExport ? 'Export the loaded audit rows as CSV' : 'Requires export-activity permission'}
          className="mono ml-auto flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[10px] uppercase tracking-widest text-white/50 transition-colors enabled:hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Download size={11} /> Export
        </button>
      </div>

      <div className="flex-1 overflow-auto px-4 py-2">
        <div className="flex items-center gap-3 px-3 py-1.5 text-[9px] font-medium uppercase tracking-wider text-white/20">
          <span className="w-36 shrink-0">Time</span>
          <span className="w-16 shrink-0">Result</span>
          <span className="w-44 shrink-0">Actor</span>
          <span className="w-44 shrink-0">Action</span>
          <span className="flex-1">Target / Detail</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <span className="mono text-[10px] uppercase tracking-widest text-white/25">Loading activity…</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <ShieldAlert size={18} className="text-red-400/60" />
            <span className="text-[12px] text-white/55">{error.message}</span>
            {error.status !== 403 && (
              <button onClick={() => void loadFirst()} className="mono rounded-md border border-line px-3 py-1 text-[10px] uppercase tracking-widest text-white/50 hover:text-white/80">
                Retry
              </button>
            )}
          </div>
        ) : (
          <>
            <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-0.5 font-mono text-[11px]">
              {visible.map((e) => (
                <motion.div key={e.id} variants={fadeIn} className="flex items-center gap-3 rounded-md px-3 py-1.5 transition-colors hover:bg-white/[0.02]">
                  <span className="w-36 shrink-0 tabular-nums text-white/25">{fmtDateTime(e.createdAt)}</span>
                  <span className={[
                    'w-16 shrink-0 rounded px-1.5 py-0.5 text-center text-[9px] font-semibold',
                    e.result === 'denied' ? 'bg-red-400/10 text-red-400' : 'bg-emerald-400/10 text-emerald-400',
                  ].join(' ')}>
                    {e.result === 'denied' ? 'DENIED' : 'OK'}
                  </span>
                  <span className="w-44 shrink-0 truncate text-white/55" title={e.actorEmail ?? e.actorId}>{actorOf(e)}</span>
                  <span className="w-44 shrink-0 truncate font-medium text-white/70" title={e.action}>{humanizeAction(e.action)}</span>
                  <span className="flex-1 truncate text-white/40">
                    {e.target}{e.detail ? <span className="text-white/25"> · {e.detail}</span> : null}
                  </span>
                </motion.div>
              ))}
            </motion.div>

            {visible.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16">
                <ShieldAlert size={18} className="mb-2 text-white/15" />
                <span className="mono text-[10px] uppercase tracking-widest text-white/25">
                  {items.length === 0 ? 'No security events recorded yet' : 'No events match the current filters'}
                </span>
              </div>
            )}

            {nextCursor && (
              <div className="flex justify-center py-4">
                <button
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className="mono rounded-md border border-line px-4 py-1.5 text-[10px] uppercase tracking-widest text-white/50 transition-colors hover:text-white/80 disabled:opacity-40"
                >
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}

// ─── Local (demo / supabase-mode) security audit — session-scoped store ────────
function LocalSecurityAudit({ canExport }: { canExport: boolean }) {
  const events = useAudit((s) => s.events)
  const [search, setSearch] = useState('')
  const [result, setResult] = useState<'ALL' | 'success' | 'denied'>('ALL')

  const visible = useMemo(
    () => events.filter((e) =>
      (result === 'ALL' || e.result === result) &&
      (search === '' ||
        e.actor.toLowerCase().includes(search.toLowerCase()) ||
        AUDIT_LABEL[e.action].toLowerCase().includes(search.toLowerCase()) ||
        (e.target ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (e.detail ?? '').toLowerCase().includes(search.toLowerCase())),
    ),
    [events, search, result],
  )

  const exportCsv = () => {
    if (!canExport) return
    const header = 'time,actor,action,target,detail,result'
    const rows = visible.map((e) =>
      [fmtTime(e.ts), e.actor, AUDIT_LABEL[e.action], e.target ?? '', (e.detail ?? '').replace(/,/g, ';'), e.result].join(','),
    )
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'mobfleet-audit-log.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-3">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search audit log..."
            className="h-8 w-64 rounded-lg border border-line bg-white/[0.03] pl-8 pr-3 text-xs text-white/80 placeholder-white/25 outline-none transition-colors focus:border-[var(--accent-border)]"
          />
        </div>
        <div className="flex gap-1">
          {(['ALL', 'success', 'denied'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setResult(f)}
              className={[
                'rounded-md px-3 py-1 text-xs capitalize transition-colors',
                result === f ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]' : 'text-white/35 hover:text-white/60',
              ].join(' ')}
            >
              {f}
            </button>
          ))}
        </div>
        <button
          onClick={exportCsv}
          disabled={!canExport}
          title={canExport ? 'Export the audit log as CSV' : 'Requires export-activity permission'}
          className="mono ml-auto flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[10px] uppercase tracking-widest text-white/50 transition-colors enabled:hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Download size={11} /> Export
        </button>
      </div>

      <div className="flex-1 overflow-auto px-4 py-2">
        <div className="flex items-center gap-3 px-3 py-1.5 text-[9px] font-medium uppercase tracking-wider text-white/20">
          <span className="w-20 shrink-0">Time</span>
          <span className="w-16 shrink-0">Result</span>
          <span className="w-32 shrink-0">Actor</span>
          <span className="w-44 shrink-0">Action</span>
          <span className="flex-1">Target / Detail</span>
        </div>
        <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-0.5 font-mono text-[11px]">
          {visible.map((e: AuditEvent) => (
            <motion.div key={e.id} variants={fadeIn} className="flex items-center gap-3 rounded-md px-3 py-1.5 transition-colors hover:bg-white/[0.02]">
              <span className="w-20 shrink-0 tabular-nums text-white/25">{fmtTime(e.ts)}</span>
              <span className={[
                'w-16 shrink-0 rounded px-1.5 py-0.5 text-center text-[9px] font-semibold',
                e.result === 'denied' ? 'bg-red-400/10 text-red-400' : 'bg-emerald-400/10 text-emerald-400',
              ].join(' ')}>
                {e.result === 'denied' ? 'DENIED' : 'OK'}
              </span>
              <span className="w-32 shrink-0 truncate text-white/55">{e.actor}</span>
              <span className="w-44 shrink-0 truncate font-medium text-white/70">{AUDIT_LABEL[e.action]}</span>
              <span className="flex-1 truncate text-white/40">
                {e.target}{e.detail ? <span className="text-white/25"> · {e.detail}</span> : null}
              </span>
            </motion.div>
          ))}
        </motion.div>
        {visible.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16">
            <ShieldAlert size={18} className="mb-2 text-white/15" />
            <span className="mono text-[10px] uppercase tracking-widest text-white/25">
              {events.length === 0 ? 'No security events recorded this session' : 'No events match the current filters'}
            </span>
          </div>
        )}
      </div>
    </>
  )
}

// ─── Operational activity tab ─────────────────────────────────────────────────
function OperationalActivity() {
  const [paused, setPaused] = useState(false)
  const events = useActivityFeed(paused)
  const [filter, setFilter] = useState<'ALL' | ActivityEvent['level']>('ALL')
  const [search, setSearch] = useState('')
  const [deviceFilter, setDeviceFilter] = useState<string>('')

  const devices = useMemo(() => [...new Set(events.map((e) => e.device))].sort(), [events])

  const visible = useMemo(
    () => events.filter((e) =>
      (filter === 'ALL' || e.level === filter) &&
      (deviceFilter === '' || e.device === deviceFilter) &&
      (search === '' ||
        e.message.toLowerCase().includes(search.toLowerCase()) ||
        e.device.toLowerCase().includes(search.toLowerCase()) ||
        e.type.toLowerCase().includes(search.toLowerCase())),
    ),
    [events, filter, search, deviceFilter],
  )

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-3">
        <button
          onClick={() => setPaused((p) => !p)}
          className={[
            'mono flex items-center gap-1.5 border px-3 py-1.5 text-[10px] uppercase tracking-widest transition-colors',
            paused ? 'border-amber-400/40 bg-amber-400/10 text-amber-400' : 'border-line text-white/40 hover:text-white/70',
          ].join(' ')}
        >
          {paused ? <Play size={11} /> : <Pause size={11} />} {paused ? 'Resume' : 'Pause'}
        </button>
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search activity..."
            className="h-8 w-64 rounded-lg border border-line bg-white/[0.03] pl-8 pr-3 text-xs text-white/80 placeholder-white/25 outline-none transition-colors focus:border-[var(--accent-border)]"
          />
        </div>
        <div className="flex gap-1">
          {RESULT_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={[
                'rounded-md px-3 py-1 text-xs transition-colors',
                filter === f ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]' : 'text-white/35 hover:text-white/60',
              ].join(' ')}
            >
              {f}
            </button>
          ))}
        </div>
        <select
          value={deviceFilter}
          onChange={(e) => setDeviceFilter(e.target.value)}
          aria-label="Filter by device"
          className="ml-auto h-8 cursor-pointer rounded-lg border border-line bg-elevated px-3 text-xs text-white/60 outline-none focus:border-[var(--accent-border)]"
        >
          <option value="">All devices</option>
          {devices.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      <div className="flex-1 overflow-auto px-4 py-2">
        <div className="flex items-center gap-3 px-3 py-1.5 text-[9px] font-medium uppercase tracking-wider text-white/20">
          <span className="w-20 shrink-0">Time</span>
          <span className="w-14 shrink-0">Result</span>
          <span className="w-28 shrink-0">Device</span>
          <span className="w-28 shrink-0">Action</span>
          <span className="flex-1">Details</span>
        </div>
        <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-0.5 font-mono text-[11px]">
          {visible.map((e) => (
            <motion.div key={e.id} variants={fadeIn} className="flex items-center gap-3 rounded-md px-3 py-1.5 transition-colors hover:bg-white/[0.02]">
              <span className="w-20 shrink-0 tabular-nums text-white/25">{e.ts}</span>
              <span className={['w-14 shrink-0 rounded px-1.5 py-0.5 text-center text-[9px] font-semibold', levelBg[e.level]].join(' ')}>{e.level}</span>
              <span className="w-28 shrink-0 truncate text-white/55">{e.device}</span>
              <span className={['w-28 shrink-0 truncate font-medium', levelStyle[e.level]].join(' ')}>{e.type}</span>
              <span className="flex-1 truncate text-white/40">{e.message}</span>
            </motion.div>
          ))}
        </motion.div>
        {visible.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16">
            <span className="mono text-[10px] uppercase tracking-widest text-white/25">No events match the current filters</span>
          </div>
        )}
      </div>
    </>
  )
}

// ─── Supabase-mode activity (real activity_events; NO synthetic feed, session store, or
// Railway /v1/activity). Both tabs read the same table, filtered by category. ──────────
const SB_RESULT_FILTERS = ['ALL', 'success', 'denied', 'error'] as const

function SupabaseActivity({ category, canExport }: { category: ActivityCategory; canExport: boolean }) {
  const { team, members } = useTeamContext()
  const { events, loading, error } = useActivityEvents(team?.id ?? null, category)
  const [search, setSearch] = useState('')
  const [result, setResult] = useState<(typeof SB_RESULT_FILTERS)[number]>('ALL')

  // Resolve a human actor from the team roster already in context (null actor = system/device).
  const nameOf = useCallback((uid: string | null) => {
    if (!uid) return 'System'
    const m = members.find((x) => x.user_id === uid)
    return m?.name || m?.email || uid.slice(0, 8)
  }, [members])

  const visible = useMemo(() => events.filter((e) =>
    (result === 'ALL' || e.result === result) &&
    (search === '' ||
      humanizeAction(e.action).toLowerCase().includes(search.toLowerCase()) ||
      (e.target_label ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (e.detail ?? '').toLowerCase().includes(search.toLowerCase()) ||
      nameOf(e.actor_user_id).toLowerCase().includes(search.toLowerCase())),
  ), [events, result, search, nameOf])

  const exportCsv = () => {
    if (!canExport) return
    const header = 'time,actor,action,target,detail,result'
    const rows = visible.map((e) => [fmtDateTime(new Date(e.created_at).getTime()), nameOf(e.actor_user_id), e.action, e.target_label ?? '', (e.detail ?? '').replace(/,/g, ';'), e.result].join(','))
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'mobfleet-activity.csv'; a.click(); URL.revokeObjectURL(url)
  }

  const badge = (r: ActivityEventRow['result']) =>
    r === 'denied' || r === 'error' ? 'bg-red-400/10 text-red-400' : r === 'info' ? 'bg-white/[0.06] text-white/45' : 'bg-emerald-400/10 text-emerald-400'

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-3">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search activity..." className="h-8 w-64 rounded-lg border border-line bg-white/[0.03] pl-8 pr-3 text-xs text-white/80 placeholder-white/25 outline-none transition-colors focus:border-[var(--accent-border)]" />
        </div>
        <div className="flex gap-1">
          {SB_RESULT_FILTERS.map((f) => (
            <button key={f} onClick={() => setResult(f)} className={['rounded-md px-3 py-1 text-xs capitalize transition-colors', result === f ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]' : 'text-white/35 hover:text-white/60'].join(' ')}>{f}</button>
          ))}
        </div>
        <button onClick={exportCsv} disabled={!canExport || visible.length === 0} title={canExport ? 'Export the loaded activity as CSV' : 'Requires export-activity permission'} className="mono ml-auto flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[10px] uppercase tracking-widest text-white/50 transition-colors enabled:hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-40">
          <Download size={11} /> Export
        </button>
      </div>

      <div className="flex-1 overflow-auto px-4 py-2">
        <div className="flex items-center gap-3 px-3 py-1.5 text-[9px] font-medium uppercase tracking-wider text-white/20">
          <span className="w-36 shrink-0">Time</span>
          <span className="w-16 shrink-0">Result</span>
          <span className="w-44 shrink-0">Actor</span>
          <span className="w-44 shrink-0">Action</span>
          <span className="flex-1">Target / Detail</span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16"><span className="mono text-[10px] uppercase tracking-widest text-white/25">Loading activity…</span></div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16"><ShieldAlert size={18} className="text-red-400/60" /><span className="text-[12px] text-white/55">Could not load activity.</span></div>
        ) : (
          <>
            <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-0.5 font-mono text-[11px]">
              {visible.map((e) => (
                <motion.div key={e.id} variants={fadeIn} className="flex items-center gap-3 rounded-md px-3 py-1.5 transition-colors hover:bg-white/[0.02]">
                  <span className="w-36 shrink-0 tabular-nums text-white/25">{fmtDateTime(new Date(e.created_at).getTime())}</span>
                  <span className={['w-16 shrink-0 rounded px-1.5 py-0.5 text-center text-[9px] font-semibold uppercase', badge(e.result)].join(' ')}>{e.result}</span>
                  <span className="w-44 shrink-0 truncate text-white/55" title={e.actor_user_id ?? 'system'}>{nameOf(e.actor_user_id)}</span>
                  <span className="w-44 shrink-0 truncate font-medium text-white/70" title={e.action}>{humanizeAction(e.action)}</span>
                  <span className="flex-1 truncate text-white/40">{e.target_label}{e.detail ? <span className="text-white/25"> · {e.detail}</span> : null}</span>
                </motion.div>
              ))}
            </motion.div>
            {visible.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16">
                <ActivityIcon size={18} className="mb-2 text-white/15" />
                <span className="mono text-[10px] uppercase tracking-widest text-white/25">{events.length === 0 ? 'No activity recorded yet' : 'No events match the current filters'}</span>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}

export function ActivityView() {
  const canViewSecurity = usePermission('activity.view_security')
  const canExport = usePermission('activity.export')
  const [tab, setTab] = useState<'operational' | 'security'>('operational')
  // Guard: never show the security tab content without permission.
  const activeTab = tab === 'security' && !canViewSecurity ? 'operational' : tab

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <div>
          <p className="mono mb-1 text-[9px] uppercase tracking-[0.2em] text-white/30">System</p>
          <h1 className="mono text-lg font-bold uppercase tracking-widest text-white">Activity</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-line bg-panel p-1">
            <button
              onClick={() => setTab('operational')}
              className={[
                'mono flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[10px] uppercase tracking-wider transition-colors',
                activeTab === 'operational' ? 'bg-elevated text-white/85' : 'text-white/40 hover:text-white/70',
              ].join(' ')}
            >
              <ActivityIcon size={11} /> Operational
            </button>
            {canViewSecurity ? (
              <button
                onClick={() => setTab('security')}
                className={[
                  'mono flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[10px] uppercase tracking-wider transition-colors',
                  activeTab === 'security' ? 'bg-elevated text-white/85' : 'text-white/40 hover:text-white/70',
                ].join(' ')}
              >
                <ShieldAlert size={11} /> Security Audit
              </button>
            ) : (
              <span
                title="Requires view-security-audit permission"
                className="mono flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[10px] uppercase tracking-wider text-white/20"
              >
                <Lock size={11} /> Security Audit
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-white/30">
            <Clock size={13} />
            <span className="tabular-nums">{activeTab === 'security' ? 'Audit log' : 'Live feed'}</span>
          </div>
        </div>
      </div>

      {activeTab === 'security'
        ? (SUPABASE_MODE ? <SupabaseActivity category="security" canExport={canExport} /> : <SecurityAudit canExport={canExport} />)
        : (SUPABASE_MODE ? <SupabaseActivity category="operational" canExport={canExport} /> : <OperationalActivity />)}
    </div>
  )
}

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { RefreshCw, Activity, AlertTriangle, Wifi, WifiOff } from 'lucide-react'
import { useProxies } from '@/hooks/use-proxies'
import { useNow } from '@/hooks/use-now'
import { useActingMember } from '@/lib/authorization/use-access'
import { can } from '@/lib/authorization'
import { useToastStore } from '@/state/toast-store'
import { regionLabel } from '@/data/regions'
import type { Proxy, ProxyStatus } from '@/shared/types'

const STATUS_COLOR: Record<ProxyStatus, string> = {
  healthy: 'var(--status-online)',
  failing: 'var(--status-error)',
  unassigned: 'rgba(255,255,255,0.3)',
}
const STATUS_LABEL: Record<ProxyStatus, string> = {
  healthy: 'HEALTHY',
  failing: 'FAILING',
  unassigned: 'UNASSIGNED',
}

/** Relative age of the last connectivity check, against a live clock. */
function checkAgo(ts: number | null | undefined, now: number): string {
  if (ts == null || ts <= 0) return 'never'
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

function Kpi({ label, value, color, topBorder, i }: {
  label: string; value: number; color: string; topBorder: string; i: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
      className="hud-corners p-4 flex flex-col gap-2"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderTop: `2px solid ${topBorder}`,
        ['--hud-c' as string]: `${topBorder}`,
      }}
    >
      <span className="mono text-[9px] uppercase tracking-[0.15em]" style={{ color: 'rgba(255,255,255,0.4)' }}>{label}</span>
      <span className="mono text-3xl font-bold tabular-nums" style={{ color }}>{value}</span>
    </motion.div>
  )
}

export function ProxiesView() {
  const { state, refresh, testing, test } = useProxies()
  const now = useNow()
  const member = useActingMember()
  const canControl = can(member, 'phones.control')
  const addToast = useToastStore((s) => s.addToast)

  const proxies = state.proxies
  const counts = useMemo(() => {
    const c = { total: proxies.length, healthy: 0, failing: 0, unassigned: 0 }
    for (const p of proxies) c[p.status]++
    return c
  }, [proxies])

  const runTest = (p: Proxy) => {
    if (!canControl || testing.has(p.ip)) return
    test(p.ip).catch((err) => {
      addToast(err instanceof Error ? err.message : 'Proxy test failed', 'error')
    })
  }

  return (
    <div className="flex flex-col h-full relative">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-line">
        <div>
          <p className="mono text-[9px] uppercase tracking-[0.2em] text-white/30 mb-1">Network</p>
          <h1 className="mono text-lg font-bold tracking-widest text-white uppercase">PROXY REGISTRY</h1>
          <p className="mono text-[10px] text-white/30 tracking-wider mt-0.5">{proxies.length} PROXIES TRACKED</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { void refresh() }}
            disabled={state.status === 'loading'}
            title="Re-fetch the proxy registry"
            className="mono h-8 px-4 text-[10px] uppercase tracking-widest text-white/70 border border-white/[0.12] transition-colors enabled:hover:border-white/40 enabled:hover:text-white disabled:cursor-not-allowed disabled:opacity-30 flex items-center gap-1.5"
          >
            <RefreshCw size={11} className={state.status === 'loading' ? 'animate-spin' : ''} />REFRESH
          </button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-3 px-6 py-4 border-b border-line">
        <Kpi label="TOTAL" value={counts.total} color="#ffffff" topBorder="rgba(255,255,255,0.3)" i={0} />
        <Kpi label="HEALTHY" value={counts.healthy} color="var(--accent-green)" topBorder="var(--accent-green)" i={1} />
        <Kpi label="FAILING" value={counts.failing} color="var(--accent-red)" topBorder="var(--accent-red)" i={2} />
        <Kpi label="UNASSIGNED" value={counts.unassigned} color="rgba(255,255,255,0.3)" topBorder="rgba(255,255,255,0.15)" i={3} />
      </div>

      {/* Error banner — shown above the table; prior rows stay visible. */}
      {state.status === 'error' && (
        <div className="flex items-center gap-2 px-6 py-3 border-b border-line bg-[var(--status-error)]/[0.06]">
          <AlertTriangle size={13} className="text-[var(--status-error)] shrink-0" />
          <span className="mono text-[10px] uppercase tracking-wider text-[var(--status-error)]">
            Could not load proxies{state.error.status ? ` (HTTP ${state.error.status})` : ''} — {state.error.message}
          </span>
          <button
            type="button"
            onClick={() => { void refresh() }}
            className="mono ml-auto h-7 px-3 text-[9px] uppercase tracking-widest text-white/60 border border-white/[0.15] hover:text-white hover:border-white/40 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-black">
            <tr className="border-b border-line">
              {['IP', 'PROVIDER', 'REGION', 'STATUS', 'LATENCY', 'ASSIGNED TO', 'LAST CHECK', ''].map((h) => (
                <th key={h} className="px-3 py-3 text-left mono text-[9px] font-medium text-white/25 uppercase tracking-[0.1em] whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {proxies.map((p, i) => {
              const color = STATUS_COLOR[p.status]
              const isTesting = testing.has(p.ip)
              return (
                <motion.tr
                  key={p.ip}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.25, delay: Math.min(i * 0.018, 0.5) }}
                  className="border-b border-white/[0.04] transition-colors hover:bg-white/[0.02]"
                >
                  <td className="px-3 py-3 mono text-white/70 text-[11px] whitespace-nowrap">{p.ip}</td>
                  <td className="px-3 py-3 mono text-white/45 text-[11px] uppercase">{p.provider}</td>
                  <td className="px-3 py-3 mono text-white/45 text-[11px]">{regionLabel(p.region)}</td>
                  <td className="px-3 py-3">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.status === 'healthy' ? 'status-dot-pulse' : ''}`}
                        style={{ background: color, boxShadow: p.status === 'healthy' ? `0 0 5px ${color}` : 'none' }}
                      />
                      <span className="mono text-[10px] uppercase tracking-wider" style={{ color }}>{STATUS_LABEL[p.status]}</span>
                    </span>
                  </td>
                  <td className="px-3 py-3 mono text-[11px] tabular-nums" style={{ color: p.latency > 0 ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.2)' }}>
                    {p.latency > 0 ? `${Math.round(p.latency)} ms` : '—'}
                  </td>
                  <td className="px-3 py-3 mono text-[11px]" style={{ color: p.assignedTo ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.2)' }}>
                    {p.assignedTo ?? 'unassigned'}
                  </td>
                  <td className="px-3 py-3 mono text-white/40 text-[10px] whitespace-nowrap">{checkAgo(p.lastCheck, now)}</td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => runTest(p)}
                      disabled={!canControl || isTesting}
                      title={canControl ? 'Run a connectivity test against this proxy' : 'Requires control-phones permission'}
                      className="mono inline-flex items-center gap-1.5 px-2.5 py-1 text-[9px] uppercase tracking-widest text-white/40 border border-white/[0.12] transition-colors enabled:hover:border-[var(--accent-border)] enabled:hover:text-[var(--accent-text)] enabled:hover:bg-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      {isTesting
                        ? (<><Activity size={11} className="animate-pulse" /> TESTING…</>)
                        : p.status === 'failing'
                          ? (<><WifiOff size={11} /> TEST</>)
                          : (<><Wifi size={11} /> TEST</>)}
                    </button>
                  </td>
                </motion.tr>
              )
            })}
          </tbody>
        </table>

        {/* Truthful loading / empty states (error keeps prior rows + banner). */}
        {state.status === 'loading' && proxies.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <RefreshCw size={16} className="text-white/25 animate-spin" />
            <span className="mono text-[10px] uppercase tracking-widest text-white/30">Loading proxies…</span>
          </div>
        )}
        {state.status === 'ready' && proxies.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <span className="mono text-[10px] uppercase tracking-widest text-white/30">No proxies in this workspace</span>
            <span className="mono text-[9px] tracking-wider text-white/20">Proxies appear here once they are provisioned for the fleet</span>
          </div>
        )}
      </div>
    </div>
  )
}

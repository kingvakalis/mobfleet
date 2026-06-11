import { useMemo } from 'react'
import { Activity } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { useFleet } from '@/hooks/use-fleet'
import { regionLabel } from '@/data/regions'
import { client } from '@/lib/provider'
import { formatRelative } from '@/lib/format'
import type { Proxy, ProxyStatus } from '@/lib/provider/types'

const STATUS_META: Record<ProxyStatus, { label: string; color: string }> = {
  healthy: { label: 'HEALTHY', color: 'var(--status-online)' },
  failing: { label: 'FAILING', color: 'var(--status-error)' },
  unassigned: { label: 'SPARE', color: 'var(--status-offline)' },
}

function Pill({ status }: { status: ProxyStatus }) {
  const m = STATUS_META[status]
  return (
    <span
      className="label inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-elevated px-2.5 py-1"
      style={{ color: m.color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.color, boxShadow: `0 0 5px ${m.color}` }} />
      {m.label}
    </span>
  )
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={`label px-4 py-2.5 font-normal text-fg-muted ${className ?? ''}`}>{children}</th>
}

function Row({ proxy, deviceName }: { proxy: Proxy; deviceName: string | null }) {
  const pct = Math.min(100, (proxy.latency / 250) * 100)
  return (
    <tr className="border-b border-line transition-colors hover:bg-panel">
      <td className="px-4 py-2.5"><Pill status={proxy.status} /></td>
      <td className="mono px-4 py-2.5 text-[12px] text-fg-secondary">{proxy.ip}</td>
      <td className="label px-4 py-2.5 text-fg-secondary">{regionLabel(proxy.region)}</td>
      <td className="px-4 py-2.5 text-[12px] text-fg-secondary">{proxy.provider}</td>
      <td className="mono px-4 py-2.5 text-[12px] text-fg-muted">{deviceName ?? '—'}</td>
      <td className="px-4 py-2.5">
        {proxy.status === 'failing' ? (
          <span className="mono text-[12px] text-status-error">timeout</span>
        ) : (
          <div className="flex items-center gap-2">
            <div className="h-1 w-16 overflow-hidden rounded-full bg-elevated">
              <div className="h-full rounded-full bg-fg-muted" style={{ width: `${pct}%` }} />
            </div>
            <span className="mono w-12 text-[12px] tabular-nums text-fg-secondary">{proxy.latency}ms</span>
          </div>
        )}
      </td>
      <td className="mono px-4 py-2.5 text-[12px] text-fg-muted">{formatRelative(proxy.lastCheck)}</td>
      <td className="px-4 py-2.5 text-right">
        <button
          type="button"
          onClick={() => void client.testProxy(proxy.ip)}
          className="label inline-flex items-center gap-1.5 rounded-control border border-line px-2 py-1 text-fg-secondary transition-colors hover:bg-elevated hover:text-fg"
        >
          <Activity size={11} /> Test
        </button>
      </td>
    </tr>
  )
}

export function ProxiesView() {
  const snapshot = useFleet()
  const names = useMemo(() => {
    const m = new Map<string, string>()
    for (const d of snapshot.devices) m.set(d.id, d.name)
    return m
  }, [snapshot.devices])

  const counts = useMemo(() => {
    let healthy = 0, failing = 0, spare = 0
    for (const p of snapshot.proxies) {
      if (p.status === 'healthy') healthy++
      else if (p.status === 'failing') failing++
      else spare++
    }
    return { healthy, failing, spare }
  }, [snapshot.proxies])

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-6 py-4">
        <div>
          <Label className="text-fg">Proxy Pool</Label>
          <div className="mono mt-1 text-[11px] text-fg-muted">
            {snapshot.proxies.length} TOTAL · {counts.healthy} HEALTHY ·{' '}
            <span className="text-status-error">{counts.failing} FAILING</span> · {counts.spare} SPARE
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-canvas">
            <tr className="border-b border-line">
              <Th>Status</Th>
              <Th>IP</Th>
              <Th>Region</Th>
              <Th>Provider</Th>
              <Th>Assigned</Th>
              <Th>Latency</Th>
              <Th>Last Check</Th>
              <Th className="text-right" />
            </tr>
          </thead>
          <tbody>
            {snapshot.proxies.map((p) => (
              <Row key={p.ip} proxy={p} deviceName={p.assignedTo ? names.get(p.assignedTo) ?? null : null} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

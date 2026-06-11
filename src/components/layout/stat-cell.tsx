import { Counter } from '@/components/ui/counter'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusDot } from '@/components/ui/status-dot'
import type { DeviceStatus } from '@/lib/status'
import { cn } from '@/lib/utils'

/** One live counter in the mission-control header rail. */
export function StatCell({
  label,
  value,
  format,
  dotStatus,
  accent = false,
  loading = false,
}: {
  label: string
  value: number
  format?: (n: number) => string
  dotStatus?: DeviceStatus
  accent?: boolean
  loading?: boolean
}) {
  return (
    <div className="flex min-w-[96px] flex-col justify-center gap-1.5 border-r border-line px-5">
      <div className="flex items-center gap-1.5">
        {dotStatus && <StatusDot status={dotStatus} size={6} pulse={!loading} />}
        <Label className="text-fg-muted">{label}</Label>
      </div>
      {loading ? (
        <Skeleton className="h-[18px] w-10" />
      ) : (
        <Counter
          value={value}
          format={format}
          className={cn('text-lg leading-none', accent ? 'text-accent' : 'text-fg')}
        />
      )}
    </div>
  )
}

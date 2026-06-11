import { STATUS, type DeviceStatus } from '@/lib/status'
import { cn } from '@/lib/utils'

export function StatusDot({
  status,
  pulse = false,
  size = 8,
  className,
}: {
  status: DeviceStatus
  /** Add a slow breathing halo (skip for offline). */
  pulse?: boolean
  size?: number
  className?: string
}) {
  const color = STATUS[status].color
  const showPulse = pulse && status !== 'offline'
  return (
    <span
      className={cn('relative inline-flex shrink-0', className)}
      style={{ width: size, height: size }}
    >
      {showPulse && (
        <span
          className="absolute inset-0 rounded-full animate-ring-pulse"
          style={{ boxShadow: `0 0 0 2px ${color}` }}
        />
      )}
      <span
        className="absolute inset-0 rounded-full"
        style={{ background: color, boxShadow: `0 0 6px ${color}` }}
      />
    </span>
  )
}

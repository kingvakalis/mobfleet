import { STATUS, type DeviceStatus } from '@/lib/status'
import { cn } from '@/lib/utils'

/**
 * The node status ring: a soft-cornered square framed by a slow-pulsing ring
 * in the status color. This is the visual heart of a fleet node — used both in
 * the graph and the style guide. Offline holds a dim, static ring.
 */
export function StatusRing({
  status,
  size = 56,
  children,
  className,
}: {
  status: DeviceStatus
  size?: number
  children?: React.ReactNode
  className?: string
}) {
  const color = STATUS[status].color
  const isOffline = status === 'offline'
  return (
    <div
      className={cn('relative', className)}
      style={{ width: size, height: size }}
    >
      {/* Pulsing ring */}
      <div
        className={cn(
          'absolute inset-0 rounded-[10px]',
          isOffline ? 'opacity-40' : 'animate-ring-pulse',
        )}
        style={{ boxShadow: `0 0 0 1.5px ${color}` }}
      />
      {/* Node face */}
      <div className="absolute inset-[3px] flex items-center justify-center rounded-[8px] border border-line bg-elevated">
        {children}
      </div>
    </div>
  )
}

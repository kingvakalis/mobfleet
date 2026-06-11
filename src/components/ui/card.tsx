import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

/** Four L-shaped HUD corner ticks — SpaceX framing on a Vercel card. */
export function CornerTicks({ className }: { className?: string }) {
  const base = 'absolute h-2 w-2 border-white/20'
  return (
    <div className={cn('pointer-events-none absolute inset-0', className)} aria-hidden>
      <span className={cn(base, 'left-0 top-0 border-l border-t')} />
      <span className={cn(base, 'right-0 top-0 border-r border-t')} />
      <span className={cn(base, 'bottom-0 left-0 border-b border-l')} />
      <span className={cn(base, 'bottom-0 right-0 border-b border-r')} />
    </div>
  )
}

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Render HUD corner ticks. */
  ticks?: boolean
  /** Slightly raised surface (elevated vs panel). */
  elevated?: boolean
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, ticks = false, elevated = false, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'relative rounded-card border border-line',
        elevated ? 'bg-elevated' : 'bg-panel',
        className,
      )}
      {...props}
    >
      {ticks && <CornerTicks />}
      {children}
    </div>
  ),
)
Card.displayName = 'Card'

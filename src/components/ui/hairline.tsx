import { cn } from '@/lib/utils'

/** A 1px divider in the border token. Horizontal by default. */
export function Hairline({
  vertical = false,
  className,
}: {
  vertical?: boolean
  className?: string
}) {
  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      className={cn(
        'bg-line',
        vertical ? 'h-full w-px' : 'h-px w-full',
        className,
      )}
    />
  )
}

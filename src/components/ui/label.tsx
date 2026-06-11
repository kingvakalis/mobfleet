import { cn } from '@/lib/utils'

/** SpaceX-style section label: uppercase, wide tracking, mono. */
export function Label({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn('label', className)} {...props}>
      {children}
    </span>
  )
}

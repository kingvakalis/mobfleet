import { cn } from '@/lib/utils'

/** Skeleton loader with a shimmer sweep — never a spinner. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('shimmer rounded-control', className)} />
}

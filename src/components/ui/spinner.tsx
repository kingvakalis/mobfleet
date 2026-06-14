import { cn } from '@/lib/utils'

/** Geist-style spinner: 12 radial bars with a sweeping fade (the Vercel loader). */
export function Spinner({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn('relative', className)}
      style={{ width: size, height: size }}
    >
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={i}
          className="absolute left-1/2 top-1/2 h-[8%] w-[24%] animate-spinner-fade rounded-full bg-fg-secondary"
          style={{
            transform: `translate(-50%, -50%) rotate(${i * 30}deg) translateX(146%)`,
            animationDelay: `${i * 100 - 1200}ms`,
          }}
        />
      ))}
    </div>
  )
}

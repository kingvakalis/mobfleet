import logoUrl from '@/assets/mobfleet-logo.png'

/**
 * The official MobFleet badge — the single source of truth for the app logo/icon.
 * Render at a fixed square box via `className` (e.g. "h-7 w-7"); the source is a square,
 * transparent-corner PNG, so `object-contain` keeps the aspect ratio with NO stretch and NO
 * background box — clean on the dark UI. Use this everywhere instead of duplicating <img>.
 */
export function BrandLogo({ className, alt = 'MobFleet' }: { className?: string; alt?: string }) {
  return (
    <img
      src={logoUrl}
      alt={alt}
      draggable={false}
      className={`select-none object-contain ${className ?? ''}`}
    />
  )
}

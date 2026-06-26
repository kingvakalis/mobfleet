import type { CSSProperties } from 'react'
import logoUrl from '@/assets/mobfleet-logo.png'

/**
 * The official MobFleet badge — the single source of truth for the app logo/icon.
 * The source is the 3D phone/star app icon: a square, transparent-corner PNG, so
 * `object-contain` keeps the aspect ratio with NO stretch and NO background box —
 * clean on the dark UI. Render at a fixed square box via `className` (e.g. "h-7 w-7").
 * Use this everywhere instead of duplicating <img>.
 *
 * A subtle drop-shadow gives the 3D badge a little depth so it reads as lightly
 * sitting on the UI surface — a small bottom shadow plus a very soft cyan tint, no
 * neon glow. Pass `shadow={false}` for flat contexts.
 */
const BADGE_SHADOW =
  'drop-shadow(0 6px 10px rgba(0,0,0,0.35)) drop-shadow(0 0 8px rgba(35,240,220,0.10))'

export function BrandLogo({
  className,
  alt = 'MobFleet',
  shadow = true,
  style,
}: {
  className?: string
  alt?: string
  shadow?: boolean
  style?: CSSProperties
}) {
  return (
    <img
      src={logoUrl}
      alt={alt}
      draggable={false}
      className={`select-none object-contain ${className ?? ''}`}
      style={shadow ? { filter: BADGE_SHADOW, ...style } : style}
    />
  )
}

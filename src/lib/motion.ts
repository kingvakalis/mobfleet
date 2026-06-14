import type { Transition, Variants } from 'framer-motion'

/**
 * Shared motion language. Everything is expo-out, 200–400ms — smooth and
 * intentional, never bouncy. Centralised so every animation reads the same.
 */
export const EXPO_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1]

/**
 * Reusable list/grid enter motion. A container staggers its children; each item
 * fades + rises. Under prefers-reduced-motion (MotionConfig reducedMotion=user)
 * the transform is dropped automatically, leaving a clean fade.
 */
export const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04, delayChildren: 0.03 } },
}

export const fadeRise: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.26, ease: EXPO_OUT } },
}

/** Opacity-only item enter — safe for table rows / live-updating lists (no
 *  transform, so no reflow on frequently-changing data). */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.22, ease: EXPO_OUT } },
}

export const DUR = {
  fast: 0.2,
  base: 0.28,
  slow: 0.4,
} as const

export const ease = {
  expoOut: { duration: DUR.base, ease: EXPO_OUT } satisfies Transition,
  expoOutSlow: { duration: DUR.slow, ease: EXPO_OUT } satisfies Transition,
  expoOutFast: { duration: DUR.fast, ease: EXPO_OUT } satisfies Transition,
}

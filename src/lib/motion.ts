import type { Transition } from 'framer-motion'

/**
 * Shared motion language. Everything is expo-out, 200–400ms — smooth and
 * intentional, never bouncy. Centralised so every animation reads the same.
 */
export const EXPO_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1]

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

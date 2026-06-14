import { memo } from 'react'
import { getStraightPath, type EdgeProps } from '@xyflow/react'
import { motion, useReducedMotion } from 'framer-motion'

/**
 * Hairline spoke from core to node. On an active (busy) edge a light pulse
 * travels outward — the telemetry "data is flowing" cue.
 */
export const PulseEdge = memo(function PulseEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
}: EdgeProps) {
  const [path] = getStraightPath({ sourceX: sourceX ?? 0, sourceY: sourceY ?? 0, targetX: targetX ?? 0, targetY: targetY ?? 0 })
  const d = data as { active?: boolean; emphasized?: boolean; dimmed?: boolean; selected?: boolean } | undefined
  const active = Boolean(d?.active)
  const emphasized = Boolean(d?.emphasized)
  const dimmed = Boolean(d?.dimmed)
  const isSelected = Boolean(d?.selected)
  const reduce = useReducedMotion()
  // Skip render until React Flow has resolved real positions. Use finite-checks
  // (not truthiness) so a legitimate 0 coordinate isn't treated as "unresolved".
  if (![sourceX, sourceY, targetX, targetY].every(Number.isFinite)) return null

  return (
    <>
      <path
        d={path}
        fill="none"
        style={{
          // Selected connection goes to full strength, above all other states.
          stroke: isSelected ? 'var(--accent)' : emphasized ? 'var(--accent)' : active ? 'var(--status-busy)' : 'var(--border)',
          strokeWidth: isSelected ? 1.75 : emphasized ? 1.5 : active ? 1.25 : 1,
          opacity: isSelected ? 1 : dimmed ? 0.15 : emphasized ? 0.75 : active ? 0.5 : 0.85,
          transition: 'opacity 240ms ease, stroke 240ms ease',
        }}
      />
      {active && !reduce && (
        <motion.circle
          r={2.4}
          // Explicit base cx/cy so the very first paint frame (before framer
          // applies the keyframes) has valid coords — avoids the SVG
          // `cx="undefined"` console error.
          cx={sourceX}
          cy={sourceY}
          fill="var(--accent)"
          style={{ filter: 'drop-shadow(0 0 3px var(--accent))' }}
          initial={{ cx: sourceX, cy: sourceY, opacity: 0 }}
          animate={{
            cx: [sourceX, targetX],
            cy: [sourceY, targetY],
            opacity: [0, 1, 1, 0],
          }}
          transition={{
            duration: 1.3,
            repeat: Infinity,
            ease: 'linear',
            times: [0, 0.12, 0.85, 1],
          }}
        />
      )}
    </>
  )
})

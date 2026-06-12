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
  const d = data as { active?: boolean; emphasized?: boolean; dimmed?: boolean } | undefined
  const active = Boolean(d?.active)
  const emphasized = Boolean(d?.emphasized)
  const dimmed = Boolean(d?.dimmed)
  const reduce = useReducedMotion()
  // Skip render until positions are resolved
  if (!sourceX || !sourceY || !targetX || !targetY) return null

  return (
    <>
      <path
        d={path}
        fill="none"
        style={{
          stroke: emphasized ? 'var(--accent)' : active ? 'var(--status-busy)' : 'var(--border)',
          strokeWidth: emphasized ? 1.5 : active ? 1.25 : 1,
          opacity: dimmed ? 0.15 : emphasized ? 0.75 : active ? 0.5 : 0.85,
          transition: 'opacity 240ms ease, stroke 240ms ease',
        }}
      />
      {active && !reduce && (
        <motion.circle
          r={2.4}
          fill="var(--accent)"
          style={{ filter: 'drop-shadow(0 0 3px var(--accent))' }}
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

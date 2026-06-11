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
  const [path] = getStraightPath({ sourceX, sourceY, targetX, targetY })
  const active = Boolean((data as { active?: boolean } | undefined)?.active)
  const reduce = useReducedMotion()

  return (
    <>
      <path
        d={path}
        fill="none"
        style={{
          stroke: active ? 'var(--status-busy)' : 'var(--border)',
          strokeWidth: active ? 1.25 : 1,
          opacity: active ? 0.5 : 0.85,
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

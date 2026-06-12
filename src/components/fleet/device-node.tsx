import { memo, useEffect } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { markWarped } from '@/lib/layout/constellation'
import { EXPO_OUT } from '@/lib/motion'
import { STATUS } from '@/lib/status'
import type { Device, Job } from '@/lib/provider/types'
import { cn } from '@/lib/utils'

// Portrait phone footprint (the node bounding box).
export const NODE_W = 50
export const NODE_H = 88

// `type` (not `interface`) so it's assignable to React Flow's node data record.
export type DeviceNodeData = {
  device: Device
  job?: Job | null
  isNew?: boolean
  exiting?: boolean
  hovered?: boolean
  pos?: { x: number; y: number }
  /** Fails the active fleet filters → faded, labels hidden. */
  dimmed?: boolean
  /** Matches the active fleet filters → status-colored emphasis outline. */
  emphasized?: boolean
  /** Color identity when its group is part of a multi-group filter. */
  groupColor?: string | null
}

const centeredHandle =
  '!h-1.5 !w-1.5 !min-w-0 !min-h-0 !rounded-full !border-0 !bg-transparent !opacity-0'

function jitter(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return (h % 25) / 100
}

/** The tiny live screen rendered inside each node's phone. */
function MiniScreen({ device, job }: { device: Device; job?: Job | null }) {
  const color = STATUS[device.status].color
  switch (device.status) {
    case 'busy':
      return (
        <div className="flex h-full flex-col gap-[2px] p-[3px]">
          <div className="flex-1 rounded-[2px] bg-white/[0.05]" />
          <div className="h-[2px] w-3/4 rounded-full bg-white/10" />
          <div className="mt-[1px] h-[3px] w-full overflow-hidden rounded-full bg-black/50">
            <div className="h-full rounded-full" style={{ width: `${(job?.progress ?? 0) * 100}%`, background: color }} />
          </div>
        </div>
      )
    case 'online':
      return (
        <div className="grid h-full grid-cols-3 content-start gap-[3px] p-[4px]">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-square rounded-[2px] bg-white/[0.07]" />
          ))}
        </div>
      )
    case 'warming':
      return <div className="shimmer h-full w-full" />
    case 'error':
      return (
        <div className="flex h-full items-center justify-center">
          <div className="h-3 w-[2px] rounded-full" style={{ background: color }} />
        </div>
      )
    case 'offline':
      return (
        <div className="flex h-full items-center justify-center">
          <div className="h-1.5 w-1.5 rounded-full bg-white/10" />
        </div>
      )
  }
}

/**
 * One phone in the constellation. Hover only clarifies the frame (no info
 * card, no movement) — device details appear on SELECTION. Double-click opens
 * full phone control (handled by the graph).
 */
export const DeviceNode = memo(function DeviceNode({ data, selected, dragging }: NodeProps) {
  const { device, job, isNew, exiting, hovered, dimmed, emphasized, groupColor } =
    data as unknown as DeviceNodeData
  const reduce = useReducedMotion()
  const color = STATUS[device.status].color
  const offline = device.status === 'offline'
  const short = device.id.slice(-4).toUpperCase()
  const warp = Boolean(isNew) && !reduce
  const delay = warp ? jitter(device.id) : 0

  useEffect(() => {
    markWarped(device.id)
  }, [device.id])

  return (
    <motion.div
      className="relative"
      style={{ width: NODE_W, height: NODE_H, cursor: dragging ? 'grabbing' : 'pointer' }}
      initial={warp ? { opacity: 0, scale: 0.8 } : false}
      animate={
        exiting
          ? { opacity: 0, scale: 0.9, filter: 'blur(4px) saturate(0)' }
          : { opacity: dimmed ? 0.22 : 1, scale: 1, filter: 'blur(0px) saturate(1)' }
      }
      transition={
        exiting ? { duration: reduce ? 0 : 0.34, ease: EXPO_OUT } : { duration: 0.3, ease: EXPO_OUT, delay }
      }
    >
      <Handle
        id="in"
        type="target"
        position={Position.Top}
        className={centeredHandle}
        style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
      />

      {warp && (
        <motion.div
          className="absolute inset-0 rounded-[14px]"
          style={{ boxShadow: `0 0 0 1.5px ${color}` }}
          initial={{ opacity: 0.7, scale: 1.5 }}
          animate={{ opacity: 0, scale: 1 }}
          transition={{ duration: 0.6, ease: EXPO_OUT, delay }}
        />
      )}

      {/* Filter emphasis — restrained status/group outline (below selection). */}
      <AnimatePresence>
        {emphasized && !exiting && !selected && (
          <motion.div
            className="pointer-events-none absolute -inset-[4px] rounded-[17px]"
            initial={{ opacity: 0, scale: 1.08 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: EXPO_OUT }}
            style={{ boxShadow: `0 0 0 1.5px ${groupColor ?? color}, 0 0 14px ${groupColor ?? color}40` }}
          />
        )}
      </AnimatePresence>

      {/* Selection — strongest ring in the hierarchy. */}
      {selected && (
        <div className="absolute -inset-1.5 rounded-[17px]" style={{ boxShadow: '0 0 0 2px var(--accent), 0 0 18px var(--accent-soft)' }} />
      )}

      <div className="absolute inset-0">
        {/* hover — minimal frame clarification only */}
        <div
          className="pointer-events-none absolute -inset-[3px] rounded-[16px] transition-opacity duration-150"
          style={{
            opacity: hovered && !exiting && !selected ? 1 : 0,
            boxShadow: '0 0 0 1px var(--border-bright)',
          }}
        />

        {/* status ring hugs the phone */}
        <div
          className={cn('absolute inset-0 rounded-[14px]', offline ? 'opacity-40' : 'animate-ring-pulse')}
          style={{ boxShadow: `0 0 0 1.5px ${color}` }}
        />

        {/* side buttons: volume (left) + power (right) */}
        <div className="absolute -left-[2px] top-[18px] h-[7px] w-[2px] rounded-l-[1px] bg-[#3a3a3c]" />
        <div className="absolute -left-[2px] top-[28px] h-[7px] w-[2px] rounded-l-[1px] bg-[#3a3a3c]" />
        <div className="absolute -right-[2px] top-[24px] h-[11px] w-[2px] rounded-r-[1px] bg-[#3a3a3c]" />

        {/* phone body: brushed-metal frame around the glass */}
        <div
          className={cn('absolute inset-0 rounded-[14px] p-[2.5px]', offline && 'opacity-60')}
          style={{
            background: 'linear-gradient(150deg, #48484c 0%, #1c1c1f 28%, #0c0c0e 62%, #313135 100%)',
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.07), 0 4px 14px rgba(0,0,0,0.6)',
          }}
        >
          {/* screen */}
          <div className="relative h-full w-full overflow-hidden rounded-[11.5px] bg-pure-black">
            <MiniScreen device={device} job={job} />
            {/* dynamic-island pill with camera dot */}
            <div className="absolute left-1/2 top-[3px] z-10 flex h-[4px] w-[14px] -translate-x-1/2 items-center justify-end rounded-full bg-pure-black pr-[2px]">
              <div className="h-[2px] w-[2px] rounded-full bg-[#1e3a5f]" />
            </div>
            {/* home indicator */}
            <div className="absolute bottom-[2px] left-1/2 z-10 h-[2px] w-[11px] -translate-x-1/2 rounded-full bg-white/25" />
            {/* glass reflection */}
            <div
              className="pointer-events-none absolute inset-0 z-10 rounded-[11.5px]"
              style={{
                background:
                  'linear-gradient(118deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 26%, transparent 42%)',
              }}
            />
          </div>
        </div>
      </div>

      {/* id label below the phone — clearer when emphasized, hidden when dimmed */}
      <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-center">
        <span
          className="mono text-[8px] transition-colors duration-200"
          style={{ color: dimmed ? 'transparent' : emphasized ? 'rgba(255,255,255,0.85)' : 'var(--text-muted)' }}
        >
          {short}
        </span>
        {emphasized && groupColor && (
          <div
            className="mono mt-[1px] rounded-full border px-1 text-[7px] uppercase tracking-wider"
            style={{ borderColor: `${groupColor}66`, color: groupColor, background: `${groupColor}14` }}
          >
            {device.group}
          </div>
        )}
      </div>

    </motion.div>
  )
})

import { memo, useEffect, type CSSProperties } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { markWarped } from '@/lib/layout/constellation'
import { EXPO_OUT } from '@/lib/motion'
import { STATUS } from '@/lib/status'
import type { Device, Job } from '@/lib/provider/types'
import { cn } from '@/lib/utils'
import { TelemetryCard } from './telemetry-card'

// Portrait phone footprint (the node bounding box).
export const NODE_W = 50
export const NODE_H = 88

const CARD_WIDTH = 280
const CARD_EST_HEIGHT = 250
const CARD_GAP = 16

/**
 * Anchor the hover card beside the phone (toward the constellation centre),
 * never over it. The gap is padding on the wrapper, not empty space, so the
 * pointer stays inside the node subtree and hover doesn't drop mid-travel.
 */
function cardAnchor(pos?: { x: number; y: number }): CSSProperties {
  const x = pos?.x ?? 0
  const y = pos?.y ?? 0
  if (Math.abs(x) >= Math.abs(y)) {
    // Beside the phone, vertically centred on it.
    const top = NODE_H / 2 - CARD_EST_HEIGHT / 2
    return x > 0
      ? { right: NODE_W, top, paddingRight: CARD_GAP }
      : { left: NODE_W, top, paddingLeft: CARD_GAP }
  }
  // Above or below the phone, horizontally centred on it.
  const left = NODE_W / 2 - CARD_WIDTH / 2
  return y > 0
    ? { bottom: NODE_H, left, paddingBottom: CARD_GAP }
    : { top: NODE_H, left, paddingTop: CARD_GAP }
}

// `type` (not `interface`) so it's assignable to React Flow's node data record.
export type DeviceNodeData = {
  device: Device
  job?: Job | null
  isNew?: boolean
  exiting?: boolean
  hovered?: boolean
  pos?: { x: number; y: number }
  /** Dimmed because a group filter excludes it. */
  dimmed?: boolean
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

/** One phone in the constellation: status ring + phone body with a live screen. */
export const DeviceNode = memo(function DeviceNode({ data, selected }: NodeProps) {
  const { device, job, isNew, exiting, hovered, pos, dimmed } = data as unknown as DeviceNodeData
  const dim = dimmed ? 'opacity-20 grayscale transition-opacity duration-300' : 'transition-opacity duration-300'
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
      style={{ width: NODE_W, height: NODE_H }}
      initial={warp ? { opacity: 0, scale: 0.8 } : false}
      animate={
        exiting
          ? { opacity: 0, scale: 0.9, filter: 'blur(4px) saturate(0)' }
          : { opacity: 1, scale: 1, filter: 'blur(0px) saturate(1)' }
      }
      transition={
        exiting ? { duration: reduce ? 0 : 0.34, ease: EXPO_OUT } : { duration: 0.5, ease: EXPO_OUT, delay }
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

      {selected && (
        <div className="absolute -inset-1 rounded-[16px]" style={{ boxShadow: '0 0 0 1.5px var(--accent)' }} />
      )}

      {/* phone scales up slightly while the hover card is open */}
      <motion.div
        className="absolute inset-0"
        animate={{ scale: hovered && !exiting ? 1.08 : 1 }}
        transition={{ duration: 0.2, ease: EXPO_OUT }}
      >
        {/* hover highlight */}
        <AnimatePresence>
          {hovered && !exiting && (
            <motion.div
              className="pointer-events-none absolute -inset-[5px] rounded-[18px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              style={{ boxShadow: `0 0 0 1.5px ${color}, 0 0 22px ${color}66, 0 0 56px ${color}2e` }}
            />
          )}
        </AnimatePresence>

        {/* status ring hugs the phone */}
        <div
          className={cn('absolute inset-0 rounded-[14px]', offline ? 'opacity-40' : 'animate-ring-pulse', dim)}
          style={{ boxShadow: `0 0 0 1.5px ${color}` }}
        />

        {/* side buttons: volume (left) + power (right) */}
        <div className={cn('absolute -left-[2px] top-[18px] h-[7px] w-[2px] rounded-l-[1px] bg-[#3a3a3c]', dim)} />
        <div className={cn('absolute -left-[2px] top-[28px] h-[7px] w-[2px] rounded-l-[1px] bg-[#3a3a3c]', dim)} />
        <div className={cn('absolute -right-[2px] top-[24px] h-[11px] w-[2px] rounded-r-[1px] bg-[#3a3a3c]', dim)} />

        {/* phone body: brushed-metal frame around the glass */}
        <div
          className={cn('absolute inset-0 rounded-[14px] p-[2.5px]', offline && 'opacity-60', dim)}
          style={{
            background: 'linear-gradient(150deg, #48484c 0%, #1c1c1f 28%, #0c0c0e 62%, #313135 100%)',
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.07), 0 4px 14px rgba(0,0,0,0.6)',
          }}
        >
          {/* screen */}
          <div className="relative h-full w-full overflow-hidden rounded-[11.5px] bg-[#050505]">
            <MiniScreen device={device} job={job} />
            {/* dynamic-island pill with camera dot */}
            <div className="absolute left-1/2 top-[3px] z-10 flex h-[4px] w-[14px] -translate-x-1/2 items-center justify-end rounded-full bg-black pr-[2px]">
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
      </motion.div>

      {/* id label below the phone */}
      <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap">
        <span className="mono text-[8px] text-fg-muted">{short}</span>
      </div>

      {/* hover → expand into telemetry card */}
      <AnimatePresence>
        {hovered && !exiting && (
          <motion.div
            key="card"
            className="absolute z-50"
            style={cardAnchor(pos)}
            initial={{ opacity: 0, scale: 0.92, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 2 }}
            transition={{ duration: 0.2, ease: EXPO_OUT }}
          >
            <TelemetryCard device={device} job={job} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
})

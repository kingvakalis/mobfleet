import { memo, useEffect } from 'react'
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

/** Anchor the hover card toward the constellation centre (flow-coord based). */
function cardAnchor(pos?: { x: number; y: number }): { left: number; top: number } {
  const x = pos?.x ?? 0
  const y = pos?.y ?? 0
  const left = x > 60 ? NODE_W - CARD_WIDTH : x < -60 ? 0 : NODE_W / 2 - CARD_WIDTH / 2
  const top = y < -60 ? NODE_H + 10 : y > 60 ? -(CARD_EST_HEIGHT + 10) : -10
  return { left, top }
}

// `type` (not `interface`) so it's assignable to React Flow's node data record.
export type DeviceNodeData = {
  device: Device
  job?: Job | null
  isNew?: boolean
  exiting?: boolean
  hovered?: boolean
  pos?: { x: number; y: number }
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
  const { device, job, isNew, exiting, hovered, pos } = data as unknown as DeviceNodeData
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

      {/* status ring hugs the phone */}
      <div
        className={cn('absolute inset-0 rounded-[14px]', offline ? 'opacity-40' : 'animate-ring-pulse')}
        style={{ boxShadow: `0 0 0 1.5px ${color}` }}
      />

      {/* phone body */}
      <div className={cn('absolute inset-0 rounded-[14px] border border-line bg-[#0a0a0a] p-[3px]', offline && 'opacity-60')}>
        {/* notch */}
        <div className="absolute left-1/2 top-[4px] z-10 h-[3px] w-3.5 -translate-x-1/2 rounded-full bg-black" />
        {/* screen */}
        <div className="h-full w-full overflow-hidden rounded-[11px] bg-[#050505]">
          <MiniScreen device={device} job={job} />
        </div>
      </div>

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

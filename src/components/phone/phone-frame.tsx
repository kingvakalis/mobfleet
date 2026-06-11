import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Camera, Circle, Power } from 'lucide-react'
import type { LogLevel } from '@/hooks/use-device-log'
import type { Device, Job } from '@/lib/provider/types'
import { cn } from '@/lib/utils'
import { PhoneScreen } from './phone-screen'

const SCREEN_W = 118
const SCREEN_H = 248

function Control({
  icon: Icon,
  label,
  onClick,
  active,
}: {
  icon: typeof Power
  label: string
  onClick: () => void
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-full border transition-colors',
        active
          ? 'border-accent/50 bg-accent/10 text-accent'
          : 'border-line text-fg-muted hover:bg-elevated hover:text-fg',
      )}
    >
      <Icon size={14} />
    </button>
  )
}

/** A framed, interactive iPhone — tap the screen, home, wake/lock, screenshot. */
export function PhoneFrame({
  device,
  job,
  onLog,
}: {
  device: Device
  job?: Job | null
  onLog: (level: LogLevel, text: string) => void
}) {
  const [awake, setAwake] = useState(true)
  const [flash, setFlash] = useState(false)
  const [ripple, setRipple] = useState<{ x: number; y: number; id: number } | null>(null)

  const tap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!awake) return
    const r = e.currentTarget.getBoundingClientRect()
    const x = Math.round(e.clientX - r.left)
    const y = Math.round(e.clientY - r.top)
    setRipple({ x, y, id: Date.now() })
    onLog('info', `tap (${x}, ${y})`)
  }

  const toggleWake = () => {
    setAwake((a) => {
      onLog(a ? 'warn' : 'ok', a ? 'screen locked' : 'screen woke')
      return !a
    })
  }

  const home = () => {
    onLog('info', 'home button')
    setRipple({ x: SCREEN_W / 2, y: SCREEN_H - 12, id: Date.now() })
  }

  const screenshot = () => {
    setFlash(true)
    setTimeout(() => setFlash(false), 200)
    onLog('ok', 'screenshot captured')
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {/* phone */}
      <div className="relative rounded-[26px] border-[3px] border-[#1c1c1f] bg-black p-[5px] shadow-[0_12px_30px_-10px_rgba(0,0,0,0.9)]">
        {/* side buttons */}
        <div className="absolute -left-[3px] top-12 h-9 w-[3px] rounded-l bg-[#1c1c1f]" />
        <div className="absolute -right-[3px] top-16 h-12 w-[3px] rounded-r bg-[#1c1c1f]" />

        <div
          className="relative cursor-pointer overflow-hidden rounded-[20px] bg-[#050505]"
          style={{ width: SCREEN_W, height: SCREEN_H }}
          onClick={tap}
          role="button"
          aria-label="Device screen"
        >
          {/* dynamic island */}
          <div className="absolute left-1/2 top-1.5 z-20 h-3.5 w-12 -translate-x-1/2 rounded-full bg-black" />

          <PhoneScreen device={device} job={job} awake={awake} />

          {/* tap ripple */}
          <AnimatePresence>
            {ripple && (
              <motion.span
                key={ripple.id}
                className="pointer-events-none absolute z-30 rounded-full border border-accent/60"
                style={{ left: ripple.x, top: ripple.y }}
                initial={{ width: 0, height: 0, x: 0, y: 0, opacity: 0.8 }}
                animate={{ width: 44, height: 44, x: -22, y: -22, opacity: 0 }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                onAnimationComplete={() => setRipple(null)}
              />
            )}
          </AnimatePresence>

          {/* screenshot flash */}
          <AnimatePresence>
            {flash && (
              <motion.div
                className="pointer-events-none absolute inset-0 z-40 bg-white"
                initial={{ opacity: 0.9 }}
                animate={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              />
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* remote controls */}
      <div className="flex items-center gap-2.5">
        <Control icon={Power} label="Wake / Lock" onClick={toggleWake} active={!awake} />
        <Control icon={Circle} label="Home" onClick={home} />
        <Control icon={Camera} label="Screenshot" onClick={screenshot} />
      </div>
    </div>
  )
}

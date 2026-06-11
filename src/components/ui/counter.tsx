import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { EXPO_OUT } from '@/lib/motion'
import { cn } from '@/lib/utils'

/** One odometer digit — rolls vertically when its value changes. */
function Digit({ char }: { char: string }) {
  return (
    <span
      className="relative inline-block overflow-hidden align-baseline"
      style={{ height: '1em', width: '0.62em' }}
    >
      <AnimatePresence initial={false}>
        <motion.span
          key={char}
          initial={{ y: '110%' }}
          animate={{ y: '0%' }}
          exit={{ y: '-110%' }}
          transition={{ duration: 0.3, ease: EXPO_OUT }}
          className="absolute inset-0 flex items-center justify-center"
        >
          {char}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

export interface CounterProps {
  value: number
  /** Format the raw number into a display string (default: locale integer). */
  format?: (value: number) => string
  className?: string
}

/**
 * Monospace telemetry counter. Digits roll on change (mission-control feel);
 * separators stay put. Falls back to static text under reduced-motion.
 */
export function Counter({ value, format, className }: CounterProps) {
  const reduce = useReducedMotion()
  const text = format ? format(value) : value.toLocaleString('en-US')

  if (reduce) {
    return <span className={cn('mono tabular-nums', className)}>{text}</span>
  }

  return (
    <span className={cn('mono inline-flex tabular-nums', className)} aria-label={text}>
      {text.split('').map((char, i) =>
        /\d/.test(char) ? (
          <Digit key={i} char={char} />
        ) : (
          <span key={i} className="inline-block">
            {char}
          </span>
        ),
      )}
    </span>
  )
}

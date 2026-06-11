import { useEffect, useRef } from 'react'
import type { LogLevel, LogLine } from '@/hooks/use-device-log'
import { cn } from '@/lib/utils'

const LEVEL_COLOR: Record<LogLevel, string> = {
  info: 'text-fg-secondary',
  ok: 'text-status-online',
  warn: 'text-status-warming',
  error: 'text-status-error',
}

const LEVEL_TAG: Record<LogLevel, string> = {
  info: 'INFO',
  ok: ' OK ',
  warn: 'WARN',
  error: 'ERR ',
}

/** Auto-scrolling monospace telemetry log. */
export function LogStream({ lines }: { lines: LogLine[] }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  return (
    <div ref={ref} className="h-full overflow-y-auto px-4 py-3">
      <div className="space-y-[3px]">
        {lines.map((l) => (
          <div key={l.id} className="flex gap-2.5 font-mono text-[11px] leading-relaxed">
            <span className="shrink-0 text-fg-muted">{l.t}</span>
            <span className={cn('shrink-0 tracking-wide', LEVEL_COLOR[l.level])}>
              {LEVEL_TAG[l.level]}
            </span>
            <span className="break-all text-fg-secondary">{l.text}</span>
          </div>
        ))}
        {lines.length === 0 && (
          <div className="font-mono text-[11px] text-fg-muted">awaiting stream…</div>
        )}
      </div>
    </div>
  )
}

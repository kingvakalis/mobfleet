import type { DeviceApp } from '@/services/device-commands'

/**
 * ONE installed app per row — the SHARED row used by both the Phone Control Apps tab and the Fleet
 * device drawer so the two surfaces are identical:
 *   [icon] [full app name — truncates with a tooltip] [Launch] [Stop]
 * Stable height (no layout shift), fixed-size icon, the name takes the remaining width, the actions
 * stay right-aligned. Launch/Stop are RBAC-gated and show truthful in-flight states; the parent owns
 * the real launch/terminate command logic (this is presentation only). React key = canonical bundleId.
 */
export function AppRow({ app, canControl, launching, stopping, onLaunch, onStop }: {
  app: DeviceApp
  canControl: boolean
  launching: boolean
  stopping: boolean
  onLaunch: () => void
  onStop: () => void
}) {
  return (
    <div className="flex h-10 items-center gap-2.5 border-b border-white/[0.06] px-1 last:border-b-0">
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[9px] font-bold text-white"
        style={{ background: app.iconColor ?? '#3a3a40' }}
        aria-hidden
      >
        {app.abbr ?? app.name.slice(0, 2)}
      </div>
      <span className="min-w-0 flex-1 truncate text-[12px] text-white/80" title={app.name}>{app.name}</span>
      <button
        type="button"
        onClick={onLaunch}
        disabled={!canControl || launching}
        title={canControl ? `Launch ${app.name}` : 'Requires control permission'}
        className="shrink-0 rounded px-2 py-1 text-[11px] text-[#2dd4bf] transition-colors enabled:hover:text-[#5eead4] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {launching ? 'Launching…' : 'Launch'}
      </button>
      <button
        type="button"
        onClick={onStop}
        disabled={!canControl || stopping}
        title={canControl ? `Stop ${app.name}` : 'Requires control permission'}
        className="shrink-0 rounded px-2 py-1 text-[11px] text-white/45 transition-colors enabled:hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {stopping ? 'Stopping…' : 'Stop'}
      </button>
    </div>
  )
}

/** The orchestrator core glyph: a hairline ring + crosshair + accent core. */
export function OrchestratorMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className="shrink-0"
    >
      <circle cx="12" cy="12" r="9" stroke="var(--border)" strokeWidth="1" />
      <circle cx="12" cy="12" r="5.5" stroke="var(--text-muted)" strokeWidth="0.75" />
      {/* crosshair ticks */}
      <path d="M12 0.5V4 M12 20v3.5 M0.5 12H4 M20 12h3.5" stroke="var(--border)" strokeWidth="1" />
      <circle cx="12" cy="12" r="2.4" fill="var(--accent)" />
    </svg>
  )
}

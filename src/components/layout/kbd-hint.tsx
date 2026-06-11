/** Keyboard-shortcut hint pill — opens the command palette when clicked. */
export function KbdHint({ keys, onClick }: { keys: string[]; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open command palette"
      className="hidden items-center gap-1 rounded-control border border-line bg-panel px-2 py-1 transition-colors hover:bg-elevated md:flex"
    >
      {keys.map((k, i) => (
        <kbd key={i} className="mono text-[11px] leading-none text-fg-muted">
          {k}
        </kbd>
      ))}
    </button>
  )
}

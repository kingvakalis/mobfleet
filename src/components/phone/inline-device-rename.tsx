import { useRef, useState, type ReactNode } from 'react'
import { Check, X, Pencil } from 'lucide-react'
import { renameDevice, validateDeviceName, MAX_DEVICE_NAME } from '@/services/devices'

/**
 * Shared, RBAC-gated inline device rename — used by the Fleet drawer header, the
 * Phones registry row, and the Phone Control header so the UX is identical
 * everywhere. When `canRename` is false it renders the name only (no edit
 * affordance); the backend (rename_device RPC + trigger) enforces the same rule,
 * so a hidden control can never be a security gap.
 *
 * UX: pencil → inline input. Enter saves, Escape cancels, Save is disabled while
 * invalid/unchanged/saving, a spinner-label shows progress, and a permission/
 * validation/network failure is shown truthfully (the user stays in edit mode).
 * On success the editor closes; the displayed name updates from the live device
 * prop (Supabase Realtime broadcasts the change to every surface).
 */
export function InlineDeviceRename({
  deviceId,
  name,
  canRename,
  display,
  inputClassName,
  editButtonClassName,
}: {
  deviceId: string
  name: string
  canRename: boolean
  /** How to render the name when NOT editing (defaults to the plain truncated name). */
  display?: ReactNode
  inputClassName?: string
  editButtonClassName?: string
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Seed the draft from the CURRENT name when entering edit mode (not via an effect,
  // so a Realtime rename arriving mid-edit can't clobber the user's in-progress text).
  const startEdit = () => { setValue(name); setError(null); setEditing(true) }

  const validation = validateDeviceName(value, name) // null = ok, 'unchanged', or a message
  const canSave = !busy && validation === null

  const save = async () => {
    if (!canSave) return
    setBusy(true)
    setError(null)
    const { error: err } = await renameDevice(deviceId, value)
    setBusy(false)
    if (err) {
      setError(err)
      inputRef.current?.focus()
      return
    }
    setEditing(false)
  }

  if (!editing) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        {display ?? <span className="truncate">{name}</span>}
        {canRename && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); startEdit() }}
            title="Rename device"
            aria-label="Rename device"
            className={editButtonClassName ?? 'shrink-0 text-white/30 transition-colors hover:text-white/70'}
          >
            <Pencil size={12} />
          </button>
        )}
      </span>
    )
  }

  const showError = error ?? (validation && validation !== 'unchanged' ? validation : null)

  return (
    <span className="inline-flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
      <span className="inline-flex items-center gap-1">
        <input
          ref={inputRef}
          value={value}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          maxLength={MAX_DEVICE_NAME + 16}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void save() }
            else if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
          }}
          disabled={busy}
          aria-label="Device name"
          aria-invalid={!!showError}
          className={
            inputClassName ??
            'h-7 min-w-0 flex-1 rounded-control border border-line bg-elevated px-2 text-[12px] text-fg outline-none transition-colors focus:border-[var(--accent-border)] disabled:opacity-50'
          }
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={!canSave}
          title="Save name"
          aria-label="Save name"
          className="shrink-0 rounded p-1 text-[#2dd4bf] transition-colors enabled:hover:text-[#5eead4] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Check size={14} />
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={busy}
          title="Cancel"
          aria-label="Cancel rename"
          className="shrink-0 rounded p-1 text-white/40 transition-colors hover:text-white/80 disabled:opacity-40"
        >
          <X size={14} />
        </button>
      </span>
      {busy && <span className="text-[10px] text-white/40">Saving…</span>}
      {!busy && showError && <span className="text-[10px] text-red-400">{showError}</span>}
    </span>
  )
}

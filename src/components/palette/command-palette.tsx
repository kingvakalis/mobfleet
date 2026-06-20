import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Command } from 'cmdk'
import {
  Boxes,
  Globe,
  Layers,
  LayoutGrid,
  Maximize,
  Minus,
  Plus,
  Search,
  Send,
  Table2,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useScopedDevices } from '@/lib/authorization/use-access'
import { client, safe } from '@/lib/provider'
import { graphBus } from '@/lib/graph-bus'
import { REGIONS, regionLabel } from '@/data/regions'
import { STATUS } from '@/lib/status'
import { useUIStore } from '@/state/ui-store'
import { VIEWS, type ViewId } from '@/lib/views'
import { AUTH_SOURCE } from '@/auth/auth-source'
import { isSupabaseConfigured } from '@/lib/supabase'

// In supabase-mode the palette must not offer navigation to hidden pages, nor the
// mock/HTTP-fleet provisioning actions (provision/retire/scale/fit-graph).
const SUPABASE_MODE = AUTH_SOURCE === 'supabase' && isSupabaseConfigured

const VIEW_ICON: Record<ViewId, LucideIcon> = {
  fleet: LayoutGrid,
  jobs: Table2,
  automations: Zap,
  team:        Globe,
  groups:      Layers,
  phones:      Boxes,
  scale:       Maximize,
  logs:        Minus,
  accounts:    Table2,
  settings:    Minus,
  'phone-control': Minus,
}

function Palette({ onClose }: { onClose: () => void }) {
  // SECURITY: the palette's device list + actions operate on scoped devices only.
  const devices = useScopedDevices()
  const setView = useUIStore((s) => s.setView)
  const view = useUIStore((s) => s.view)
  const openScale = useUIStore((s) => s.openScale)
  const openSubmit = useUIStore((s) => s.openSubmit)
  const openDrawer = useUIStore((s) => s.openDrawer)

  const run = (fn: () => void) => {
    fn()
    onClose()
  }

  const fitGraph = () => {
    if (view !== 'fleet') {
      setView('fleet')
      setTimeout(() => graphBus.fitView?.(), 420)
    } else {
      graphBus.fitView?.()
    }
  }

  const retireIdle = () => {
    const victim =
      devices.find((d) => d.status === 'offline') ??
      devices.find((d) => d.status === 'online')
    if (victim) safe(client.delete(victim.id), 'Could not retire device')
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[14vh]">
      <motion.div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={onClose}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-[560px] max-w-full overflow-hidden rounded-card border border-line bg-panel shadow-[0_28px_70px_-12px_rgba(0,0,0,0.9)]"
        initial={{ opacity: 0, scale: 0.97, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: -6 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      >
        <Command
          label="Command palette"
          className="[&_[cmdk-group-heading]]:label [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-fg-muted"
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
          }}
        >
          <div className="flex items-center gap-2.5 border-b border-line px-4">
            <Search size={15} className="shrink-0 text-fg-muted" />
            <Command.Input
              autoFocus
              placeholder="Search commands & devices…"
              className="h-12 w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted"
            />
          </div>

          <Command.List className="max-h-[360px] overflow-y-auto p-2">
            <Command.Empty className="px-2 py-6 text-center text-sm text-fg-muted">
              No matches.
            </Command.Empty>

            <Command.Group heading="Views">
              {VIEWS.filter((v) => !(SUPABASE_MODE && v.hideInSupabaseMode)).map((v) => (
                <Item
                  key={v.id}
                  icon={VIEW_ICON[v.id]}
                  label={`Go to ${v.label}`}
                  onSelect={() => run(() => setView(v.id))}
                />
              ))}
            </Command.Group>

            {/* Mock/HTTP-fleet actions (fit graph, scale, provision, retire) — hidden in
                supabase-mode where the Fleet/Scale pages and the mock provider are gated. */}
            {!SUPABASE_MODE && (
              <Command.Group heading="Fleet">
                <Item icon={Maximize} label="Fit graph to screen" onSelect={() => run(fitGraph)} />
                <Item icon={Layers} label="Open Scale control" onSelect={() => run(openScale)} />
                <Item
                  icon={Plus}
                  label="Provision 4 devices"
                  hint={regionLabel(REGIONS[0].id)}
                  onSelect={() => run(() => safe(client.createDevices(4, { region: REGIONS[0].id }), 'Could not provision devices'))}
                />
                <Item icon={Minus} label="Retire an idle device" onSelect={() => run(retireIdle)} />
              </Command.Group>
            )}

            <Command.Group heading="Jobs">
              <Item
                icon={Send}
                label="Dispatch a job"
                onSelect={() =>
                  run(() => {
                    setView('jobs')
                    openSubmit()
                  })
                }
              />
            </Command.Group>

            <Command.Group heading="Devices">
              {devices.map((d) => (
                <Command.Item
                  key={d.id}
                  value={`${d.name} ${d.id} ${d.group} ${regionLabel(d.region)} ${d.status}`}
                  onSelect={() => run(() => openDrawer(d.id))}
                  className="flex cursor-pointer items-center gap-3 rounded-control px-2 py-2 text-sm text-fg-secondary data-[selected=true]:bg-elevated data-[selected=true]:text-fg"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: STATUS[d.status].color }}
                  />
                  <span className="text-[13px]">{d.name}</span>
                  <span className="mono text-[11px] text-fg-muted">{d.id.slice(-6)}</span>
                  <span className="label ml-auto text-fg-muted">{d.group}</span>
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>

          <div className="flex items-center gap-4 border-t border-line px-4 py-2.5">
            <Hint k="↑↓" label="navigate" />
            <Hint k="↵" label="select" />
            <Hint k="esc" label="close" />
          </div>
        </Command>
      </motion.div>
    </div>
  )
}

function Item({
  icon: Icon,
  label,
  hint,
  onSelect,
}: {
  icon: typeof Plus
  label: string
  hint?: string
  onSelect: () => void
}) {
  return (
    <Command.Item
      value={label}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-control px-2 py-2 text-sm text-fg-secondary data-[selected=true]:bg-elevated data-[selected=true]:text-fg"
    >
      <Icon size={15} className="shrink-0 text-fg-muted" />
      {label}
      {hint && <span className="label ml-auto text-fg-muted">{hint}</span>}
    </Command.Item>
  )
}

function Hint({ k, label }: { k: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="mono rounded border border-line px-1.5 py-0.5 text-[10px] text-fg-muted">{k}</kbd>
      <span className="label text-fg-muted">{label}</span>
    </span>
  )
}

/** ⌘/Ctrl-K command palette — every action, one keystroke away. */
export function CommandPalette() {
  const open = useUIStore((s) => s.paletteOpen)
  const toggle = useUIStore((s) => s.togglePalette)
  const close = useUIStore((s) => s.closePalette)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  return <AnimatePresence>{open && <Palette onClose={close} />}</AnimatePresence>
}

import { HeaderStrip } from './header-strip'

/** The frame: fixed mission-control header + a single full-bleed view stage. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col bg-canvas">
      <HeaderStrip />
      <main className="relative flex-1 overflow-hidden">{children}</main>
    </div>
  )
}

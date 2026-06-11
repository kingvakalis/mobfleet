import { useEffect, useState } from 'react'
import { Activity, Plus, Power, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Counter } from '@/components/ui/counter'
import { Hairline } from '@/components/ui/hairline'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusDot } from '@/components/ui/status-dot'
import { StatusRing } from '@/components/ui/status-ring'
import { ALL_STATUSES, STATUS } from '@/lib/status'

/* ------------------------------------------------------------------ layout */

function Section({
  index,
  title,
  children,
}: {
  index: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="py-12">
      <div className="mb-6 flex items-center gap-3">
        <span className="label text-fg-muted">{index}</span>
        <Hairline className="w-6 shrink-0" />
        <Label className="text-fg">{title}</Label>
      </div>
      {children}
    </section>
  )
}

function Swatch({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-10 w-10 shrink-0 rounded-control border border-line"
        style={{ background: value }}
      />
      <div className="min-w-0">
        <div className="truncate text-sm text-fg">{name}</div>
        <div className="mono text-xs text-fg-muted">{value}</div>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------- live counters */

function LiveCounters() {
  const [devices, setDevices] = useState(42)
  const [busy, setBusy] = useState(11)
  const [queue, setQueue] = useState(7)
  const [cost, setCost] = useState(12.6)

  useEffect(() => {
    const id = setInterval(() => {
      setDevices((n) => Math.max(0, n + (Math.round(Math.random() * 2) - 1)))
      setBusy((n) => Math.max(0, Math.min(42, n + (Math.round(Math.random() * 2) - 1))))
      setQueue((n) => Math.max(0, n + (Math.round(Math.random() * 2) - 1)))
      setCost((c) => Math.max(0, +(c + (Math.random() - 0.5)).toFixed(2)))
    }, 1600)
    return () => clearInterval(id)
  }, [])

  const items: { label: string; node: React.ReactNode }[] = [
    { label: 'Devices', node: <Counter value={devices} /> },
    { label: 'Busy', node: <Counter value={busy} /> },
    { label: 'Queue Depth', node: <Counter value={queue} /> },
    {
      label: 'Cost / Hr',
      node: <Counter value={cost} format={(n) => `$${n.toFixed(2)}`} />,
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-4">
      {items.map((it) => (
        <div key={it.label} className="bg-panel px-5 py-4">
          <Label className="text-fg-muted">{it.label}</Label>
          <div className="mt-2 text-2xl text-fg">{it.node}</div>
        </div>
      ))}
    </div>
  )
}

/* -------------------------------------------------------------------- page */

export function StyleGuide() {
  return (
    <div className="min-h-full bg-canvas">
      <div className="mx-auto max-w-5xl px-6">
        {/* Masthead */}
        <header className="flex items-baseline justify-between border-b border-line py-8">
          <div>
            <Label className="text-fg-muted">Design System · V0</Label>
            <h1 className="mt-3 text-3xl font-medium tracking-tight text-fg">
              Mission Control
            </h1>
            <p className="mt-1 text-sm text-fg-secondary">
              Tokens &amp; primitives for the cloud-phone control plane.
            </p>
          </div>
          <div className="mono hidden text-right text-xs text-fg-muted sm:block">
            <div>SPACEX × VERCEL</div>
            <div>PURE-BLACK / HAIRLINE / MONO</div>
          </div>
        </header>

        {/* 01 — Surfaces */}
        <Section index="01" title="Surfaces &amp; Borders">
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            <Swatch name="Canvas" value="#000000" />
            <Swatch name="Panel" value="#0A0A0A" />
            <Swatch name="Elevated" value="#141414" />
            <Swatch name="Border" value="#1F1F1F" />
          </div>
        </Section>

        {/* 02 — Text + Accent */}
        <Section index="02" title="Text &amp; Accent">
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            <Swatch name="Primary" value="#FAFAFA" />
            <Swatch name="Secondary" value="#A1A1A1" />
            <Swatch name="Muted" value="#6E6E6E" />
            <Swatch name="Accent" value="#D6E4FF" />
          </div>
        </Section>

        {/* 03 — Status */}
        <Section index="03" title="Status Palette">
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-5">
            {ALL_STATUSES.map((s) => (
              <div key={s} className="flex items-center gap-3">
                <StatusDot status={s} size={10} pulse />
                <div>
                  <div className="label text-fg">{STATUS[s].label}</div>
                  <div className="mono text-xs text-fg-muted">{STATUS[s].color}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* 04 — Typography */}
        <Section index="04" title="Typography">
          <div className="grid gap-8 md:grid-cols-2">
            <Card ticks className="p-6">
              <Label className="text-fg-muted">Geist Sans · UI</Label>
              <div className="mt-4 space-y-2">
                <p className="text-3xl font-medium tracking-tight text-fg">
                  Fleet at a glance
                </p>
                <p className="text-base text-fg-secondary">
                  Crisp, high-contrast monochrome. Generous negative space.
                </p>
                <p className="text-sm text-fg-muted">
                  Body copy in muted grey for secondary information.
                </p>
              </div>
            </Card>
            <Card ticks className="p-6">
              <Label className="text-fg-muted">Geist Mono · Telemetry</Label>
              <div className="mono mt-4 space-y-2 text-sm text-fg">
                <p>ID · ios-7f3a9c2e</p>
                <p>UPTIME · 04:21:07</p>
                <p>REGION · us-east-1 · PROXY · 10.0.4.221</p>
                <p className="label text-fg-secondary">Uppercase Tracking 0.12em</p>
              </div>
            </Card>
          </div>
        </Section>

        {/* 05 — Buttons */}
        <Section index="05" title="Buttons">
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary">Provision</Button>
              <Button variant="outline">Assign Job</Button>
              <Button variant="ghost">Logs</Button>
              <Button variant="accent">
                <Activity size={14} /> Dispatch
              </Button>
              <Button variant="danger">Retire</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" variant="outline">
                Small
              </Button>
              <Button size="md" variant="outline">
                Medium
              </Button>
              <Button size="icon" variant="outline" aria-label="Start">
                <Power size={15} />
              </Button>
              <Button size="icon" variant="ghost" aria-label="Stop">
                <Square size={14} />
              </Button>
              <Button size="icon" variant="primary" aria-label="Add">
                <Plus size={15} />
              </Button>
              <Button variant="outline" disabled>
                Disabled
              </Button>
            </div>
          </div>
        </Section>

        {/* 06 — Live counters */}
        <Section index="06" title="Telemetry Counters">
          <LiveCounters />
          <p className="mt-3 text-xs text-fg-muted">
            Digits roll on change · respects prefers-reduced-motion
          </p>
        </Section>

        {/* 07 — Status rings (node preview) */}
        <Section index="07" title="Status Rings · Node Preview">
          <div className="flex flex-wrap gap-8">
            {ALL_STATUSES.map((s) => (
              <div key={s} className="flex flex-col items-center gap-3">
                <StatusRing status={s}>
                  <span className="mono text-[9px] text-fg-secondary">ios</span>
                </StatusRing>
                <span className="label text-fg-muted">{STATUS[s].label}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* 08 — Cards + skeleton */}
        <Section index="08" title="Cards &amp; Loading">
          <div className="grid gap-6 md:grid-cols-3">
            <Card className="p-5">
              <Label className="text-fg-muted">Panel</Label>
              <p className="mt-3 text-sm text-fg-secondary">
                Flat panel surface, 1px hairline, 10px radius.
              </p>
            </Card>
            <Card ticks elevated className="p-5">
              <Label className="text-fg-muted">Elevated · HUD</Label>
              <p className="mt-3 text-sm text-fg-secondary">
                Raised surface with corner ticks for framing.
              </p>
            </Card>
            <Card className="space-y-3 p-5">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="mt-2 h-16 w-full" />
            </Card>
          </div>
        </Section>

        <footer className="border-t border-line py-8">
          <Label className="text-fg-muted">End of system · V0</Label>
        </footer>
      </div>
    </div>
  )
}

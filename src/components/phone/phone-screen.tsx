import { Power, TriangleAlert } from 'lucide-react'
import { regionLabel } from '@/data/regions'
import { STATUS } from '@/lib/status'
import type { Device, Job } from '@/lib/provider/types'

function clock(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

/** iOS-style status bar. */
function StatusBar() {
  return (
    <div className="flex items-center justify-between px-3 pt-2 text-fg">
      <span className="mono text-[10px]">{clock()}</span>
      <div className="flex items-center gap-1">
        {/* signal */}
        <div className="flex items-end gap-[1px]">
          {[3, 5, 7, 9].map((h) => (
            <div key={h} className="w-[2px] rounded-[1px] bg-fg" style={{ height: h }} />
          ))}
        </div>
        {/* battery */}
        <div className="ml-0.5 flex h-[8px] w-[15px] items-center rounded-[2px] border border-fg/60 p-[1px]">
          <div className="h-full w-2/3 rounded-[1px] bg-fg" />
        </div>
      </div>
    </div>
  )
}

function uploadStep(p: number): string {
  if (p < 0.12) return 'PREPARING'
  if (p < 0.5) return 'ENCODING'
  if (p < 0.9) return 'UPLOADING'
  return 'PUBLISHING'
}

/** The automation app, foregrounded while a job runs. */
function UploadApp({ device, job }: { device: Device; job: Job }) {
  const color = STATUS[device.status].color
  const pct = Math.round(job.progress * 100)
  return (
    <div className="flex h-full flex-col">
      <StatusBar />
      <div className="flex items-center gap-2 px-4 pt-3">
        <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
        <span className="label text-fg">{job.type}</span>
        <span className="label ml-auto text-fg-muted">{uploadStep(job.progress)}</span>
      </div>

      {/* content thumbnail */}
      <div className="mx-4 mt-3 aspect-[4/5] overflow-hidden rounded-[8px] border border-line">
        <div className="h-full w-full bg-gradient-to-br from-[#1a1a1f] via-[#101015] to-[#0a0a0a]" />
      </div>
      {/* caption */}
      <div className="mx-4 mt-3 space-y-1.5">
        <div className="h-1.5 w-3/4 rounded-full bg-white/10" />
        <div className="h-1.5 w-1/2 rounded-full bg-white/[0.07]" />
      </div>

      <div className="mt-auto px-4 pb-5">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="mono text-[10px] text-fg-muted">{job.id}</span>
          <span className="mono text-[11px] text-fg">{pct}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full transition-[width] duration-500 ease-expo-out" style={{ width: `${pct}%`, background: color }} />
        </div>
      </div>
    </div>
  )
}

/** Idle lock screen. */
function LockScreen({ device }: { device: Device }) {
  return (
    <div className="flex h-full flex-col">
      <StatusBar />
      <div className="flex flex-1 flex-col items-center justify-center gap-1">
        <div className="mono text-4xl font-light tracking-tight text-fg">{clock()}</div>
        <div className="label text-fg-muted">{regionLabel(device.region)}</div>
      </div>
      <div className="flex flex-col items-center gap-2 pb-5">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS.online.color }} />
          <span className="label text-fg-secondary">Ready</span>
        </div>
        <div className="h-1 w-16 rounded-full bg-white/15" />
      </div>
    </div>
  )
}

function BootScreen({ device }: { device: Device }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5">
      <div className="h-9 w-9 rounded-full border border-fg/30" />
      <div className="flex flex-col items-center gap-2">
        <span className="label text-fg-secondary">Booting</span>
        <span className="mono text-[9px] text-fg-muted">{device.osVersion}</span>
      </div>
      <div className="h-1 w-20 overflow-hidden rounded-full bg-white/10">
        <div className="h-full w-1/2 rounded-full bg-fg/40" />
      </div>
    </div>
  )
}

function ErrorScreen() {
  const color = STATUS.error.color
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3" style={{ background: 'rgba(248,81,73,0.06)' }}>
      <TriangleAlert size={22} style={{ color }} />
      <span className="label" style={{ color }}>Agent Unreachable</span>
      <span className="mono text-[9px] text-fg-muted">retrying connection…</span>
    </div>
  )
}

function OffScreen({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-black">
      <Power size={20} className="text-fg-muted" />
      <span className="label text-fg-muted">{label}</span>
    </div>
  )
}

/** Live device screen, driven by status + job. */
export function PhoneScreen({
  device,
  job,
  awake = true,
}: {
  device: Device
  job?: Job | null
  awake?: boolean
}) {
  if (!awake) return <OffScreen label="Locked" />
  switch (device.status) {
    case 'offline':
      return <OffScreen label="Powered Off" />
    case 'warming':
      return <BootScreen device={device} />
    case 'error':
      return <ErrorScreen />
    case 'busy':
      return job ? <UploadApp device={device} job={job} /> : <LockScreen device={device} />
    case 'online':
      return <LockScreen device={device} />
  }
}

import { Label } from '@/components/ui/label'
import { StatusDot } from '@/components/ui/status-dot'

/** Stream-alive readout — the data feed is pushing live updates. */
export function LiveIndicator() {
  return (
    <div className="flex items-center gap-2" title="Live device & job stream">
      <StatusDot status="online" size={7} pulse />
      <Label className="text-fg-secondary">LIVE</Label>
    </div>
  )
}

import type { Employee, ShiftRecord } from '@/services/team'

/**
 * Shared date-range model for the Team page. Every widget (KPIs, table,
 * employee drawer) computes from the SAME DateRange so boundaries never
 * disagree. All boundaries use the operator's local timezone consistently
 * (exposed via `tzName` for display).
 *
 * BACKEND INTEGRATION POINT: when the server aggregates shifts, these
 * helpers become the client-side contract — queries should accept
 * { startDate, endDate, timezone, employeeId? } and return PeriodStats.
 */

export type RangeKey = 'today' | 'yesterday' | '14d' | '30d' | 'custom'

export interface DateRange {
  start: number
  end: number
  label: string
}

export const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '14d', label: 'Last 14 Days' },
  { key: '30d', label: 'Last 30 Days' },
  { key: 'custom', label: 'Custom' },
]

export const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone

const DAY = 86_400_000

function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function rangeFor(key: RangeKey, now: number, custom?: { start: string; end: string }): DateRange {
  const todayStart = startOfDay(now)
  switch (key) {
    case 'today':
      return { start: todayStart, end: now, label: 'Today' }
    case 'yesterday':
      return { start: todayStart - DAY, end: todayStart - 1, label: 'Yesterday' }
    case '14d':
      // Rolling 14 calendar days including today.
      return { start: startOfDay(now - 13 * DAY), end: now, label: 'Last 14 days' }
    case '30d':
      return { start: startOfDay(now - 29 * DAY), end: now, label: 'Last 30 days' }
    case 'custom': {
      const s = custom?.start ? startOfDay(new Date(custom.start + 'T00:00:00').getTime()) : todayStart
      const eDay = custom?.end ? startOfDay(new Date(custom.end + 'T00:00:00').getTime()) : todayStart
      const e = Math.min(eDay + DAY - 1, now)
      return { start: s, end: Math.max(e, s), label: `${custom?.start ?? ''} → ${custom?.end ?? ''}` }
    }
  }
}

/** The equal-length period immediately before `range` (for comparisons). */
export function previousRange(range: DateRange): DateRange {
  const len = range.end - range.start
  return { start: range.start - len - 1, end: range.start - 1, label: 'previous period' }
}

export interface PeriodStats {
  hoursMs: number
  activeMs: number
  breakMs: number
  shifts: number
  phonesUsed: number
  jobs: number
  actions: number
}

const EMPTY: PeriodStats = { hoursMs: 0, activeMs: 0, breakMs: 0, shifts: 0, phonesUsed: 0, jobs: 0, actions: 0 }

function overlap(start: number, end: number, range: DateRange): number {
  const s = Math.max(start, range.start)
  const e = Math.min(end, range.end)
  return Math.max(0, e - s)
}

/** Shift records + the live in-progress shift, viewed through a date range. */
export function periodStats(e: Employee, range: DateRange, now: number): PeriodStats {
  const acc = { ...EMPTY }
  const phones = new Set<string>()

  const addRecord = (r: ShiftRecord, liveBreakMs = 0) => {
    const end = r.end ?? now
    const ov = overlap(r.start, end, range)
    if (ov <= 0) return
    acc.hoursMs += ov
    // Breaks prorated by the covered fraction of the shift.
    const total = Math.max(1, end - r.start)
    const breakMs = (r.breakMinutes * 60_000 + liveBreakMs) * (ov / total)
    acc.breakMs += breakMs
    acc.shifts += 1
    for (const s of r.sessions) {
      const sOv = overlap(s.start, s.end ?? now, range)
      if (sOv <= 0) continue
      phones.add(s.phoneName)
      acc.jobs += s.jobsPerformed
      acc.actions += s.actions
    }
  }

  for (const r of e.history) addRecord(r)

  // Live shift counts whenever the range includes "now".
  if (e.shiftStart && range.end >= now - 1000) {
    addRecord(
      {
        date: '',
        start: e.shiftStart,
        end: null,
        breakMinutes: e.breakMinutesToday,
        sessions: e.currentPhone && e.currentSessionStart
          ? [{ phoneName: e.currentPhone, start: e.currentSessionStart, end: null, jobsPerformed: 0, actions: 0 }]
          : [],
      },
      e.breakStart ? now - e.breakStart : 0,
    )
  }

  acc.activeMs = Math.max(0, acc.hoursMs - acc.breakMs)
  acc.phonesUsed = phones.size
  return acc
}

export function sumStats(list: PeriodStats[]): PeriodStats {
  const acc = { ...EMPTY }
  for (const s of list) {
    acc.hoursMs += s.hoursMs
    acc.activeMs += s.activeMs
    acc.breakMs += s.breakMs
    acc.shifts += s.shifts
    acc.phonesUsed += s.phonesUsed
    acc.jobs += s.jobs
    acc.actions += s.actions
  }
  return acc
}

/** Restrained comparison vs the previous equal-length period. */
export function deltaPct(current: number, previous: number): number | null {
  if (previous <= 0) return null
  return ((current - previous) / previous) * 100
}

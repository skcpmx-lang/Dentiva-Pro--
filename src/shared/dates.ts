/**
 * Date/time strategy (AD-004):
 * - System timestamps: UTC ISO-8601 strings.
 * - Business dates: local calendar dates as YYYY-MM-DD strings.
 * - Default clinic timezone: Asia/Dhaka (configurable in settings).
 */

export const DEFAULT_TIMEZONE = 'Asia/Dhaka'

const dhakaFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: DEFAULT_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit'
})
const dhakaTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: DEFAULT_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false
})

/** Current calendar date (YYYY-MM-DD) in Asia/Dhaka. */
export function todayISO(now: Date = new Date()): string {
  return dhakaFormatter.format(now)
}

/** Current wall-clock time (HH:mm) in Asia/Dhaka. */
export function nowTimeISO(now: Date = new Date()): string {
  return dhakaTimeFormatter.format(now)
}

export function nowUTCISO(now: Date = new Date()): string {
  return now.toISOString()
}

export function isValidDateStr(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export function isValidTimeStr(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
}

/** Days between two YYYY-MM-DD dates (b - a). */
export function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime()
  const db = new Date(`${b}T00:00:00Z`).getTime()
  return Math.round((db - da) / 86400000)
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Resolve a range preset to {from, to} inclusive local dates. */
export function resolveRange(
  preset: 'today' | '7d' | '30d' | '90d' | '1y' | 'all' | 'custom',
  custom?: { from?: string; to?: string },
  now: Date = new Date()
): { from: string | null; to: string } {
  const today = todayISO(now)
  switch (preset) {
    case 'today': return { from: today, to: today }
    case '7d': return { from: addDays(today, -6), to: today }
    case '30d': return { from: addDays(today, -29), to: today }
    case '90d': return { from: addDays(today, -89), to: today }
    case '1y': return { from: addDays(today, -364), to: today }
    case 'all': return { from: null, to: today }
    case 'custom': {
      if (custom?.from && custom?.to && isValidDateStr(custom.from) && isValidDateStr(custom.to) && custom.from <= custom.to) {
        return { from: custom.from, to: custom.to }
      }
      return { from: today, to: today }
    }
  }
}

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-09-30" -> "30 Sep 2026" */
export function formatDateHuman(d: string | null | undefined): string {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${Number(day)} ${MONTHS_SHORT[Number(m) - 1]} ${y}`
}

/** "14:30" -> "2:30 PM" */
export function formatTimeHuman(t: string | null | undefined): string {
  if (!t) return '—'
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

export function formatDateTimeHuman(dateIsoUtc: string | null | undefined): string {
  if (!dateIsoUtc) return '—'
  const d = new Date(dateIsoUtc)
  const local = new Intl.DateTimeFormat('en-GB', {
    timeZone: DEFAULT_TIMEZONE, day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true
  })
  return local.format(d)
}

export function ageFromDob(dob: string, today: string = todayISO()): number | null {
  if (!isValidDateStr(dob)) return null
  const [by, bm, bd] = dob.split('-').map(Number)
  const [ty, tm, td] = today.split('-').map(Number)
  let age = ty - by
  if (tm < bm || (tm === bm && td < bd)) age -= 1
  return age >= 0 ? age : null
}

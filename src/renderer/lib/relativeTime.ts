/**
 * Format a timestamp as a compact relative-time string for the sidebar.
 *
 * Output rules:
 *   <60s    → "now"
 *   <60m    → "Nm"
 *   <24h    → "Nh"
 *   <7d     → "Nd"
 *   <5w     → "Nw"
 *   else    → short date like "Mar 4" (locale-aware via Intl)
 *
 * @param date  A Date, ISO string, or epoch ms number.
 * @param now   Reference "now" timestamp in ms. Defaults to `Date.now()`.
 */
export function formatRelative(
  date: Date | string | number,
  now: number = Date.now(),
): string {
  const ts = toMillis(date)
  if (ts === null) return ''

  const diffMs = Math.max(0, now - ts)
  const seconds = Math.floor(diffMs / 1000)

  if (seconds < 60) return 'now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`

  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w`

  return shortDate(ts)
}

function toMillis(date: Date | string | number): number | null {
  if (date instanceof Date) {
    const ms = date.getTime()
    return Number.isFinite(ms) ? ms : null
  }
  if (typeof date === 'number') {
    return Number.isFinite(date) ? date : null
  }
  if (typeof date === 'string') {
    const ms = Date.parse(date)
    return Number.isFinite(ms) ? ms : null
  }
  return null
}

function shortDate(ts: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
    }).format(new Date(ts))
  } catch {
    const d = new Date(ts)
    return `${d.getMonth() + 1}/${d.getDate()}`
  }
}

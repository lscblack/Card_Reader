const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const dtf = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const dtfFull = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' })
const df = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
const nf = new Intl.NumberFormat()

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'Never'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const diff = (t - now) / 1000
  const abs = Math.abs(diff)
  if (abs < 45) return 'just now'
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['minute', 60],
    ['hour', 3600],
    ['day', 86400],
    ['week', 604800],
    ['month', 2592000],
    ['year', 31536000],
  ]
  let chosen: [Intl.RelativeTimeFormatUnit, number] = units[0]
  for (const u of units) if (abs >= u[1]) chosen = u
  return rtf.format(Math.round(diff / chosen[1]), chosen[0])
}

/** A length of time in plain words: "45s", "3 min 20s", "2 hours 14 min", "3 days 4 hours", "2 months", "2 years". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`
  if (s < 60) return `${s}s`
  const min = Math.floor(s / 60)
  if (min < 60) return s % 60 ? `${min} min ${s % 60}s` : `${min} min`
  const hours = Math.floor(min / 60)
  if (hours < 24) return min % 60 ? `${plural(hours, 'hour')} ${min % 60} min` : plural(hours, 'hour')
  const days = Math.floor(hours / 24)
  if (days < 30) return hours % 24 ? `${plural(days, 'day')} ${plural(hours % 24, 'hour')}` : plural(days, 'day')
  if (days < 365) return plural(Math.floor(days / 30), 'month')
  return plural(Math.floor(days / 365), 'year')
}

export function dateTime(iso: string | null | undefined, withSeconds = false): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : (withSeconds ? dtfFull : dtf).format(d)
}

export function dateOnly(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : df.format(d)
}

export function num(n: number | null | undefined): string {
  return n == null ? '—' : nf.format(n)
}

export function compact(n: number | null | undefined): string {
  if (n == null) return '—'
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

export function percent(ratio: number | null | undefined, digits = 1): string {
  if (ratio == null || Number.isNaN(ratio)) return '—'
  return `${(ratio * 100).toFixed(digits)}%`
}

export function money(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100)
}

/** Display a key as `nfc_XXXXXXXX…abcd`. */
export function maskedKey(prefix: string, last4: string): string {
  return `${prefix}…${last4}`
}

export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id
}

/** Human wording for well-known delivery error codes (e.g. allowlist blocks, contract §7.1). */
export function deliveryError(error: string | null | undefined): { text: string; blocked: boolean } | null {
  if (!error) return null
  if (error === 'domain_not_allowed') {
    return { text: 'Blocked — endpoint host is not in the application’s allowed domains. It was not contacted.', blocked: true }
  }
  return { text: error, blocked: false }
}

/** Human file size (e.g. "18.4 MB"). */
export function formatBytes(n: number | null | undefined): string {
  if (!n) return '—'
  const mb = n / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(n / 1024)} KB`
}

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

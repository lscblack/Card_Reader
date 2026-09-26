import type { Price } from '@/business/api/types'
import { API_BASE_URL } from '@/api/client'
import { safeImageUrl } from '@/lib/url'

/** Safe image src for page content; `/media/…` uploads are served by the API origin. */
export function imgSrc(v: string | null | undefined): string | null {
  if (typeof v === 'string' && v.startsWith('/media/')) return safeImageUrl(`${API_BASE_URL}${v}`)
  return safeImageUrl(v)
}

/** Formats a price: numbers with the section currency (ISO code or symbol), strings as written. */
export function formatPrice(price: Price | null | undefined, currency?: string | null): string | null {
  if (price == null || price === '') return null
  if (typeof price === 'string') return price
  const cur = (currency ?? '').trim()
  const whole = Number.isInteger(price)
  if (/^[A-Z]{3}$/.test(cur)) {
    try {
      const noDecimals = ['RWF', 'UGX', 'JPY', 'KRW', 'XOF', 'XAF', 'TZS', 'KES'].includes(cur) || whole
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, minimumFractionDigits: noDecimals ? 0 : 2, maximumFractionDigits: noDecimals ? 0 : 2 }).format(price)
    } catch {
      /* unknown code */
    }
  }
  const n = price.toFixed(whole ? 0 : 2)
  return cur ? `${cur}${cur.length > 1 ? ' ' : ''}${n}` : n
}

const dateOnly = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

/** Parses an ISO date or date-time. Date-only values mean the END of that day (local). */
export function parseWhen(s: string | null | undefined, endOfDay = false): Date | null {
  if (!s) return null
  const d = dateOnly(s) ? new Date(`${s}T${endOfDay ? '23:59:59' : '00:00:00'}`) : new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

export const fmtDate = (d: Date, opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) =>
  new Intl.DateTimeFormat(undefined, opts).format(d)
export const fmtTime = (d: Date) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d)

/** Replaces {{business.*}} placeholders (used for template previews; the server does it on create). */
export function fillPlaceholders<T>(value: T, b: { name?: string | null; phone?: string | null; email?: string | null; website?: string | null; address?: string | null }): T {
  const vals: Record<string, string> = { name: b.name ?? '', phone: b.phone ?? '', email: b.email ?? '', website: b.website ?? '', address: b.address ?? '' }
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v.replace(/\{\{\s*business\.(name|phone|email|website|address)\s*\}\}/g, (_, k: string) => vals[k] ?? '')
    if (Array.isArray(v)) return v.map(walk).filter((x) => !(x && typeof x === 'object' && 'url' in x && (x as { url: unknown }).url === ''))
    if (v && typeof v === 'object') {
      const o = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) as Record<string, unknown>
      if (o.cta && typeof o.cta === 'object' && !(o.cta as { url?: string }).url) delete o.cta
      return o
    }
    return v
  }
  return walk(value) as T
}

const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

/** A standards-compliant single-event .ics file as a data: URL (no server round trip). */
export function icsDataUrl(ev: { title: string; starts_at: string; ends_at?: string | null; venue?: string; address?: string; description?: string }, url: string): string | null {
  const start = parseWhen(ev.starts_at)
  if (!start) return null
  const end = parseWhen(ev.ends_at ?? null) ?? new Date(start.getTime() + 2 * 3600_000)
  const loc = [ev.venue, ev.address].filter(Boolean).join(', ')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Nexventures//nexTap//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${icsDate(start)}-${Math.abs(hash(ev.title + url))}@nextap`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(ev.title)}`,
    ...(loc ? [`LOCATION:${icsText(loc)}`] : []),
    ...(ev.description ? [`DESCRIPTION:${icsText(ev.description)}`] : []),
    `URL:${url}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join('\r\n') + '\r\n')}`
}

function hash(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h
}

/** Android/iOS camera-compatible Wi-Fi QR payload (special chars escaped). */
export function wifiPayload(ssid: string, password: string | null | undefined, security: string, hidden?: boolean | null) {
  const esc = (s: string) => s.replace(/([\\;,:"])/g, '\\$1')
  return `WIFI:T:${security === 'nopass' ? 'nopass' : security};S:${esc(ssid)};${password && security !== 'nopass' ? `P:${esc(password)};` : ''}${hidden ? 'H:true;' : ''};`
}

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
export const PHONE_RE = /^\+?[0-9][0-9 ()\-.]{4,24}$/

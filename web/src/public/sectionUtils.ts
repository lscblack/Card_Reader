import type { Action, HoursRow, SectionDataMap, SectionType } from '@/business/api/types'

/** Accepts both `{ type, data: {...} }` and the flat `{ type, ...fields }` section shapes. */
export function sectionData<K extends SectionType>(s: { type: K } & Partial<SectionDataMap[K]>): SectionDataMap[K] {
  const x = s as unknown as { data?: SectionDataMap[K] } & SectionDataMap[K]
  return (x.data && typeof x.data === 'object' ? x.data : x) as SectionDataMap[K]
}

/** Readable text colour for a background hex. */
export function onColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return '#ffffff'
  const n = parseInt(m[1], 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return L > 0.45 ? '#111111' : '#ffffff'
}

export const DEFAULT_ACCENT = '#b91c1c'

export function safeAccent(hex: string | null | undefined): string {
  return hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex : DEFAULT_ACCENT
}

export function waLink(phone: string, text?: string) {
  return `https://wa.me/${phone.replace(/\D/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`
}

export function mapsLink(query: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

/** Best-effort link for a profile button action (public pages can't call the preview API). */
export function actionHref(a: Action, businessSlug: string): string | null {
  const c = a.config ?? {}
  const s = (k: string) => (typeof c[k] === 'string' && c[k] ? String(c[k]) : null)
  switch (a.type) {
    case 'website':
    case 'custom_url':
    case 'social':
      return s('url')
    case 'digital_menu':
    case 'product_info':
      return s('url')
    case 'whatsapp':
      return s('phone') ? waLink(s('phone')!, s('message') ?? undefined) : null
    case 'phone_call':
      return s('phone') ? `tel:${s('phone')}` : null
    case 'email': {
      const qs = [s('subject') && `subject=${encodeURIComponent(s('subject')!)}`, s('body') && `body=${encodeURIComponent(s('body')!)}`].filter(Boolean).join('&')
      return s('to') ? `mailto:${s('to')}${qs ? `?${qs}` : ''}` : null
    }
    case 'maps':
      return s('query') ? mapsLink(s('query')!) : c.lat != null && c.lng != null ? mapsLink(`${c.lat},${c.lng}`) : null
    case 'business_profile':
      return `/b/${businessSlug}`
    default:
      return null
  }
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

export function todayRow(rows: HoursRow[]): HoursRow | null {
  const d = DAYS[new Date().getDay()]
  return rows.find((r) => r.day.toLowerCase().startsWith(d.slice(0, 3))) ?? null
}

export function isOpenNow(rows: HoursRow[]): boolean | null {
  const r = todayRow(rows)
  if (!r) return null
  if (r.closed) return false
  const now = new Date()
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  return r.open <= hm && hm < r.close
}

import type { Tone } from '@/components/ui/Badge'
import type { AnalyticsRange, BusinessPlanRef, CardTap, EffectiveStatus, TapResult } from '../api/types'

export function toList<T>(data: T[] | { items: T[] } | undefined | null): T[] {
  if (!data) return []
  return Array.isArray(data) ? data : (data.items ?? [])
}

export function planName(p: BusinessPlanRef | undefined): string {
  if (!p) return 'Starter'
  if (typeof p === 'string') return PLAN_NAMES[p] ?? p
  return p.name ?? PLAN_NAMES[p.code] ?? p.code
}
const PLAN_NAMES: Record<string, string> = { biz_starter: 'Starter', biz_growth: 'Growth', biz_enterprise: 'Enterprise' }

/** `04A1B2C3D4E5` → `04••••••E5`. Used only when the server didn't supply `uid_masked`. */
export function maskUid(uid: string | null | undefined): string {
  if (!uid) return '—'
  if (uid.length <= 6) return uid
  return `${uid.slice(0, 2)}${'•'.repeat(Math.min(8, uid.length - 4))}${uid.slice(-2)}`
}

export const EFFECTIVE_STATUS: Record<EffectiveStatus, { label: string; tone: Tone; hint: string }> = {
  active: { label: 'Active', tone: 'success', hint: 'Taps run the configured action.' },
  inactive: { label: 'Inactive', tone: 'neutral', hint: 'Deactivated — taps show a neutral page.' },
  inactive_owner: { label: 'Owner inactive', tone: 'warning', hint: 'The assigned employee is deactivated, so this card is disabled.' },
  unassigned: { label: 'Unassigned', tone: 'info', hint: 'Not assigned to anyone yet. Taps fall back to the business action.' },
  business_suspended: { label: 'Suspended', tone: 'danger', hint: 'The business is suspended.' },
}

export const TAP_RESULT: Record<TapResult, { label: string; tone: Tone }> = {
  redirected: { label: 'Redirected', tone: 'success' },
  page: { label: 'Page shown', tone: 'success' },
  vcard: { label: 'Contact saved', tone: 'success' },
  webhook: { label: 'Webhook', tone: 'info' },
  inactive: { label: 'Inactive', tone: 'warning' },
  unknown_card: { label: 'Unknown card', tone: 'neutral' },
}

export const DEVICE_TYPE_LABEL: Record<string, string> = { ios: 'iOS', android: 'Android', desktop: 'Desktop', other: 'Other' }

export const ACTION_LABELS: Record<string, string> = {
  website: 'Website',
  custom_url: 'Custom URL',
  business_profile: 'Business profile',
  employee_profile: 'Employee profile',
  profile: 'Custom profile',
  share_contact: 'Share contact',
  whatsapp: 'WhatsApp',
  phone_call: 'Phone call',
  ussd: 'USSD code',
  email: 'Email',
  maps: 'Maps / directions',
  social: 'Social profile',
  digital_menu: 'Digital menu',
  product_info: 'Product info',
  wifi: 'Wi-Fi',
  developer_webhook: 'Developer webhook',
}

export function actionLabel(type: string | null | undefined): string {
  if (!type) return 'Default'
  return ACTION_LABELS[type] ?? type.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

let regionNames: Intl.DisplayNames | null = null
export function countryName(code: string | null | undefined): string {
  if (!code) return '—'
  try {
    regionNames ??= new Intl.DisplayNames(undefined, { type: 'region' })
    return regionNames.of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}

export function tapAssigneeLabel(t: CardTap): string {
  return t.assignee ? t.assignee.name : '—'
}

/** Percentage change vs previous period; null when not computable. */
export function delta(current: number, previous: number | null | undefined): number | null {
  if (previous == null) return null
  if (previous === 0) return current === 0 ? 0 : null
  return (current - previous) / previous
}

/** Loose E.164 normalisation helper: keeps digits and a leading +. */
export function normalizePhone(v: string): string {
  const t = v.trim()
  const plus = t.startsWith('+') || t.startsWith('00')
  const digits = t.replace(/^00/, '').replace(/\D/g, '')
  return (plus ? '+' : '') + digits
}

export function isE164(v: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(v)
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase() || '?'
}

export function slugify(v: string): string {
  return v
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

export const SLUG_RE = /^[a-z0-9-]{3,48}$/

export const SOCIAL_PLATFORMS = ['linkedin', 'instagram', 'facebook', 'x', 'tiktok', 'youtube', 'github', 'website', 'other']

export const RANGES: { value: AnalyticsRange; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '365d', label: '12 months' },
]

/** Human text for a card history entry (backend sends `type` + `data`). */
export function describeHistory(h: { type: string; data?: Record<string, unknown> | null; description?: string }): string {
  if (h.description) return h.description
  const d = h.data ?? {}
  const s = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : null)
  switch (h.type) {
    case 'created':
      return s('via') === 'device' ? 'Registered from an nexTap device' : 'Created'
    case 'assigned':
      return s('assignee_name') ? `Assigned to ${s('assignee_name')}` : `Assigned to ${s('assignee_type') === 'customer' ? 'a customer' : s('assignee_type') === 'business' ? 'the company' : 'an employee'}`
    case 'unassigned':
      return 'Unassigned'
    case 'activated':
      return 'Activated'
    case 'deactivated':
      return 'Deactivated'
    case 'programmed':
      return 'Programmed with the nexTap app'
    case 'action_changed':
      return s('action_type') ? `Action set to ${actionLabel(s('action_type'))}` : 'Action reset to the business default'
    case 'uid_changed':
      return s('uid') ? 'Card UID updated' : 'Card UID cleared'
    case 'renamed':
      return s('name') ? `Renamed to “${s('name')}”` : 'Renamed'
    case 'deleted':
      return 'Deleted'
    default:
      return h.type.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
  }
}

export const ASSIGNEE_TYPE_LABEL: Record<string, string> = { employee: 'Employee', customer: 'Customer', business: 'Company' }
export const assigneeTypeLabel = (t: string | null | undefined) => (t ? (ASSIGNEE_TYPE_LABEL[t] ?? t) : 'Unassigned')
/** Dashboard link for an assignee (company cards have no person page). */
export const assigneeHref = (base: string, a: { type: string; id: string }) => (a.type === 'employee' ? `${base}/employees/${a.id}` : a.type === 'customer' ? `${base}/customers/${a.id}` : null)

import { request } from '@/api/client'

export type Audience = 'developer' | 'business'

/** `GET /billing/plans` (public). Business plans may carry extra limit fields; all are optional here. */
export interface PublicPlan {
  code: string
  name: string
  price_monthly_cents: number | null
  currency: string
  events_per_month: number | null
  max_applications: number | null
  max_devices: number | null
  features: string[]
  audience?: Audience
  max_cards?: number | null
  max_members?: number | null
  taps_per_month?: number | null
  // Part 3 §2 (admin-managed pricing) — all optional so older backends keep working.
  price_yearly_cents?: number | null
  is_featured?: boolean
  sort_order?: number
  badge?: string | null
  description?: string | null
  promotion?: AppliedPromotion | null
}

/** Best active promotion attached to a plan by `GET /billing/plans`. */
export interface AppliedPromotion {
  id: string
  name: string
  banner_text: string | null
  discount_type: 'percent' | 'amount'
  discount_value: number
  discounted_price_monthly_cents: number
  ends_at: string | null
  code: string | null
}

/** `GET /billing/promotions/active` (public; only `show_on_landing = true`). */
export interface LandingPromotion {
  id: string
  name: string
  code: string | null
  description?: string | null
  discount_type: 'percent' | 'amount'
  discount_value: number
  currency?: string | null
  audience: 'developer' | 'business' | 'all'
  plan_codes?: string[]
  starts_at?: string | null
  ends_at: string | null
  banner_text: string | null
}

/** Used when the API is unreachable. Mirrors the seeded plans in the contracts (Part 1 §6, Part 2 §B8). */
export const FALLBACK_PLANS: PublicPlan[] = [
  {
    code: 'free',
    description: 'For prototypes and small pilots.',
    name: 'Free',
    price_monthly_cents: 0,
    currency: 'usd',
    events_per_month: 10_000,
    max_applications: 3,
    max_devices: 5,
    audience: 'developer',
    features: ['Relay & direct delivery', 'HMAC-signed webhooks', 'Sandbox endpoint', 'QR phone pairing'],
  },
  {
    code: 'pro',
    description: 'For production integrations.',
    is_featured: true,
    name: 'Pro',
    price_monthly_cents: 2900,
    currency: 'usd',
    events_per_month: 250_000,
    max_applications: 20,
    max_devices: 100,
    audience: 'developer',
    features: ['Everything in Free', 'Endpoint allowlists', 'Request logs & error refs', 'Email support'],
  },
  {
    code: 'business',
    description: 'For high-volume fleets of readers.',
    name: 'Business',
    price_monthly_cents: 19900,
    currency: 'usd',
    events_per_month: 5_000_000,
    max_applications: null,
    max_devices: null,
    audience: 'developer',
    features: ['Everything in Pro', 'Unlimited applications & devices', 'Priority support'],
  },
  {
    code: 'biz_starter',
    description: 'For a single shop, café or team.',
    name: 'Starter',
    price_monthly_cents: 0,
    currency: 'usd',
    events_per_month: null,
    taps_per_month: 10_000,
    max_cards: 50,
    max_devices: 3,
    max_members: 5,
    max_applications: null,
    audience: 'business',
    features: ['No-code tap actions', 'Business & employee profiles', 'Tap analytics'],
  },
  {
    code: 'biz_growth',
    description: 'For growing teams and multiple sites.',
    is_featured: true,
    name: 'Growth',
    price_monthly_cents: 4900,
    currency: 'usd',
    events_per_month: null,
    taps_per_month: 250_000,
    max_cards: 1000,
    max_devices: 25,
    max_members: 25,
    max_applications: null,
    audience: 'business',
    features: ['Everything in Starter', 'Team roles & permissions', 'Developer webhooks & API'],
  },
  {
    code: 'biz_enterprise',
    description: 'For large organisations.',
    name: 'Enterprise',
    price_monthly_cents: null,
    currency: 'usd',
    events_per_month: null,
    taps_per_month: null,
    max_cards: null,
    max_devices: null,
    max_members: null,
    max_applications: null,
    audience: 'business',
    features: ['Everything in Growth', 'Unlimited cards, devices & members', 'Dedicated support'],
  },
]

export function planAudience(p: PublicPlan): Audience {
  return p.audience ?? (p.code.startsWith('biz_') ? 'business' : 'developer')
}

export async function fetchPublicPlans(): Promise<PublicPlan[]> {
  const plans = await request<PublicPlan[]>('GET', '/billing/plans', { auth: false })
  if (!Array.isArray(plans) || plans.length === 0) throw new Error('No plans')
  return plans
}

export async function fetchActivePromotions(): Promise<LandingPromotion[]> {
  const promos = await request<LandingPromotion[]>('GET', '/billing/promotions/active', { auth: false })
  return Array.isArray(promos) ? promos : []
}

/** Enterprise tiers are quoted individually (the API may send null or 0 for them). */
export function isCustomPriced(p: PublicPlan): boolean {
  return p.price_monthly_cents == null || (p.code.endsWith('enterprise') && p.price_monthly_cents === 0)
}

export function formatCents(cents: number, currency = 'usd'): string {
  const amount = cents / 100
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: (currency || 'usd').toUpperCase(),
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount)
  } catch {
    return `$${amount}`
  }
}

export function formatPrice(p: PublicPlan): string {
  if (isCustomPriced(p)) return 'Custom'
  if (p.price_monthly_cents === 0) return 'Free'
  return formatCents(p.price_monthly_cents ?? 0, p.currency)
}

export type Billing = 'monthly' | 'yearly'

/**
 * Price shown on a plan card: `{ now, was, suffix }` in cents per month (yearly = price_yearly / 12).
 * `was` is set when a promotion lowers the monthly price (strike-through).
 */
export function planPrice(p: PublicPlan, billing: Billing): { now: number | null; was: number | null; perYear: number | null } {
  if (isCustomPriced(p)) return { now: null, was: null, perYear: null }
  const monthly = p.price_monthly_cents ?? 0
  if (billing === 'yearly' && p.price_yearly_cents != null && p.price_yearly_cents > 0) {
    return { now: Math.round(p.price_yearly_cents / 12), was: monthly > 0 ? monthly : null, perYear: p.price_yearly_cents }
  }
  const promo = p.promotion
  if (promo && promo.discounted_price_monthly_cents < monthly) return { now: promo.discounted_price_monthly_cents, was: monthly, perYear: null }
  return { now: monthly, was: null, perYear: null }
}

export function promoLabel(p: { discount_type: 'percent' | 'amount'; discount_value: number }, currency = 'usd'): string {
  return p.discount_type === 'percent' ? `${p.discount_value}% off` : `${formatCents(p.discount_value, currency)} off`
}

const n = (v: number) => new Intl.NumberFormat('en-US', { notation: v >= 100_000 ? 'compact' : 'standard' }).format(v)

/** Human limit lines for a plan card. `undefined` fields are skipped, `null` means unlimited. */
export function planLimits(p: PublicPlan): string[] {
  const out: string[] = []
  const line = (v: number | null | undefined, label: string) => {
    if (v === undefined) return
    out.push(v === null ? `Unlimited ${label}` : `${n(v)} ${label}`)
  }
  if (planAudience(p) === 'business') {
    line(p.taps_per_month !== undefined ? p.taps_per_month : p.events_per_month, 'taps / month')
    line(p.max_cards, 'cards & tags')
    line(p.max_devices, 'reader devices')
    line(p.max_members, 'team members')
  } else {
    line(p.events_per_month, 'events / month')
    line(p.max_applications, 'applications')
    line(p.max_devices, 'devices')
  }
  return out
}

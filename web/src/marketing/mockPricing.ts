/**
 * DEV-ONLY pricing data for the mock API (src/api/mock/server.ts): Part 3 §2 plans with admin-managed fields
 * and landing promotions. Exported as mutable arrays so other mock handlers (e.g. /admin/plans) can share them.
 * Never imported by production code paths.
 */
import type { AppliedPromotion, LandingPromotion, PublicPlan } from './plans'

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z')

export const mockPromotions: (LandingPromotion & { show_on_landing: boolean; is_active: boolean })[] = [
  {
    id: 'promo-launch',
    name: 'Launch offer',
    code: 'LAUNCH30',
    description: '30% off Pro and Growth for the first 3 months.',
    discount_type: 'percent',
    discount_value: 30,
    currency: null,
    audience: 'all',
    plan_codes: ['pro', 'biz_growth'],
    starts_at: inDays(-3),
    ends_at: inDays(4),
    banner_text: 'Launch offer: 30% off Pro and Growth with code LAUNCH30',
    show_on_landing: true,
    is_active: true,
  },
]

export const mockPlans: PublicPlan[] = [
  { code: 'free', name: 'Free', description: 'For prototypes and small pilots.', price_monthly_cents: 0, price_yearly_cents: null, currency: 'usd', events_per_month: 10_000, max_applications: 3, max_devices: 5, audience: 'developer', sort_order: 1, is_featured: false, badge: null, features: ['Relay & direct delivery', 'HMAC-signed webhooks', 'Sandbox endpoint', 'QR phone pairing'] },
  { code: 'pro', name: 'Pro', description: 'For production integrations.', price_monthly_cents: 2900, price_yearly_cents: 29000, currency: 'usd', events_per_month: 250_000, max_applications: 20, max_devices: 100, audience: 'developer', sort_order: 2, is_featured: true, badge: 'Most popular', features: ['Everything in Free', 'Endpoint allowlists', 'Request logs & error refs', 'Email support'] },
  { code: 'business', name: 'Business', description: 'For high-volume fleets of readers.', price_monthly_cents: 19900, price_yearly_cents: 199000, currency: 'usd', events_per_month: 5_000_000, max_applications: null, max_devices: null, audience: 'developer', sort_order: 3, is_featured: false, badge: null, features: ['Everything in Pro', 'Unlimited applications & devices', 'Priority support'] },
  { code: 'biz_starter', name: 'Starter', description: 'For a single shop, café or team.', price_monthly_cents: 0, price_yearly_cents: null, currency: 'usd', events_per_month: 10_000, max_applications: 2, max_devices: 3, max_cards: 50, max_members: 5, taps_per_month: 10_000, audience: 'business', sort_order: 1, is_featured: false, badge: null, features: ['No-code tap actions', 'Business & employee profiles', 'Tap analytics'] },
  { code: 'biz_growth', name: 'Growth', description: 'For growing teams and multiple sites.', price_monthly_cents: 4900, price_yearly_cents: 49000, currency: 'usd', events_per_month: 250_000, max_applications: 10, max_devices: 25, max_cards: 1000, max_members: 25, taps_per_month: 250_000, audience: 'business', sort_order: 2, is_featured: true, badge: 'Best value', features: ['Everything in Starter', 'Team roles & permissions', 'Developer webhooks & API'] },
  { code: 'biz_enterprise', name: 'Enterprise', description: 'For large organisations.', price_monthly_cents: 0, price_yearly_cents: null, currency: 'usd', events_per_month: null, max_applications: null, max_devices: null, max_cards: null, max_members: null, taps_per_month: null, audience: 'business', sort_order: 3, is_featured: false, badge: null, features: ['Everything in Growth', 'Unlimited cards, devices & members', 'Dedicated support'] },
]

function applied(plan: PublicPlan): AppliedPromotion | null {
  const now = Date.now()
  const monthly = plan.price_monthly_cents
  if (!monthly) return null
  const promo = mockPromotions.find(
    (p) =>
      p.is_active &&
      (!p.starts_at || Date.parse(p.starts_at) <= now) &&
      (!p.ends_at || Date.parse(p.ends_at) > now) &&
      (p.audience === 'all' || p.audience === plan.audience) &&
      (!p.plan_codes?.length || p.plan_codes.includes(plan.code)),
  )
  if (!promo) return null
  const off = promo.discount_type === 'percent' ? Math.round((monthly * promo.discount_value) / 100) : promo.discount_value
  return {
    id: promo.id,
    name: promo.name,
    banner_text: promo.banner_text,
    discount_type: promo.discount_type,
    discount_value: promo.discount_value,
    discounted_price_monthly_cents: Math.max(0, monthly - off),
    ends_at: promo.ends_at,
    code: promo.code,
  }
}

/** `GET /billing/plans[?audience=]` */
export function mockPublicPlans(audience?: unknown): PublicPlan[] {
  return mockPlans
    .filter((p) => !audience || p.audience === audience)
    .sort((a, b) => (a.audience === b.audience ? (a.sort_order ?? 0) - (b.sort_order ?? 0) : a.audience === 'developer' ? -1 : 1))
    .map((p) => ({ ...p, promotion: applied(p) }))
}

/** `GET /billing/promotions/active` */
export function mockActivePromotions(): LandingPromotion[] {
  const now = Date.now()
  return mockPromotions
    .filter((p) => p.is_active && p.show_on_landing && (!p.starts_at || Date.parse(p.starts_at) <= now) && (!p.ends_at || Date.parse(p.ends_at) > now))
    .map(({ show_on_landing: _s, is_active: _a, ...rest }) => rest)
}

/** `GET /meta/app-release` (Part 3 §9) — latest published stable Android build (dev mock). */
export const mockAppRelease = {
  version_name: '1.3.0',
  build_number: 14,
  file_size: 21_474_836,
  sha256: '3f5a9c0e7b1d24e6a8c9f0b1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f60718293a4b',
  published_at: '2026-09-20T10:00:00Z',
  download_url: '/downloads/android/latest',
  min_android: '7.0',
}

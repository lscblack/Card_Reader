import { api } from './client'

export type BillingInterval = 'month' | 'year'

export interface PaymentsState {
  enabled: boolean
  publishable_key: string | null
  plan_code: string
  /** The current plan is a Stripe subscription. */
  paid_online: boolean
  /** A Stripe customer exists: the customer portal can be opened. */
  can_manage: boolean
}

export interface CheckoutStart {
  session_id: string
  client_secret: string
  publishable_key: string
}

export interface CheckoutResult {
  status: 'open' | 'complete' | 'expired'
  plan_code: string
  plan_name: string
  interval: BillingInterval
  amount_cents: number
  currency: string
  business_id: string | null
  billing_link: string
}

export const billingApi = {
  state: (businessId?: string | null) => api.get<PaymentsState>('/billing/payments', { business_id: businessId }),
  checkout: (body: { plan_code: string; interval: BillingInterval; business_id?: string | null; promotion_code?: string | null }) =>
    api.post<CheckoutStart>('/billing/checkout', body),
  result: (sessionId: string) => api.get<CheckoutResult>(`/billing/checkout/${encodeURIComponent(sessionId)}`),
  portal: (businessId?: string | null) => api.post<{ url: string }>('/billing/portal', { business_id: businessId ?? null }),
}

/** Link to the checkout page for a plan (business plans need the business id). */
export function checkoutPath(planCode: string, opts: { businessId?: string | null; interval?: BillingInterval } = {}): string {
  const q = new URLSearchParams({ plan: planCode })
  if (opts.interval) q.set('interval', opts.interval)
  if (opts.businessId) q.set('business', opts.businessId)
  return `/checkout?${q.toString()}`
}

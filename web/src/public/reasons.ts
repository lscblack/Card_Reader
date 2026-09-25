/** Neutral wording per `details.reason` / `?reason=` (never reveals more than necessary). */
export const UNAVAILABLE_REASONS: Record<string, { title: string; body: string }> = {
  unverified: { title: 'This business hasn’t been verified yet', body: 'The business is still setting things up. Please check back soon.' },
  inactive: { title: 'This card isn’t active', body: 'The card or page you used has been turned off. Contact the business if you think this is a mistake.' },
  suspended: { title: 'This page isn’t available', body: 'This business page is temporarily unavailable.' },
  unpublished: { title: 'This page isn’t available', body: 'The business hasn’t published this page yet.' },
}

import { request } from '@/api/client'
import type { BusinessCategory, PublicProfileResponse, PublicWifiResponse } from '@/business/api/types'

/** Public, unauthenticated endpoints (contract B6). No dashboard code is imported here. */
export const publicApi = {
  profile: (slug: string, profileSlug?: string) =>
    request<PublicProfileResponse>('GET', `/public/b/${encodeURIComponent(slug)}${profileSlug ? `/${encodeURIComponent(profileSlug)}` : ''}`, { auth: false }),
  categories: () => request<BusinessCategory[]>('GET', '/meta/business-categories', { auth: false }),
  /** Part 6 §4 — form submission (`website` is the honeypot; bots fill it). */
  submitForm: (slug: string, profileSlug: string, sectionId: string, body: { answers: Record<string, unknown>; website: string }) =>
    request<unknown>('POST', `/public/b/${encodeURIComponent(slug)}/${encodeURIComponent(profileSlug)}/forms/${encodeURIComponent(sectionId)}`, { auth: false, body }),
  wifi: (code: string) => request<PublicWifiResponse>('GET', `/public/w/${encodeURIComponent(code)}`, { auth: false }),
}

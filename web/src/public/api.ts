import { request } from '@/api/client'
import type { BusinessCategory, PublicProfileResponse, PublicWifiResponse } from '@/business/api/types'

/** Public, unauthenticated endpoints (contract B6). No dashboard code is imported here. */
export const publicApi = {
  profile: (slug: string, profileSlug?: string) =>
    request<PublicProfileResponse>('GET', `/public/b/${encodeURIComponent(slug)}${profileSlug ? `/${encodeURIComponent(profileSlug)}` : ''}`, { auth: false }),
  categories: () => request<BusinessCategory[]>('GET', '/meta/business-categories', { auth: false }),
  wifi: (code: string) => request<PublicWifiResponse>('GET', `/public/w/${encodeURIComponent(code)}`, { auth: false }),
}

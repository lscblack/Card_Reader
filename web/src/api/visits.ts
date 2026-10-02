import { api, request } from './client'

export interface VisitCounts {
  visits: number
  unique_visitors: number
}

export interface VisitDay extends VisitCounts {
  date: string
}

export interface SiteVisits {
  days: number
  today: VisitCounts
  last_7_days: VisitCounts
  period: VisitCounts
  by_kind: { site: number; support: number; business: number; personal: number }
  devices: Record<string, number>
  daily: VisitDay[]
  top_pages: { path: string; visits: number; unique_visitors: number }[]
  top_referrers: { host: string; visits: number }[]
}

export interface BusinessPageVisits {
  days: number
  today: VisitCounts
  period: VisitCounts
  daily: VisitDay[]
  pages: { profile_id: string | null; title: string; visits: number; unique_visitors: number }[]
}

export const visitsApi = {
  record: (path: string, referrer: string | null) => request<void>('POST', '/visits', { body: { path, referrer }, quiet: true }),
  site: (days: number) => api.get<SiteVisits>('/admin/visits', { days }),
  business: (businessId: string, days: number) => api.get<BusinessPageVisits>(`/businesses/${businessId}/page-visits`, { days }),
}

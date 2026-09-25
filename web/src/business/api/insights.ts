import { api } from '@/api/client'
import type { Analytics, AnalyticsRange, ApiUsage, ApiUsageRange, CardTap, Paginated, TapFilters } from './types'

export const tapsApi = {
  list: (bid: string, f: TapFilters) => api.get<Paginated<CardTap>>(`/businesses/${bid}/taps`, { ...f }),
}

export const analyticsApi = {
  get: (bid: string, q: { range: AnalyticsRange; card_id?: string; employee_id?: string }) =>
    api.get<Analytics>(`/businesses/${bid}/analytics`, q),
  apiUsage: (bid: string, range: ApiUsageRange) => api.get<ApiUsage>(`/businesses/${bid}/api-usage`, { range }),
}

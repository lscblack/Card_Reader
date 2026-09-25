import { api } from '@/api/client'
import { uploadFile } from './upload'
import type {
  Business,
  BusinessBilling,
  BusinessCategory,
  BusinessMe,
  BusinessOverview,
  BusinessPlan,
  UpdateBusinessRequest,
} from './types'

const b = (id: string) => `/businesses/${id}`

export const businessApi = {
  list: () => api.get<Business[]>('/businesses'),
  get: (id: string) => api.get<Business>(b(id)),
  me: (id: string) => api.get<BusinessMe>(`${b(id)}/me`),
  update: (id: string, body: UpdateBusinessRequest) => api.patch<Business>(b(id), body),
  remove: (id: string) => api.delete(b(id)),
  slugAvailable: (slug: string) => api.get<{ available: boolean; reason?: string | null }>('/businesses/slug-available', { slug }),
  uploadLogo: (id: string, file: File) => uploadFile<Business>(`${b(id)}/logo`, file),
  overview: (id: string) => api.get<BusinessOverview>(`${b(id)}/overview`),
  billing: (id: string) => api.get<BusinessBilling>(`${b(id)}/billing`),
}

export const metaBizApi = {
  categories: () => api.get<BusinessCategory[]>('/meta/business-categories'),
  plans: () => api.get<BusinessPlan[]>('/billing/plans', { audience: 'business' }),
}

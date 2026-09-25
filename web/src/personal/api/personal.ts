import { api, request, ApiError, API_BASE_URL, API_PREFIX } from '@/api/client'
import { getToken } from '@/auth/tokenStore'
import { uploadFile } from '@/business/api/upload'
import type {
  ActivityItem,
  BusinessInvite,
  CardInput,
  CardTemplate,
  Contact,
  ContactFilters,
  DigitalCard,
  ExchangeQr,
  LeadInput,
  LoginCode,
  LoginCodeState,
  Paginated,
  PersonalSession,
  PersonalStats,
  PublicCardResponse,
} from './types'

const c = '/personal/cards'

export const cardsApi = {
  list: () => api.get<DigitalCard[] | { items: DigitalCard[] }>(c),
  get: (id: string) => api.get<DigitalCard>(`${c}/${id}`),
  create: (body: CardInput) => api.post<DigitalCard>(c, body),
  update: (id: string, body: CardInput) => api.patch<DigitalCard>(`${c}/${id}`, body),
  remove: (id: string) => api.delete(`${c}/${id}`),
  setPrimary: (id: string) => api.post<DigitalCard>(`${c}/${id}/primary`),
  rotate: (id: string) => api.post<DigitalCard>(`${c}/${id}/rotate-share-id`),
  duplicate: (id: string) => api.post<DigitalCard>(`${c}/${id}/duplicate`),
  uploadImage: (id: string, kind: 'photo' | 'cover' | 'logo', file: File) => uploadFile<DigitalCard>(`${c}/${id}/images?kind=${kind}`, file),
  deleteImage: (id: string, kind: 'photo' | 'cover' | 'logo') => request<DigitalCard | null>('DELETE', `${c}/${id}/images`, { query: { kind } }),
  exchangeQr: (id: string) => api.get<ExchangeQr>(`${c}/${id}/exchange-qr`),
}

export const templatesApi = {
  list: () => request<CardTemplate[]>('GET', '/personal/templates', { auth: false }),
}

export const contactsApi = {
  list: (f: ContactFilters) => api.get<Paginated<Contact>>('/personal/contacts', { ...f }),
  get: (id: string) => api.get<Contact>(`/personal/contacts/${id}`),
  create: (body: { card: { fields: Contact['card']['fields'] }; notes?: string; tags?: string[] }) => api.post<Contact>('/personal/contacts', body),
  update: (id: string, body: { notes?: string | null; tags?: string[]; favorite?: boolean }) => api.patch<Contact>(`/personal/contacts/${id}`, body),
  remove: (id: string) => api.delete(`/personal/contacts/${id}`),
}

export const activityApi = {
  list: (page: number) => api.get<Paginated<ActivityItem>>('/personal/activity', { page }),
  stats: (range: string) => api.get<PersonalStats>('/personal/stats', { range }),
}

export const sessionsApi = {
  list: () => api.get<PersonalSession[] | { items: PersonalSession[] }>('/personal/sessions'),
  revoke: (id: string) => api.delete(`/personal/sessions/${id}`),
  createLoginCode: () => api.post<LoginCode>('/personal/login-codes'),
  loginCode: (id: string) => api.get<LoginCodeState>(`/personal/login-codes/${id}`),
}

export const invitesApi = {
  list: () => api.get<BusinessInvite[] | { items: BusinessInvite[] }>('/personal/business-invites'),
  accept: (id: string) => api.post<DigitalCard | null>(`/personal/business-invites/${id}/accept`),
  decline: (id: string) => api.post<BusinessInvite | null>(`/personal/business-invites/${id}/decline`),
}

export const publicCardApi = {
  get: (slug: string, via?: string) => request<PublicCardResponse>('GET', `/public/p/${encodeURIComponent(slug)}`, { auth: false, query: { via } }),
  lead: (slug: string, body: LeadInput) => request<unknown>('POST', `/public/p/${encodeURIComponent(slug)}/leads`, { auth: false, body }),
}

/** Downloads an authenticated file (vCard / CSV exports) and saves it with `filename`. */
export async function downloadAuthed(path: string, filename: string): Promise<void> {
  let blob: Blob
  if (import.meta.env.VITE_USE_MOCKS === 'true') {
    const { mockRequest } = await import('@/api/mock/server')
    const res = await mockRequest('GET', path, undefined, undefined, getToken())
    if (res.status >= 300) throw new ApiError(res.status, 'download_failed', 'Download failed')
    blob = new Blob([String(res.body ?? '')], { type: filename.endsWith('.csv') ? 'text/csv' : 'text/vcard' })
  } else {
    const token = getToken()
    const res = await fetch(`${API_BASE_URL}${API_PREFIX}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    if (!res.ok) throw new ApiError(res.status, `http_${res.status}`, `Download failed (${res.status})`)
    blob = await res.blob()
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

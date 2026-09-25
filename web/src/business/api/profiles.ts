import { api } from '@/api/client'
import type { Paginated, Profile, ProfileInput } from './types'

const p = (bid: string) => `/businesses/${bid}/profiles`

export const profilesApi = {
  list: (bid: string, q: { type?: string; q?: string; page?: number; page_size?: number } = {}) =>
    api.get<Profile[] | Paginated<Profile>>(p(bid), q),
  get: (bid: string, id: string) => api.get<Profile>(`${p(bid)}/${id}`),
  create: (bid: string, body: ProfileInput) => api.post<Profile>(p(bid), body),
  update: (bid: string, id: string, body: ProfileInput) => api.patch<Profile>(`${p(bid)}/${id}`, body),
  remove: (bid: string, id: string) => api.delete(`${p(bid)}/${id}`),
  publish: (bid: string, id: string) => api.post<Profile>(`${p(bid)}/${id}/publish`),
  unpublish: (bid: string, id: string) => api.post<Profile>(`${p(bid)}/${id}/unpublish`),
}

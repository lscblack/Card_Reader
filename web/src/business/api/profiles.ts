import { api } from '@/api/client'
import { uploadFile } from './upload'
import type { FormResponse, PageTemplate, Paginated, Profile, ProfileInput, ProfileType } from './types'

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
  /** Part 6 §2 — copy (unpublished). */
  duplicate: (bid: string, id: string, body: { title?: string; slug?: string } = {}) => api.post<Profile>(`${p(bid)}/${id}/duplicate`, body),
  saveAsTemplate: (bid: string, id: string, body: { name: string; description?: string }) => api.post<PageTemplate>(`${p(bid)}/${id}/save-as-template`, body),
}

export const pageTemplatesApi = {
  /** System + this business's templates. */
  list: (bid: string, page_type?: ProfileType) => api.get<PageTemplate[] | Paginated<PageTemplate>>(`/businesses/${bid}/page-templates`, page_type ? { page_type } : undefined),
  update: (bid: string, tid: string, body: { name?: string; description?: string }) => api.patch<PageTemplate>(`/businesses/${bid}/page-templates/${tid}`, body),
  remove: (bid: string, tid: string) => api.delete(`/businesses/${bid}/page-templates/${tid}`),
}

export const formResponsesApi = {
  list: (bid: string, q: { profile_id?: string; page?: number; page_size?: number }) => api.get<Paginated<FormResponse>>(`/businesses/${bid}/form-responses`, q),
  remove: (bid: string, rid: string) => api.delete(`/businesses/${bid}/form-responses/${rid}`),
  exportCsv: (bid: string, profile_id?: string) => api.get<string>(`/businesses/${bid}/form-responses/export.csv`, profile_id ? { profile_id } : undefined),
}

/** Images for pages (menu items, products, gallery, cover/logo): PNG/JPEG/WebP ≤ 2 MB → a `/media/…` URL. */
export const pageMediaApi = {
  upload: (bid: string, file: File) => uploadFile<{ url: string }>(`/businesses/${bid}/media`, file),
}

import { api, request } from './client'
import type { AppNotification, AppRelease, CreateAppReleaseRequest, Paginated, PublicAppRelease, User, UserPreferences } from './types'

export const releasesApi = {
  /** Latest published stable release, or 404 `no_release`. */
  latest: () => request<PublicAppRelease>('GET', '/meta/app-release', { auth: false }),
}

export const adminReleasesApi = {
  list: () => api.get<AppRelease[] | Paginated<AppRelease>>('/admin/app-releases'),
  get: (id: string, full = false) => api.get<AppRelease>(`/admin/app-releases/${id}`, full ? { log: 'full' } : undefined),
  create: (body: CreateAppReleaseRequest) => api.post<AppRelease>('/admin/app-releases', body),
  cancel: (id: string) => api.post<AppRelease>(`/admin/app-releases/${id}/cancel`),
  publish: (id: string) => api.post<AppRelease>(`/admin/app-releases/${id}/publish`),
  unpublish: (id: string) => api.post<AppRelease>(`/admin/app-releases/${id}/unpublish`),
  remove: (id: string) => api.delete(`/admin/app-releases/${id}`),
}

export const notificationsApi = {
  list: (f: { unread?: boolean; page?: number } = {}) => api.get<Paginated<AppNotification>>('/notifications', f),
  unreadCount: () => api.get<{ count: number } | { unread: number }>('/notifications/unread-count'),
  read: (id: string) => api.post<AppNotification | null>(`/notifications/${id}/read`),
  readAll: () => api.post<null>('/notifications/read-all'),
}

export const preferencesApi = {
  patch: (p: Partial<UserPreferences>) => api.patch<User>('/auth/me/preferences', p),
}

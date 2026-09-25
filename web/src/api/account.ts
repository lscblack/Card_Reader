import { api } from './client'
import type { AdminStats, AllowedOrigin, AllowedOriginsResponse, AuditLog, CreateAllowedOriginRequest, Paginated, User } from './types'

export const auditApi = {
  list: (page = 1, page_size = 20) => api.get<Paginated<AuditLog>>('/audit-logs', { page, page_size }),
}

export const adminApi = {
  users: (page = 1) => api.get<Paginated<User>>('/admin/users', { page }),
  setActive: (id: string, is_active: boolean) => api.patch<User>(`/admin/users/${id}`, { is_active }),
  stats: () => api.get<AdminStats>('/admin/stats'),
  allowedOrigins: () => api.get<AllowedOriginsResponse>('/admin/allowed-origins'),
  addAllowedOrigin: (body: CreateAllowedOriginRequest) => api.post<AllowedOrigin>('/admin/allowed-origins', body),
  deleteAllowedOrigin: (id: string) => api.delete(`/admin/allowed-origins/${id}`),
}

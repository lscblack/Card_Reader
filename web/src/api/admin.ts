import { api } from './client'
import type {
  AdminAccount,
  AdminAccountDetail,
  AdminAccountPatch,
  AdminBusiness,
  AdminDevice,
  AdminOverview,
  AdminRange,
  AdminSystem,
  Delivery,
  Device,
  Paginated,
  PlatformSettings,
  RequestLog,
  RequestLogFilters,
} from './types'

type Q = Record<string, string | number | boolean | null | undefined>

/** Admin console (Part 2 §A5). */
export const adminConsoleApi = {
  overview: (range: AdminRange) => api.get<AdminOverview>('/admin/overview', { range }),
  requestLogs: (f: RequestLogFilters) => api.get<Paginated<RequestLog>>('/admin/request-logs', { ...f } as Q),
  requestLog: (id: string) => api.get<RequestLog>(`/admin/request-logs/${id}`),
  accounts: (f: { type?: string; q?: string; status?: string; page?: number }) =>
    api.get<Paginated<AdminAccount>>('/admin/accounts', f),
  account: (id: string) => api.get<AdminAccountDetail>(`/admin/accounts/${id}`),
  patchAccount: (id: string, body: AdminAccountPatch) => api.patch<AdminAccount>(`/admin/accounts/${id}`, body),
  businesses: (f: { q?: string; status?: string; page?: number }) =>
    api.get<Paginated<AdminBusiness> | AdminBusiness[]>('/admin/businesses', f),
  business: (id: string) => api.get<AdminBusiness>(`/admin/businesses/${id}`),
  patchBusiness: (id: string, body: { status?: 'active' | 'suspended'; plan_code?: string }) =>
    api.patch<AdminBusiness>(`/admin/businesses/${id}`, body),
  devices: (f: { status?: string; online?: string; q?: string; page?: number }) =>
    api.get<Paginated<AdminDevice> | AdminDevice[]>('/admin/devices', f),
  revokeDevice: (id: string) => api.post<Device>(`/admin/devices/${id}/revoke`),
  revokeApiKey: (id: string) => api.post<unknown>(`/admin/api-keys/${id}/revoke`),
  deliveries: (f: { success?: boolean; error_code?: string; page?: number; page_size?: number }) =>
    api.get<Paginated<Delivery>>('/admin/deliveries', f),
  system: () => api.get<AdminSystem>('/admin/system'),
  settings: () => api.get<PlatformSettings>('/admin/settings'),
  patchSettings: (body: Partial<PlatformSettings>) => api.patch<PlatformSettings>('/admin/settings', body),
}

/** Normalise list endpoints that may be paginated or a bare array. */
export function itemsOf<T>(res: Paginated<T> | T[] | undefined): { items: T[]; total: number; page: number; page_size: number } {
  if (!res) return { items: [], total: 0, page: 1, page_size: 20 }
  if (Array.isArray(res)) return { items: res, total: res.length, page: 1, page_size: res.length || 20 }
  return res
}

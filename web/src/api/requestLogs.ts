import { api, request } from './client'
import type { ErrorCatalogEntry, Paginated, RequestLog, RequestLogFilters } from './types'

type Q = Record<string, string | number | boolean | null | undefined>

export const requestLogsApi = {
  list: (f: RequestLogFilters) => api.get<Paginated<RequestLog>>('/request-logs', { ...f } as Q),
  get: (id: string) => api.get<RequestLog>(`/request-logs/${id}`),
}

export const errorsApi = {
  catalog: () => request<ErrorCatalogEntry[]>('GET', '/errors', { auth: false }),
}

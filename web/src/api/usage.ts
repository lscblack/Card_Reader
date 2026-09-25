import { api, request } from './client'
import type { MetaStatus, Overview, Plan, ServerMeta, Subscription, Usage } from './types'

export const metaApi = {
  get: () => api.get<ServerMeta>('/meta'),
  status: () => request<MetaStatus>('GET', '/meta/status', { auth: false }),
}

export const overviewApi = {
  get: () => api.get<Overview>('/overview'),
}

export const usageApi = {
  get: (days = 30) => api.get<Usage>('/usage', { days }),
  plans: () => api.get<Plan[]>('/billing/plans'),
  subscription: () => api.get<Subscription>('/billing/subscription'),
}

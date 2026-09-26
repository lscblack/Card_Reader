import { api } from './client'
import type { Application, Paginated, SandboxEndpoint, SandboxEndpointInput, SandboxRequest, SandboxSendTestResult } from './types'

export const sandboxApi = {
  /** `businessId` = a business's sandbox (member with api.view/api.manage); omitted = the developer's own. */
  list: (businessId?: string | null) => api.get<SandboxEndpoint[]>('/sandbox/endpoints', { business_id: businessId || undefined }),
  get: (id: string) => api.get<SandboxEndpoint>(`/sandbox/endpoints/${id}`),
  create: (body: SandboxEndpointInput, businessId?: string | null) =>
    api.post<SandboxEndpoint>(`/sandbox/endpoints${businessId ? `?business_id=${encodeURIComponent(businessId)}` : ''}`, body),
  update: (id: string, body: SandboxEndpointInput) => api.patch<SandboxEndpoint>(`/sandbox/endpoints/${id}`, body),
  remove: (id: string) => api.delete(`/sandbox/endpoints/${id}`),
  requests: (id: string, params: { page?: number; page_size?: number; since?: string } = {}) =>
    api.get<Paginated<SandboxRequest>>(`/sandbox/endpoints/${id}/requests`, params),
  request: (id: string) => api.get<SandboxRequest>(`/sandbox/requests/${id}`),
  clear: (id: string) => api.delete(`/sandbox/endpoints/${id}/requests`),
  useFor: (id: string, applicationId: string) => api.post<Application>(`/sandbox/endpoints/${id}/use-for/${applicationId}`),
  sendTest: (id: string) => api.post<SandboxSendTestResult>(`/sandbox/endpoints/${id}/send-test`),
}

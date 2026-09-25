import { api } from './client'
import type { Application, Paginated, SandboxEndpoint, SandboxEndpointInput, SandboxRequest, SandboxSendTestResult } from './types'

export const sandboxApi = {
  list: () => api.get<SandboxEndpoint[]>('/sandbox/endpoints'),
  get: (id: string) => api.get<SandboxEndpoint>(`/sandbox/endpoints/${id}`),
  create: (body: SandboxEndpointInput) => api.post<SandboxEndpoint>('/sandbox/endpoints', body),
  update: (id: string, body: SandboxEndpointInput) => api.patch<SandboxEndpoint>(`/sandbox/endpoints/${id}`, body),
  remove: (id: string) => api.delete(`/sandbox/endpoints/${id}`),
  requests: (id: string, params: { page?: number; page_size?: number; since?: string } = {}) =>
    api.get<Paginated<SandboxRequest>>(`/sandbox/endpoints/${id}/requests`, params),
  request: (id: string) => api.get<SandboxRequest>(`/sandbox/requests/${id}`),
  clear: (id: string) => api.delete(`/sandbox/endpoints/${id}/requests`),
  useFor: (id: string, applicationId: string) => api.post<Application>(`/sandbox/endpoints/${id}/use-for/${applicationId}`),
  sendTest: (id: string) => api.post<SandboxSendTestResult>(`/sandbox/endpoints/${id}/send-test`),
}

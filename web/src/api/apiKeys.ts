import { api } from './client'
import type { ApiKey, CreateApiKeyRequest, CreateApiKeyResponse } from './types'

export const apiKeysApi = {
  list: (applicationId?: string) => api.get<ApiKey[]>('/api-keys', { application_id: applicationId }),
  create: (body: CreateApiKeyRequest) => api.post<CreateApiKeyResponse>('/api-keys', body),
  revoke: (id: string) => api.post<ApiKey>(`/api-keys/${id}/revoke`),
}

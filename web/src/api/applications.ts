import { api } from './client'
import type {
  AppCard,
  Application,
  CreateApplicationRequest,
  CreateApplicationResponse,
  CreatePairingCodeRequest,
  EndpointTestResult,
  PairingCodeCreated,
  PairingCodeState,
  RotateSecretRequest,
  RotateSecretResponse,
  UpdateApplicationRequest,
  UpdateEndpointRequest,
} from './types'

export const applicationsApi = {
  list: () => api.get<Application[]>('/applications'),
  get: (id: string) => api.get<Application>(`/applications/${id}`),
  create: (body: CreateApplicationRequest) => api.post<CreateApplicationResponse>('/applications', body),
  update: (id: string, body: UpdateApplicationRequest) => api.patch<Application>(`/applications/${id}`, body),
  remove: (id: string) => api.delete(`/applications/${id}`),
  updateEndpoint: (id: string, body: UpdateEndpointRequest) => api.put<Application>(`/applications/${id}/endpoint`, body),
  testEndpoint: (id: string) => api.post<EndpointTestResult>(`/applications/${id}/endpoint/test`),
  rotateSecret: (id: string, body: RotateSecretRequest = {}) =>
    api.post<RotateSecretResponse>(`/applications/${id}/webhook-secret/rotate`, body),
  setAllowedDomains: (id: string, domains: string[]) => api.put<Application>(`/applications/${id}/allowed-domains`, { domains }),
  createPairingCode: (id: string, body: CreatePairingCodeRequest = {}) =>
    api.post<PairingCodeCreated>(`/applications/${id}/pairing-codes`, body),
  listCards: (id: string) => api.get<AppCard[]>(`/applications/${id}/cards`),
  createCard: (id: string, body: { uid: string; label?: string }) => api.post<AppCard>(`/applications/${id}/cards`, body),
  updateCard: (id: string, cardId: string, body: { label?: string | null }) =>
    api.patch<AppCard>(`/applications/${id}/cards/${cardId}`, body),
  deleteCard: (id: string, cardId: string) => api.delete(`/applications/${id}/cards/${cardId}`),
}

export const pairingApi = {
  get: (id: string) => api.get<PairingCodeState>(`/pairing-codes/${id}`),
  cancel: (id: string) => api.post<void>(`/pairing-codes/${id}/cancel`),
}

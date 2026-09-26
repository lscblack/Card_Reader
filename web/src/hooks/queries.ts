import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { applicationsApi } from '@/api/applications'
import { apiKeysApi } from '@/api/apiKeys'
import { devicesApi } from '@/api/devices'
import { deliveriesApi, eventsApi } from '@/api/events'
import { metaApi, overviewApi, usageApi } from '@/api/usage'
import { adminApi, auditApi } from '@/api/account'
import type {
  CreateAllowedOriginRequest,
  CreateApiKeyRequest,
  CreateApplicationRequest,
  DeliveryFilters,
  DeviceStatus,
  EventFilters,
  RotateSecretRequest,
  UpdateApplicationRequest,
  UpdateEndpointRequest,
} from '@/api/types'

export const qk = {
  overview: ['overview'] as const,
  meta: ['meta'] as const,
  applications: ['applications'] as const,
  application: (id: string) => ['applications', id] as const,
  apiKeys: (appId?: string) => ['api-keys', appId ?? 'all'] as const,
  devices: (f: object) => ['devices', f] as const,
  events: (f: EventFilters) => ['events', f] as const,
  event: (id: string) => ['event', id] as const,
  deliveries: (f: DeliveryFilters) => ['deliveries', f] as const,
  usage: (days: number) => ['usage', days] as const,
  plans: ['plans'] as const,
  subscription: ['subscription'] as const,
  audit: (page: number) => ['audit', page] as const,
  adminUsers: (page: number) => ['admin', 'users', page] as const,
  adminStats: ['admin', 'stats'] as const,
  allowedOrigins: ['admin', 'allowed-origins'] as const,
}

// ---------- Queries ----------

export const useServerMeta = () => useQuery({ queryKey: qk.meta, queryFn: metaApi.get, staleTime: Infinity })

export const useOverview = () => useQuery({ queryKey: qk.overview, queryFn: overviewApi.get })

export const useApplications = (opts: { enabled?: boolean } = {}) =>
  useQuery({ queryKey: qk.applications, queryFn: applicationsApi.list, enabled: opts.enabled ?? true })

export const useApplication = (id: string | undefined) =>
  useQuery({ queryKey: qk.application(id ?? ''), queryFn: () => applicationsApi.get(id!), enabled: !!id })

export const useApiKeys = (appId?: string) =>
  useQuery({ queryKey: qk.apiKeys(appId), queryFn: () => apiKeysApi.list(appId) })

export const useDevices = (f: { application_id?: string; status?: DeviceStatus | '' } = {}) =>
  useQuery({ queryKey: qk.devices(f), queryFn: () => devicesApi.list(f) })

export const useEvents = (f: EventFilters, refetchInterval: number | false = false) =>
  useQuery({
    queryKey: qk.events(f),
    queryFn: () => eventsApi.list(f),
    placeholderData: keepPreviousData,
    refetchInterval,
  })

export const useEvent = (id: string | null) =>
  useQuery({ queryKey: qk.event(id ?? ''), queryFn: () => eventsApi.get(id!), enabled: !!id })

export const useDeliveries = (f: DeliveryFilters) =>
  useQuery({ queryKey: qk.deliveries(f), queryFn: () => deliveriesApi.list(f), placeholderData: keepPreviousData })

export const useUsage = (days = 30) => useQuery({ queryKey: qk.usage(days), queryFn: () => usageApi.get(days) })
export const usePlans = () => useQuery({ queryKey: qk.plans, queryFn: usageApi.plans, staleTime: 10 * 60_000 })
export const useSubscription = () => useQuery({ queryKey: qk.subscription, queryFn: usageApi.subscription })

export const useAuditLogs = (page: number) =>
  useQuery({ queryKey: qk.audit(page), queryFn: () => auditApi.list(page), placeholderData: keepPreviousData })

export const useAdminUsers = (page: number, enabled = true) =>
  useQuery({ queryKey: qk.adminUsers(page), queryFn: () => adminApi.users(page), enabled, placeholderData: keepPreviousData })
export const useAdminStats = (enabled = true) =>
  useQuery({ queryKey: qk.adminStats, queryFn: adminApi.stats, enabled })
export const useAllowedOrigins = () => useQuery({ queryKey: qk.allowedOrigins, queryFn: adminApi.allowedOrigins })

// ---------- Mutations ----------

function useInvalidate() {
  const qc = useQueryClient()
  return (...keys: readonly (readonly unknown[])[]) =>
    Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })))
}

export function useCreateApplication() {
  const inv = useInvalidate()
  // Secrets in the response are handed to the caller and never cached (gcTime irrelevant for mutations
  // once the component unmounts; we also avoid writing them into the query cache).
  return useMutation({
    mutationFn: (body: CreateApplicationRequest) => applicationsApi.create(body),
    onSuccess: () => inv(qk.applications, ['api-keys'], qk.overview),
  })
}

export function useUpdateApplication(id: string) {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: (body: UpdateApplicationRequest) => applicationsApi.update(id, body),
    // ['biz']: business applications are also edited through these Part 1 endpoints (IntegrationAppPage).
    onSuccess: () => inv(qk.applications, qk.overview, ['biz']),
  })
}

export function useDeleteApplication() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => applicationsApi.remove(id),
    onSuccess: () => inv(qk.applications, ['api-keys'], ['devices'], qk.overview, ['biz']),
  })
}

export function useUpdateEndpoint(id: string) {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: (body: UpdateEndpointRequest) => applicationsApi.updateEndpoint(id, body),
    onSuccess: () => inv(qk.applications, ['biz']),
  })
}

export function useTestEndpoint(id: string) {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: () => applicationsApi.testEndpoint(id),
    onSettled: () => inv(qk.applications, ['deliveries']),
  })
}

export function useRotateSecret(id: string) {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: (body: RotateSecretRequest = {}) => applicationsApi.rotateSecret(id, body),
    onSuccess: () => inv(qk.applications),
  })
}

export function useCreateApiKey() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: (body: CreateApiKeyRequest) => apiKeysApi.create(body),
    onSuccess: () => inv(['api-keys'], qk.overview),
  })
}

export function useRevokeApiKey() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => apiKeysApi.revoke(id),
    onSuccess: () => inv(['api-keys'], qk.overview),
  })
}

export function useRenameDevice() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => devicesApi.rename(id, name),
    onSuccess: () => inv(['devices']),
  })
}

export function useRevokeDevice() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => devicesApi.revoke(id),
    onSuccess: () => inv(['devices'], qk.applications, qk.overview),
  })
}

export function useDeleteDevice() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => devicesApi.remove(id),
    onSuccess: () => inv(['devices'], qk.applications, qk.overview),
  })
}

export function useRedeliver() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: (eventId: string) => eventsApi.redeliver(eventId),
    onSettled: (_d, _e, eventId) => inv(qk.event(eventId), ['events'], ['deliveries']),
  })
}

export function useSetUserActive() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) => adminApi.setActive(id, is_active),
    onSuccess: () => inv(['admin']),
  })
}

export function useSetAllowedDomains(id: string) {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: (domains: string[]) => applicationsApi.setAllowedDomains(id, domains),
    onSuccess: () => inv(qk.applications),
  })
}

export function useAddAllowedOrigin() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: (body: CreateAllowedOriginRequest) => adminApi.addAllowedOrigin(body),
    onSuccess: () => inv(qk.allowedOrigins),
  })
}

export function useDeleteAllowedOrigin() {
  const inv = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => adminApi.deleteAllowedOrigin(id),
    onSuccess: () => inv(qk.allowedOrigins),
  })
}

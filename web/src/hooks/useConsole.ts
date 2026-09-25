import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { sandboxApi } from '@/api/sandbox'
import { errorsApi, requestLogsApi } from '@/api/requestLogs'
import { adminConsoleApi } from '@/api/admin'
import type { AdminAccountPatch, AdminRange, PlatformSettings, RequestLogFilters, SandboxEndpointInput } from '@/api/types'

// ---------- Error catalog ----------

export const useErrorCatalog = () =>
  useQuery({ queryKey: ['error-catalog'], queryFn: errorsApi.catalog, staleTime: 60 * 60_000, retry: false })

// ---------- Request logs (developer) ----------

export const useRequestLogs = (f: RequestLogFilters, refetchInterval: number | false = false) =>
  useQuery({ queryKey: ['request-logs', f], queryFn: () => requestLogsApi.list(f), placeholderData: keepPreviousData, refetchInterval })

// ---------- Sandbox ----------

export const useSandboxEndpoints = () => useQuery({ queryKey: ['sandbox'], queryFn: sandboxApi.list })

export const useSandboxRequests = (endpointId: string | undefined, page: number, live: boolean) =>
  useQuery({
    queryKey: ['sandbox', endpointId, 'requests', page],
    queryFn: () => sandboxApi.requests(endpointId!, { page, page_size: 50 }),
    enabled: !!endpointId,
    placeholderData: keepPreviousData,
    refetchInterval: live ? 2000 : false,
  })

export const useSandboxRequest = (id: string | null) =>
  useQuery({ queryKey: ['sandbox-request', id], queryFn: () => sandboxApi.request(id!), enabled: !!id })

export function useSandboxMutations() {
  const qc = useQueryClient()
  const inv = () => qc.invalidateQueries({ queryKey: ['sandbox'] })
  return {
    create: useMutation({ mutationFn: (b: SandboxEndpointInput) => sandboxApi.create(b), onSuccess: inv }),
    update: useMutation({ mutationFn: ({ id, body }: { id: string; body: SandboxEndpointInput }) => sandboxApi.update(id, body), onSuccess: inv }),
    remove: useMutation({ mutationFn: (id: string) => sandboxApi.remove(id), onSuccess: inv }),
    clear: useMutation({ mutationFn: (id: string) => sandboxApi.clear(id), onSuccess: inv }),
    useFor: useMutation({
      mutationFn: ({ id, appId }: { id: string; appId: string }) => sandboxApi.useFor(id, appId),
      onSuccess: () => {
        void inv()
        void qc.invalidateQueries({ queryKey: ['applications'] })
      },
    }),
    sendTest: useMutation({ mutationFn: (id: string) => sandboxApi.sendTest(id), onSettled: inv }),
  }
}

// ---------- Admin console ----------

export const useAdminOverview = (range: AdminRange, live: boolean) =>
  useQuery({
    queryKey: ['admin', 'overview', range],
    queryFn: () => adminConsoleApi.overview(range),
    placeholderData: keepPreviousData,
    refetchInterval: live ? 10_000 : false,
  })

export const useAdminRequestLogs = (f: RequestLogFilters, live: boolean) =>
  useQuery({
    queryKey: ['admin', 'request-logs', f],
    queryFn: () => adminConsoleApi.requestLogs(f),
    placeholderData: keepPreviousData,
    refetchInterval: live ? 5000 : false,
  })

export const useAdminAccounts = (f: { type?: string; q?: string; status?: string; page?: number }) =>
  useQuery({ queryKey: ['admin', 'accounts', f], queryFn: () => adminConsoleApi.accounts(f), placeholderData: keepPreviousData })

export const useAdminAccount = (id: string | undefined) =>
  useQuery({ queryKey: ['admin', 'account', id], queryFn: () => adminConsoleApi.account(id!), enabled: !!id })

export const useAdminBusinesses = (f: { q?: string; status?: string; page?: number }) =>
  useQuery({ queryKey: ['admin', 'businesses', f], queryFn: () => adminConsoleApi.businesses(f), placeholderData: keepPreviousData })

export const useAdminDevices = (f: { status?: string; online?: string; q?: string; page?: number }, live: boolean) =>
  useQuery({
    queryKey: ['admin', 'devices', f],
    queryFn: () => adminConsoleApi.devices(f),
    placeholderData: keepPreviousData,
    refetchInterval: live ? 5000 : false,
  })

export const useAdminDeliveries = (f: { success?: boolean; error_code?: string; page?: number }) =>
  useQuery({ queryKey: ['admin', 'deliveries', f], queryFn: () => adminConsoleApi.deliveries({ ...f, page_size: 25 }), placeholderData: keepPreviousData })

export const useAdminSystem = (live: boolean) =>
  useQuery({ queryKey: ['admin', 'system'], queryFn: adminConsoleApi.system, refetchInterval: live ? 5000 : false })

export const usePlatformSettings = () => useQuery({ queryKey: ['admin', 'settings'], queryFn: adminConsoleApi.settings })

export function useAdminMutations() {
  const qc = useQueryClient()
  const inv = () => qc.invalidateQueries({ queryKey: ['admin'] })
  return {
    patchAccount: useMutation({
      mutationFn: ({ id, body }: { id: string; body: AdminAccountPatch }) => adminConsoleApi.patchAccount(id, body),
      onSuccess: inv,
    }),
    patchBusiness: useMutation({
      mutationFn: ({ id, body }: { id: string; body: { status?: 'active' | 'suspended'; plan_code?: string } }) =>
        adminConsoleApi.patchBusiness(id, body),
      onSuccess: inv,
    }),
    revokeDevice: useMutation({ mutationFn: (id: string) => adminConsoleApi.revokeDevice(id), onSuccess: inv }),
    patchSettings: useMutation({ mutationFn: (b: Partial<PlatformSettings>) => adminConsoleApi.patchSettings(b), onSuccess: inv }),
  }
}

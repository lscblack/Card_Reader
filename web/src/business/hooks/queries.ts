import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { businessApi, metaBizApi } from '../api/business'
import { actionsApi, cardsApi } from '../api/cards'
import { customersApi, employeesApi } from '../api/people'
import { formResponsesApi, pageTemplatesApi, profilesApi } from '../api/profiles'
import { analyticsApi, tapsApi } from '../api/insights'
import { bizAppsApi, bizDevicesApi } from '../api/integrations'
import { teamApi } from '../api/team'
import type { AnalyticsRange, ApiUsageRange, CardFilters, PeopleFilters, ProfileType, TapFilters } from '../api/types'
import { toList } from '../lib/format'

export const bk = {
  all: ['biz'] as const,
  list: ['biz', 'list'] as const,
  scope: (bid: string) => ['biz', bid] as const,
  detail: (bid: string) => ['biz', bid, 'detail'] as const,
  me: (bid: string) => ['biz', bid, 'me'] as const,
}

const k = (bid: string, ...rest: unknown[]) => ['biz', bid, ...rest] as const

// ---------- Business ----------

export const useBusinesses = (enabled = true) =>
  useQuery({ queryKey: bk.list, queryFn: businessApi.list, enabled, staleTime: 60_000 })

export const useBusinessDetail = (bid: string | undefined) =>
  useQuery({ queryKey: bk.detail(bid ?? ''), queryFn: () => businessApi.get(bid!), enabled: !!bid })

export const useBusinessMe = (bid: string | undefined) =>
  useQuery({ queryKey: bk.me(bid ?? ''), queryFn: () => businessApi.me(bid!), enabled: !!bid, staleTime: 60_000 })

export const useBizOverview = (bid: string) =>
  useQuery({ queryKey: k(bid, 'overview'), queryFn: () => businessApi.overview(bid), refetchInterval: 30_000 })

export const useBilling = (bid: string) => useQuery({ queryKey: k(bid, 'billing'), queryFn: () => businessApi.billing(bid) })

export const useBizPlans = () => useQuery({ queryKey: ['plans', 'all'], queryFn: metaBizApi.plans, staleTime: 10 * 60_000 })

export const useCategories = () =>
  useQuery({ queryKey: ['meta', 'business-categories'], queryFn: metaBizApi.categories, staleTime: Infinity })

// ---------- Cards & actions ----------

export const useCards = (bid: string, f: CardFilters, enabled = true) =>
  useQuery({ queryKey: k(bid, 'cards', f), queryFn: () => cardsApi.list(bid, f), placeholderData: keepPreviousData, enabled })

export const useCard = (bid: string, cid: string | undefined) =>
  useQuery({ queryKey: k(bid, 'card', cid), queryFn: () => cardsApi.get(bid, cid!), enabled: !!cid })

export const useCardHistory = (bid: string, cid: string) =>
  useQuery({ queryKey: k(bid, 'card', cid, 'history'), queryFn: async () => toList(await cardsApi.history(bid, cid)) })

export const useCardTaps = (bid: string, cid: string, page: number) =>
  useQuery({ queryKey: k(bid, 'card', cid, 'taps', page), queryFn: () => cardsApi.taps(bid, cid, page), placeholderData: keepPreviousData })

export const useCardStats = (bid: string, cid: string, range: AnalyticsRange) =>
  useQuery({ queryKey: k(bid, 'card', cid, 'stats', range), queryFn: () => cardsApi.stats(bid, cid, range), placeholderData: keepPreviousData })

export const useActionTypes = () => useQuery({ queryKey: ['action-types'], queryFn: actionsApi.types, staleTime: 30 * 60_000 })

// ---------- People ----------

export const useEmployees = (bid: string, f: PeopleFilters, enabled = true) =>
  useQuery({ queryKey: k(bid, 'employees', f), queryFn: () => employeesApi.list(bid, f), placeholderData: keepPreviousData, enabled })

export const useEmployee = (bid: string, id: string | undefined) =>
  useQuery({ queryKey: k(bid, 'employee', id), queryFn: () => employeesApi.get(bid, id!), enabled: !!id })

export const useCustomers = (bid: string, f: PeopleFilters, enabled = true) =>
  useQuery({ queryKey: k(bid, 'customers', f), queryFn: () => customersApi.list(bid, f), placeholderData: keepPreviousData, enabled })

export const useCustomer = (bid: string, id: string | undefined) =>
  useQuery({ queryKey: k(bid, 'customer', id), queryFn: () => customersApi.get(bid, id!), enabled: !!id })

// ---------- Profiles ----------

export const useProfiles = (bid: string, enabled = true) =>
  useQuery({ queryKey: k(bid, 'profiles'), queryFn: async () => toList(await profilesApi.list(bid, { page_size: 100 })), enabled })

export const useProfile = (bid: string, id: string | undefined) =>
  useQuery({ queryKey: k(bid, 'profile', id), queryFn: () => profilesApi.get(bid, id!), enabled: !!id })

/** Part 6 — system + business page templates (optionally for one page type). */
export const usePageTemplates = (bid: string, pageType?: ProfileType, enabled = true) =>
  useQuery({ queryKey: k(bid, 'page-templates', pageType ?? 'all'), queryFn: async () => toList(await pageTemplatesApi.list(bid, pageType)), enabled, staleTime: 60_000 })

export const useFormResponses = (bid: string, q: { profile_id?: string; page?: number; page_size?: number }, enabled = true) =>
  useQuery({ queryKey: k(bid, 'form-responses', q), queryFn: () => formResponsesApi.list(bid, q), placeholderData: keepPreviousData, enabled })

// ---------- Taps & analytics ----------

export const useTaps = (bid: string, f: TapFilters, refetchInterval: number | false = false) =>
  useQuery({ queryKey: k(bid, 'taps', f), queryFn: () => tapsApi.list(bid, f), placeholderData: keepPreviousData, refetchInterval })

export const useAnalytics = (bid: string, q: { range: AnalyticsRange; card_id?: string; employee_id?: string }, enabled = true) =>
  useQuery({ queryKey: k(bid, 'analytics', q), queryFn: () => analyticsApi.get(bid, q), placeholderData: keepPreviousData, enabled })

export const useApiUsage = (bid: string, range: ApiUsageRange, enabled = true) =>
  useQuery({ queryKey: k(bid, 'api-usage', range), queryFn: () => analyticsApi.apiUsage(bid, range), placeholderData: keepPreviousData, enabled })

// ---------- Devices & apps ----------

export const useBizApps = (bid: string, enabled = true) =>
  useQuery({ queryKey: k(bid, 'applications'), queryFn: () => bizAppsApi.list(bid), enabled })

export const useBizDevices = (bid: string, enabled = true) =>
  useQuery({ queryKey: k(bid, 'devices'), queryFn: () => bizDevicesApi.list(bid), enabled, refetchInterval: 30_000 })

export const useDeviceActivity = (bid: string, did: string | null) =>
  useQuery({ queryKey: k(bid, 'device', did, 'activity'), queryFn: () => bizDevicesApi.activity(bid, did!), enabled: !!did })

// ---------- Team ----------

export const useMembers = (bid: string) =>
  useQuery({ queryKey: k(bid, 'members'), queryFn: async () => toList(await teamApi.members(bid)) })

export const useInvitations = (bid: string, enabled = true) =>
  useQuery({ queryKey: k(bid, 'invitations'), queryFn: async () => toList(await teamApi.invitations(bid)), enabled })

// ---------- Mutations ----------

/**
 * Generic business mutation: on success, invalidates every query of the business (cheap: only
 * mounted queries refetch) plus the Part 1 caches that business screens reuse.
 */
export function useBizMutation<TVars, TData = unknown>(bid: string, fn: (vars: TVars) => Promise<TData>, extraKeys: readonly (readonly unknown[])[] = []) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    // Refresh in the background (don't await): awaiting would also wait for the refetch of an entity that was just
    // deleted (or a business just left), flashing its 404/403 error screen before the caller navigates away.
    onSuccess: () => {
      void Promise.all([
        qc.invalidateQueries({ queryKey: bk.scope(bid) }),
        qc.invalidateQueries({ queryKey: bk.list }),
        ...extraKeys.map((queryKey) => qc.invalidateQueries({ queryKey })),
      ])
    },
  })
}

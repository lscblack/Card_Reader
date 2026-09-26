import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { activityApi, cardsApi, contactsApi, invitesApi, sessionsApi, templatesApi } from '../api/personal'
import { isV2, type CardTemplateV2, type ContactFilters } from '../api/types'

const list = <T,>(d: T[] | { items: T[] }): T[] => (Array.isArray(d) ? d : (d.items ?? []))

export const pk = { all: ['personal'] as const }

export const usePCards = () => useQuery({ queryKey: ['personal', 'cards'], queryFn: async () => list(await cardsApi.list()) })
export const usePCard = (id: string | undefined) =>
  useQuery({ queryKey: ['personal', 'card', id], queryFn: () => cardsApi.get(id!), enabled: !!id })
export const useDesignPresets = () => useQuery({ queryKey: ['personal-design-presets'], queryFn: templatesApi.presets, staleTime: 30 * 60_000 })
export const useTemplates = () => useQuery({ queryKey: ['personal-templates'], queryFn: templatesApi.list, staleTime: 30 * 60_000 })
export const useContacts = (f: ContactFilters) =>
  useQuery({ queryKey: ['personal', 'contacts', f], queryFn: () => contactsApi.list(f), placeholderData: keepPreviousData })
export const useContact = (id: string | null) =>
  useQuery({ queryKey: ['personal', 'contact', id], queryFn: () => contactsApi.get(id!), enabled: !!id })
export const useActivity = (page: number) =>
  useQuery({ queryKey: ['personal', 'activity', page], queryFn: () => activityApi.list(page), placeholderData: keepPreviousData })
export const usePStats = (range: string) =>
  useQuery({ queryKey: ['personal', 'stats', range], queryFn: () => activityApi.stats(range), placeholderData: keepPreviousData })
export const useSessions = () => useQuery({ queryKey: ['personal', 'sessions'], queryFn: async () => list(await sessionsApi.list()) })
export const useInvites = () => useQuery({ queryKey: ['personal', 'invites'], queryFn: async () => list(await invitesApi.list()) })

/** Mutation that refreshes every personal query on success. */
export function usePMutation<TVars, TData = unknown>(fn: (v: TVars) => Promise<TData>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: pk.all }) })
}

/** v2 (shape) templates only — for showcases. */
export function useV2Templates(): CardTemplateV2[] {
  const { data } = useTemplates()
  return (data ?? []).filter(isV2)
}

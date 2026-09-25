import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { brandingApi } from '@/api/branding'
import { adminPlansApi, adminPromotionsApi } from '@/api/pricing'
import { adminEmailsApi, adminErrorsApi } from '@/api/emails'
import type { Branding, BrandingAssetVariant, PlanInput, Promotion, PromotionInput, SendEmailRequest } from '@/api/types'
import { useBranding } from '@/branding/context'

// ---------- Branding ----------

export const useFonts = () => useQuery({ queryKey: ['meta', 'fonts'], queryFn: brandingApi.fonts, staleTime: 60 * 60_000 })

/** Admin branding mutations; every success is applied to the running app immediately. */
export function useBrandingMutations() {
  const { setBranding } = useBranding()
  const apply = (b: Branding) => setBranding(b)
  return {
    update: useMutation({ mutationFn: (b: Partial<Branding>) => brandingApi.update(b), onSuccess: apply }),
    upload: useMutation({
      mutationFn: ({ variant, file }: { variant: BrandingAssetVariant; file: File }) => brandingApi.uploadAsset(variant, file),
      onSuccess: apply,
    }),
    remove: useMutation({ mutationFn: (variant: BrandingAssetVariant) => brandingApi.deleteAsset(variant), onSuccess: apply }),
  }
}

// ---------- Plans ----------

export const useAdminPlans = () => useQuery({ queryKey: ['admin', 'plans'], queryFn: adminPlansApi.list })

export function usePlanMutations() {
  const qc = useQueryClient()
  const inv = () => Promise.all([qc.invalidateQueries({ queryKey: ['admin', 'plans'] }), qc.invalidateQueries({ queryKey: ['plans'] })])
  return {
    create: useMutation({ mutationFn: (b: PlanInput) => adminPlansApi.create(b), onSuccess: inv }),
    update: useMutation({ mutationFn: ({ code, body }: { code: string; body: PlanInput }) => adminPlansApi.update(code, body), onSuccess: inv }),
    setActive: useMutation({
      mutationFn: ({ code, active }: { code: string; active: boolean }) => (active ? adminPlansApi.activate(code) : adminPlansApi.deactivate(code)),
      onSuccess: inv,
    }),
  }
}

// ---------- Promotions ----------

export const useAdminPromotions = () =>
  useQuery({
    queryKey: ['admin', 'promotions'],
    queryFn: async (): Promise<Promotion[]> => {
      const r = await adminPromotionsApi.list()
      return Array.isArray(r) ? r : r.items
    },
  })

export function usePromotionMutations() {
  const qc = useQueryClient()
  const inv = () => qc.invalidateQueries({ queryKey: ['admin', 'promotions'] })
  return {
    create: useMutation({ mutationFn: (b: PromotionInput) => adminPromotionsApi.create(b), onSuccess: inv }),
    update: useMutation({ mutationFn: ({ id, body }: { id: string; body: PromotionInput }) => adminPromotionsApi.update(id, body), onSuccess: inv }),
    remove: useMutation({ mutationFn: (id: string) => adminPromotionsApi.remove(id), onSuccess: inv }),
    setActive: useMutation({
      mutationFn: ({ id, active }: { id: string; active: boolean }) => (active ? adminPromotionsApi.activate(id) : adminPromotionsApi.deactivate(id)),
      onSuccess: inv,
    }),
  }
}

// ---------- Emails ----------

export const useEmailLogs = (f: { campaign_id?: string; status?: string; q?: string; page?: number }) =>
  useQuery({ queryKey: ['admin', 'emails', f], queryFn: () => adminEmailsApi.logs(f), placeholderData: keepPreviousData })
export const useEmailLog = (id: string | null) => useQuery({ queryKey: ['admin', 'email', id], queryFn: () => adminEmailsApi.log(id!), enabled: !!id })
export const useEmailCampaigns = (page: number) =>
  useQuery({ queryKey: ['admin', 'email-campaigns', page], queryFn: () => adminEmailsApi.campaigns(page), placeholderData: keepPreviousData })
export const useEmailTemplates = () => useQuery({ queryKey: ['admin', 'email-templates'], queryFn: adminEmailsApi.templates, staleTime: 10 * 60_000 })
export const useTemplatePreview = (name: string | null) =>
  useQuery({ queryKey: ['admin', 'email-template', name], queryFn: () => adminEmailsApi.templatePreview(name!), enabled: !!name })

export function useSendEmail() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: SendEmailRequest) => adminEmailsApi.send(b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
  })
}

// ---------- Error center ----------

export const useAdminErrors = (f: { range: string; source?: string; q?: string; only_occurring?: boolean }) =>
  useQuery({ queryKey: ['admin', 'errors', f], queryFn: () => adminErrorsApi.list(f), placeholderData: keepPreviousData })
export const useAdminError = (ref: string | undefined, range: string) =>
  useQuery({ queryKey: ['admin', 'error', ref, range], queryFn: () => adminErrorsApi.get(ref!, range), enabled: !!ref, placeholderData: keepPreviousData })

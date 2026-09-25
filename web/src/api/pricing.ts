import { api } from './client'
import type { AppliedPromotion, Plan, PlanInput, Promotion, PromotionInput } from './types'

export const adminPlansApi = {
  list: () => api.get<Plan[]>('/admin/plans'),
  create: (body: PlanInput) => api.post<Plan>('/admin/plans', body),
  update: (code: string, body: PlanInput) => api.patch<Plan>(`/admin/plans/${encodeURIComponent(code)}`, body),
  activate: (code: string) => api.post<Plan>(`/admin/plans/${encodeURIComponent(code)}/activate`),
  deactivate: (code: string) => api.post<Plan>(`/admin/plans/${encodeURIComponent(code)}/deactivate`),
}

export const adminPromotionsApi = {
  list: () => api.get<Promotion[] | { items: Promotion[] }>('/admin/promotions'),
  get: (id: string) => api.get<Promotion>(`/admin/promotions/${id}`),
  create: (body: PromotionInput) => api.post<Promotion>('/admin/promotions', body),
  update: (id: string, body: PromotionInput) => api.patch<Promotion>(`/admin/promotions/${id}`, body),
  remove: (id: string) => api.delete(`/admin/promotions/${id}`),
  activate: (id: string) => api.post<Promotion>(`/admin/promotions/${id}/activate`),
  deactivate: (id: string) => api.post<Promotion>(`/admin/promotions/${id}/deactivate`),
}

export const promotionsApi = {
  active: () => api.get<Promotion[]>('/billing/promotions/active'),
  validate: (code: string, plan_code: string) =>
    api.post<{ valid: boolean; promotion: AppliedPromotion | null; discounted_price_monthly_cents: number | null }>('/billing/promotions/validate', { code, plan_code }),
}

import { useQuery } from '@tanstack/react-query'
import { billingApi } from '@/api/billing'

/** Whether online payments are on and whether this account (or business) already pays online. */
export const usePaymentsState = (businessId?: string | null, enabled = true) =>
  useQuery({ queryKey: ['billing', 'payments', businessId ?? null], queryFn: () => billingApi.state(businessId), staleTime: 60_000, enabled })

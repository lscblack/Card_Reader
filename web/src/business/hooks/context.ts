import { createContext, useCallback, useContext } from 'react'
import type { Business, BusinessMe, Permission } from '../api/types'

export interface BusinessContextValue {
  business: Business
  businesses: Business[]
  me: BusinessMe | null
  /** Base URL of the active business area, e.g. `/business/<id>`. */
  base: string
}

export const BusinessContext = createContext<BusinessContextValue | null>(null)

export function useBusiness(): BusinessContextValue {
  const ctx = useContext(BusinessContext)
  if (!ctx) throw new Error('useBusiness must be used inside the business layout')
  return ctx
}

/** Permission check for UI purposes only — the backend enforces (403 insufficient_permissions). */
export function useCan(): (p: Permission) => boolean {
  const { me } = useBusiness()
  return useCallback((p: Permission) => !!me?.permissions.includes(p), [me])
}

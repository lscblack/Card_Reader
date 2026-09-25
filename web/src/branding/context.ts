import { createContext, useContext } from 'react'
import type { Branding } from '@/api/types'
import { DEFAULT_BRANDING } from './defaults'

export interface BrandingState {
  /** Always defined: cached / fetched branding, or the built-in defaults. */
  branding: Branding
  /** True until the first network response (cached values may already be showing). */
  loading: boolean
  /** Re-fetch GET /meta/branding and apply it. */
  refresh: () => Promise<void>
  /** Apply a branding object immediately (e.g. after an admin save) and cache it. */
  setBranding: (b: Branding) => void
}

export const BrandingContext = createContext<BrandingState>({
  branding: DEFAULT_BRANDING,
  loading: false,
  refresh: async () => undefined,
  setBranding: () => undefined,
})

/** Branding for the current app. Works without a provider (returns defaults). */
export function useBranding(): BrandingState {
  return useContext(BrandingContext)
}

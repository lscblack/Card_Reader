import { useSyncExternalStore } from 'react'
import { useAuth } from '@/auth/context'
import { homePathFor } from '@/api/auth'
import { useBranding } from '@/branding/context'

/** The signed-in user's home area (developer → /dashboard, business → /business, personal → /me, admin → /admin). */
export function useDashboardPath(): string {
  return homePathFor(useAuth().user)
}

export type NavTarget = 'product' | 'developers' | 'businesses' | 'individuals' | 'pricing'

export function useIsLoggedIn(): boolean {
  return useAuth().status === 'authenticated'
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Smoothly scrolls to an element id (instant when reduced motion is requested) and updates the hash.
 * Below-the-fold sections are lazy-loaded, so the target may not exist yet: retry for a couple of seconds.
 */
export function scrollToId(id: string, tries = 25) {
  const el = document.getElementById(id)
  if (!el) {
    if (tries > 0) window.setTimeout(() => scrollToId(id, tries - 1), 100)
    return
  }
  el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
  history.replaceState(null, '', `#${id}`)
}

const RM_QUERY = '(prefers-reduced-motion: reduce)'
function subscribeReducedMotion(cb: () => void) {
  const mq = window.matchMedia(RM_QUERY)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

/**
 * Live `prefers-reduced-motion` flag. Used instead of motion's `useReducedMotion` (which logs a dev-only
 * console warning whenever reduced motion is on); every animated component renders a static version when true.
 */
export function useReducedMotionPref(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false)
}

/** Product name from runtime branding (Part 3 §1), with the built-in default. */
export function useProductName(): string {
  return useBranding().branding.product_name || 'NFC Platform'
}

export const POWERED_BY_URL = 'http://nexventures.net/'

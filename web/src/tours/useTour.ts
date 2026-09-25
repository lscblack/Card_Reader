import { useEffect, useSyncExternalStore } from 'react'
import { useAuth } from '@/auth/context'
import { bindTourUser, getPageTours, maybeAutoStart, registerTour, setPageTour, startTour, subscribePageTours, type TourStep } from './engine'

/**
 * Registers a product tour for the current page and auto-starts it on the first visit.
 *
 *   useTour('business.dashboard', steps)            // auto-start once, replayable from the user menu
 *   useTour('x', steps, { auto: false, ready })      // wait until data has rendered (ready=true)
 *
 * Steps point at elements via selectors (use `data-tour="…"` attributes); hidden elements are skipped.
 */
export function useTour(id: string, steps: TourStep[], opts: { auto?: boolean; ready?: boolean; delayMs?: number } = {}) {
  const { user, setUser, status } = useAuth()
  const { auto = true, ready = true, delayMs = 900 } = opts
  registerTour(id, steps)

  useEffect(() => {
    bindTourUser(user, setUser)
  }, [user, setUser])

  useEffect(() => {
    setPageTour(id, true)
    return () => setPageTour(id, false)
  }, [id])

  useEffect(() => {
    if (!auto || !ready || status !== 'authenticated') return
    const t = setTimeout(() => maybeAutoStart(id), delayMs)
    return () => clearTimeout(t)
  }, [id, auto, ready, status, delayMs])

  return { start: () => startTour(id) }
}

/** Tour ids registered by the components currently mounted (latest first). */
export function usePageTours(): string[] {
  return useSyncExternalStore(subscribePageTours, getPageTours)
}

import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { USE_MOCKS } from '@/api/client'
import { visitsApi } from '@/api/visits'

/** Signed-in areas aren't website visits (the API ignores them too). */
const PRIVATE = /^\/(dashboard|admin|business|me|checkout|reset-password|verify-email|invite)(\/|$)/
/** The same page in the same tab counts once per 30 minutes. */
const WINDOW_MS = 30 * 60_000
const KEY = 'nfc.visits'

function seenRecently(path: string): boolean {
  try {
    const seen = JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as Record<string, number>
    const now = Date.now()
    if (seen[path] && now - seen[path] < WINDOW_MS) return true
    seen[path] = now
    sessionStorage.setItem(KEY, JSON.stringify(seen))
    return false
  } catch {
    return false
  }
}

/** Records a visit for each public page the browser opens (landing, docs, support, /b/…, /p/…). */
export function useVisitTracker(): void {
  const { pathname } = useLocation()
  useEffect(() => {
    if (USE_MOCKS || PRIVATE.test(pathname) || seenRecently(pathname)) return
    // The referrer only describes how the tab arrived, so it's sent with the first page of the tab only.
    const first = !sessionStorage.getItem(`${KEY}.started`)
    try {
      sessionStorage.setItem(`${KEY}.started`, '1')
    } catch {
      /* private mode */
    }
    visitsApi.record(pathname, first ? document.referrer || null : null).catch(() => {})
  }, [pathname])
}

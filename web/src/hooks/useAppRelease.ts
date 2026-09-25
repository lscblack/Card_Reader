import { useQuery } from '@tanstack/react-query'
import { API_BASE_URL } from '@/api/client'
import { releasesApi } from '@/api/platform'
import type { PublicAppRelease } from '@/api/types'

/** Absolute URL for API-served files (e.g. `/downloads/android/latest`). */
export function apiFileUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `${API_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`
}

/** Latest published Android release, or null when there is none (404 no_release) or the API predates it. */
export function useAppRelease() {
  return useQuery({
    queryKey: ['meta', 'app-release'],
    queryFn: async (): Promise<PublicAppRelease | null> => {
      try {
        const r = await releasesApi.latest()
        return r ? { ...r, download_url: apiFileUrl(r.download_url) } : null
      } catch {
        return null
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  })
}

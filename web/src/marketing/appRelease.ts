import { useQuery } from '@tanstack/react-query'
import { ApiError, API_BASE_URL, request } from '@/api/client'

/** `GET /meta/app-release` (Part 3 §9) — latest published stable Android build. */
export interface PublicAppRelease {
  version_name: string
  build_number: number
  file_size: number
  sha256: string
  published_at: string
  download_url: string
  min_android: string
}

/** Resolves to `null` when no release is published yet (404 no_release). */
export async function fetchAppRelease(): Promise<PublicAppRelease | null> {
  try {
    return await request<PublicAppRelease>('GET', '/meta/app-release', { auth: false })
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null
    throw e
  }
}

/** Absolute download URL (the API may return a path relative to the API server). */
export function absoluteDownloadUrl(r: PublicAppRelease): string {
  return /^https?:\/\//.test(r.download_url) ? r.download_url : `${API_BASE_URL}${r.download_url.startsWith('/') ? '' : '/'}${r.download_url}`
}

export function formatBytes(n: number): string {
  if (!n) return '—'
  const mb = n / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(n / 1024)} KB`
}

export function useAppRelease() {
  return useQuery({ queryKey: ['public', 'app-release'], queryFn: fetchAppRelease, staleTime: 10 * 60_000, retry: false })
}

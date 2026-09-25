import { ApiError, API_BASE_URL, API_PREFIX } from '@/api/client'
import { getToken } from '@/auth/tokenStore'

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024
export const UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp']

/** Client-side check mirroring B2 (png/jpeg/webp ≤ 2 MB). Returns an error message or null. */
export function checkImage(file: File): string | null {
  if (!UPLOAD_TYPES.includes(file.type)) return 'Use a PNG, JPEG or WebP image.'
  if (file.size > MAX_UPLOAD_BYTES) return 'The image must be 2 MB or smaller.'
  return null
}

/** Multipart upload (`file` field). The JSON request helper can't send FormData, hence this. */
export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const token = getToken()
  // Inline env check (not the imported constant) so the mock module is dropped from production builds.
  if (import.meta.env.VITE_USE_MOCKS === 'true') {
    const { mockRequest } = await import('@/api/mock/server')
    const res = await mockRequest('POST', path, undefined, { file_url: URL.createObjectURL(file), file_name: file.name }, token)
    if (res.status >= 200 && res.status < 300) return res.body as T
    const e = (res.body as { error?: { code?: string; message?: string; details?: unknown } })?.error
    throw new ApiError(res.status, e?.code ?? `http_${res.status}`, e?.message ?? 'Upload failed', e?.details ?? null)
  }
  const form = new FormData()
  form.append('file', file)
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${API_PREFIX}${path}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}`, Accept: 'application/json' } : { Accept: 'application/json' },
      body: form,
    })
  } catch {
    throw new ApiError(0, 'network_error', `Cannot reach the API at ${API_BASE_URL}.`)
  }
  const text = await res.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (res.ok) return body as T
  const env = (body as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error
  throw new ApiError(res.status, env?.code ?? `http_${res.status}`, env?.message ?? `Upload failed (${res.status})`, env?.details ?? null)
}

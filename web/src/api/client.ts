import { clearToken, getToken } from '@/auth/tokenStore'
import type { ValidationErrorDetail } from './types'

/**
 * Backend origin. When VITE_API_BASE_URL is empty the API is assumed to run on port 8000 of the same host
 * the dashboard was loaded from — so opening the dashboard from a phone on the LAN just works.
 */
function defaultApiBase(): string {
  if (typeof window === 'undefined' || !window.location?.hostname) return 'http://127.0.0.1:8000'
  const host = window.location.hostname.includes(':') ? `[${window.location.hostname}]` : window.location.hostname
  return `${window.location.protocol}//${host}:8000`
}
export const API_BASE_URL: string = ((import.meta.env.VITE_API_BASE_URL ?? '').trim() || defaultApiBase()).replace(/\/+$/, '')
export const API_PREFIX = '/api/v1'
export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true'

/** Public docs page for an error catalog ref (fallback when the server doesn't send `docs_url`). */
export function errorDocsUrl(ref: string): string {
  return `/docs/errors#${encodeURIComponent(ref)}`
}

export interface ApiErrorMeta {
  retryAfter?: number | null
  /** Stable catalog id, e.g. `NFC-1003` (Part 2 §A1). */
  ref?: string | null
  /** Correlates with request logs. */
  requestId?: string | null
  docsUrl?: string | null
}

/** Typed representation of the `{ error: { code, message, details, ref?, request_id?, docs_url? } }` envelope. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown
  /** Seconds, from the `Retry-After` header on 429 responses. */
  readonly retryAfter: number | null
  readonly ref: string | null
  readonly requestId: string | null
  readonly docsUrl: string | null

  constructor(status: number, code: string, message: string, details: unknown = null, meta: ApiErrorMeta | number | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    const m: ApiErrorMeta = typeof meta === 'number' ? { retryAfter: meta } : (meta ?? {})
    this.retryAfter = m.retryAfter ?? null
    this.ref = m.ref ?? null
    this.requestId = m.requestId ?? null
    this.docsUrl = m.docsUrl ?? (m.ref ? errorDocsUrl(m.ref) : null)
  }

  get isRateLimited(): boolean {
    return this.status === 429 || this.code === 'rate_limited'
  }

  get isPlanLimit(): boolean {
    return this.status === 402 || this.code === 'plan_limit_reached'
  }

  /** Validation errors as a `{ field -> message }` map (field names without the `body.` prefix). */
  get fieldErrors(): Record<string, string> {
    if (this.code !== 'validation_error' || !Array.isArray(this.details)) return {}
    const out: Record<string, string> = {}
    for (const d of this.details as ValidationErrorDetail[]) {
      if (d && typeof d.field === 'string') {
        const key = d.field.replace(/^(body|query|path)\./, '')
        out[key] ??= d.message
      }
    }
    return out
  }
}

/** Human-friendly message for any thrown value, with special wording for 429 / 402. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.isRateLimited) {
      return err.retryAfter
        ? `Too many requests. Please wait ${err.retryAfter}s and try again.`
        : 'Too many requests. Please slow down and try again shortly.'
    }
    if (err.isPlanLimit) {
      return `${err.message || 'Plan limit reached.'} Upgrade your plan on the Usage page to raise your limits.`
    }
    if (err.code === 'validation_error') {
      const fields = Object.entries(err.fieldErrors)
      if (fields.length) return fields.map(([f, m]) => `${f}: ${m}`).join(' · ')
    }
    return err.message || `Request failed (${err.status})`
  }
  if (err instanceof Error) return err.message
  return 'Something went wrong'
}

type Query = Record<string, string | number | boolean | null | undefined>

export interface RequestOptions {
  query?: Query
  body?: unknown
  /** Attach the dashboard JWT (default true). */
  auth?: boolean
  signal?: AbortSignal
}

let unauthorizedHandler: (() => void) | null = null
/** Registered by the AuthProvider: called when an authenticated request returns 401. */
export function onUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler
}

function buildQuery(query?: Query): string {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue
    params.set(k, String(v))
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}

export interface RawResponse {
  status: number
  headers: Headers
  body: unknown
}

async function send(method: string, path: string, opts: RequestOptions): Promise<RawResponse> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const token = opts.auth === false ? null : getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const multipart = typeof FormData !== 'undefined' && opts.body instanceof FormData
  if (opts.body !== undefined && !multipart) headers['Content-Type'] = 'application/json'

  if (import.meta.env.VITE_USE_MOCKS === 'true') {
    // Statically false in normal builds, so the mock module is tree-shaken away.
    const { mockRequest } = await import('./mock/server')
    let body = opts.body
    if (multipart) {
      const file = (opts.body as FormData).get('file')
      body = file instanceof File ? { file_url: URL.createObjectURL(file), file_name: file.name, file_type: file.type, file_size: file.size } : {}
    }
    return mockRequest(method, path, opts.query, body, token)
  }

  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${API_PREFIX}${path}${buildQuery(opts.query)}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : multipart ? (opts.body as FormData) : JSON.stringify(opts.body),
      signal: opts.signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiError(0, 'network_error', `Cannot reach the API at ${API_BASE_URL}. Is the backend running?`)
  }
  let body: unknown = null
  if (res.status !== 204) {
    const text = await res.text()
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }
    }
  }
  return { status: res.status, headers: res.headers, body }
}

export async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const { status, headers, body } = await send(method, path, opts)
  if (status >= 200 && status < 300) return body as T

  const env = (body && typeof body === 'object' && 'error' in body ? (body as { error: unknown }).error : null) as
    | { code?: string; message?: string; details?: unknown; ref?: string; request_id?: string; docs_url?: string }
    | null
  const retryRaw = headers.get('Retry-After')
  const retryAfter = retryRaw && /^\d+$/.test(retryRaw) ? Number(retryRaw) : null
  const err = new ApiError(
    status,
    env?.code ?? (status === 429 ? 'rate_limited' : status === 402 ? 'plan_limit_reached' : `http_${status}`),
    env?.message ?? (typeof body === 'string' && body ? body.slice(0, 200) : `Request failed with status ${status}`),
    env?.details ?? null,
    {
      retryAfter,
      ref: env?.ref ?? null,
      requestId: env?.request_id ?? headers.get('X-Request-Id'),
      docsUrl: env?.docs_url ?? null,
    },
  )

  // A 401 on an authenticated call means the session is gone (expired / revoked / invalidated by a
  // password change). `invalid_credentials` is excluded: it signals a wrong *current password*.
  // `403 account_disabled` also ends the session.
  const sessionEnded =
    (status === 401 && err.code !== 'invalid_credentials') || (status === 403 && err.code === 'account_disabled')
  if (sessionEnded && opts.auth !== false) {
    clearToken()
    unauthorizedHandler?.()
  }
  throw err
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>('GET', path, { query, signal }),
  post: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'body'> = {}) =>
    request<T>('POST', path, { ...opts, body: body ?? undefined }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
  delete: <T = void>(path: string, query?: Query) => request<T>('DELETE', path, { query }),
  /** Multipart upload of one file in the `file` field. */
  upload: <T>(path: string, file: File, query?: Query) => {
    const form = new FormData()
    form.append('file', file)
    return request<T>('POST', path, { body: form, query })
  },
}

/** @deprecated Swagger is disabled on the backend (Part 3 §6); link to the public web docs instead. */
export const SWAGGER_URL = `${API_BASE_URL}/docs`

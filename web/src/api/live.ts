import { ApiError, API_BASE_URL, API_PREFIX } from './client'
import { getToken } from '@/auth/tokenStore'
import type { LiveMessage } from './types'

export interface LiveStreamOptions {
  /** ISO timestamp: replay events since then (server keeps ~10 minutes / 100 events). */
  since?: string | null
  signal: AbortSignal
  onOpen?: () => void
  onMessage: (m: LiveMessage) => void
}

const KNOWN = new Set(['event.received', 'delivery.attempt', 'sandbox.request', 'business.tap'])

/**
 * Part 3 §8 live stream over fetch (so the Authorization header can be sent; EventSource can't).
 * Resolves when the server closes the stream; rejects with ApiError on HTTP errors
 * (`503 live_unavailable` → caller falls back to polling, `429 too_many_streams`).
 */
export async function streamLive(appId: string, opts: LiveStreamOptions): Promise<void> {
  if (import.meta.env.VITE_USE_MOCKS === 'true') {
    const { mockLiveStream } = await import('./mock/server')
    return mockLiveStream(appId, opts)
  }
  const token = getToken()
  const qs = opts.since ? `?since=${encodeURIComponent(opts.since)}` : ''
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${API_PREFIX}/live/applications/${appId}${qs}`, {
      headers: { Accept: 'text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: opts.signal,
      cache: 'no-store',
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return
    throw new ApiError(0, 'network_error', `Cannot reach the API at ${API_BASE_URL}.`)
  }
  if (!res.ok || !res.body) {
    type Env = { code?: string; message?: string; ref?: string; request_id?: string; docs_url?: string }
    let env: Env | null = null
    try {
      env = ((await res.json()) as { error?: Env }).error ?? null
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, env?.code ?? `http_${res.status}`, env?.message ?? `Live stream failed (${res.status})`, null, {
      ref: env?.ref,
      requestId: env?.request_id,
      docsUrl: env?.docs_url,
      retryAfter: Number(res.headers.get('Retry-After')) || null,
    })
  }
  opts.onOpen?.()
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
      let idx: number
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        let event = 'message'
        const data: string[] = []
        for (const line of raw.split('\n')) {
          if (!line || line.startsWith(':')) continue // heartbeat / comment
          const colon = line.indexOf(':')
          const field = colon < 0 ? line : line.slice(0, colon)
          const val = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
          if (field === 'event') event = val
          else if (field === 'data') data.push(val)
        }
        if (!data.length) continue
        try {
          const parsed = JSON.parse(data.join('\n')) as Record<string, unknown>
          // Accept both `event: <type>` + data, and `{type, data}` envelopes.
          const type = KNOWN.has(event) ? event : (parsed.type as string)
          const payload = KNOWN.has(event) ? parsed : (parsed.data as Record<string, unknown>)
          if (KNOWN.has(type)) opts.onMessage({ type, data: payload } as unknown as LiveMessage)
        } catch {
          /* ignore malformed frame */
        }
      }
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return
    throw e
  }
}

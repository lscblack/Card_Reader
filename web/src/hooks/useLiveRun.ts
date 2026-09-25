import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '@/api/client'
import { eventsApi } from '@/api/events'
import { streamLive } from '@/api/live'
import type { LiveBusinessTap, LiveDeliveryAttempt, LiveEventReceived, LiveMessage, LiveSandboxRequest } from '@/api/types'

export interface LiveTap {
  key: string
  event_id: string | null
  at: string
  received?: LiveEventReceived
  attempts: LiveDeliveryAttempt[]
  sandbox: LiveSandboxRequest[]
  business?: LiveBusinessTap
}

export type LiveStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'polling' | 'error'

const MAX_TAPS = 200
const iso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

/**
 * Live run mode (Part 3 §8): streams taps + delivery attempts for one application.
 * Reconnects with `?since=` after drops; falls back to polling /events on `503 live_unavailable`.
 */
export function useLiveRun(appId: string | null, running: boolean, onTap?: (t: LiveTap) => void) {
  const [taps, setTaps] = useState<LiveTap[]>([])
  const [status, setStatus] = useState<LiveStatus>('idle')
  const [problem, setProblem] = useState<unknown>(null)
  const lastAt = useRef<string | null>(null)
  const onTapRef = useRef(onTap)
  useEffect(() => {
    onTapRef.current = onTap
  })

  const apply = useCallback((m: LiveMessage) => {
    lastAt.current = iso()
    setTaps((prev) => {
      const next = [...prev]
      const find = (id: string | null) => (id ? next.findIndex((t) => t.event_id === id) : -1)
      if (m.type === 'event.received') {
        const i = find(m.data.event_id)
        const tap: LiveTap =
          i >= 0
            ? { ...next[i], received: m.data }
            : { key: m.data.event_id, event_id: m.data.event_id, at: m.data.detected_at ?? iso(), received: m.data, attempts: [], sandbox: [] }
        if (i >= 0) next[i] = tap
        else {
          next.unshift(tap)
          onTapRef.current?.(tap)
        }
      } else if (m.type === 'delivery.attempt') {
        const i = find(m.data.event_id)
        if (i >= 0) {
          const attempts = next[i].attempts.filter((a) => a.attempt !== m.data.attempt)
          next[i] = { ...next[i], attempts: [...attempts, m.data].sort((a, b) => a.attempt - b.attempt) }
        } else next.unshift({ key: `${m.data.event_id}`, event_id: m.data.event_id, at: iso(), attempts: [m.data], sandbox: [] })
      } else if (m.type === 'sandbox.request') {
        const i = find(m.data.event_id)
        if (i >= 0) next[i] = { ...next[i], sandbox: [...next[i].sandbox.filter((r) => r.request_id !== m.data.request_id), m.data] }
      } else if (m.type === 'business.tap') {
        const tap: LiveTap = { key: `biz-${m.data.card_id}-${Date.now()}`, event_id: null, at: iso(), attempts: [], sandbox: [], business: m.data }
        next.unshift(tap)
        onTapRef.current?.(tap)
      }
      return next.slice(0, MAX_TAPS)
    })
  }, [])

  useEffect(() => {
    if (!appId || !running) return
    const ctrl = new AbortController()
    let stopped = false
    let attempt = 0
    let pollTimer: ReturnType<typeof setTimeout> | undefined
    const seenDeliveries = new Set<string>()
    const seenEvents = new Set<string>()

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

    async function poll() {
      if (stopped) return
      try {
        const since = lastAt.current ?? new Date(Date.now() - 60_000).toISOString()
        const page = await eventsApi.list({ application_id: appId!, date_from: since.replace(/\.\d{3}Z$/, 'Z'), page_size: 20 })
        for (const e of [...page.items].reverse()) {
          if (!seenEvents.has(e.id)) {
            seenEvents.add(e.id)
            apply({
              type: 'event.received',
              data: {
                event_id: e.id,
                card_id: e.card_id,
                card_type: e.card_type,
                card_technologies: e.card_technologies,
                device_id: e.device_id,
                device_name: e.device_name,
                detected_at: e.detected_at,
                delivery_mode: e.delivery_mode,
              },
            })
          }
          if (e.status !== 'pending') {
            const detail = await eventsApi.get(e.id)
            for (const d of detail.deliveries) {
              if (seenDeliveries.has(d.id)) continue
              seenDeliveries.add(d.id)
              apply({
                type: 'delivery.attempt',
                data: {
                  event_id: e.id,
                  attempt: d.attempt,
                  mode: d.mode,
                  url: d.url,
                  success: d.success,
                  status_code: d.status_code,
                  latency_ms: d.latency_ms,
                  error_code: d.error_code ?? null,
                  error_ref: d.error_ref ?? null,
                  response_excerpt: d.response_excerpt,
                  response_headers: null,
                  request_payload: null,
                },
              })
            }
          }
        }
        setProblem(null)
      } catch (e) {
        setProblem(e)
      }
      if (!stopped) pollTimer = setTimeout(poll, 3000)
    }

    async function loop() {
      setStatus('connecting')
      while (!stopped) {
        try {
          await streamLive(appId!, {
            since: lastAt.current,
            signal: ctrl.signal,
            onOpen: () => {
              attempt = 0
              setProblem(null)
              setStatus('live')
            },
            onMessage: apply,
          })
          if (stopped) return
          // Server closed the stream: reconnect quickly.
          setStatus('reconnecting')
          await sleep(1000)
        } catch (e) {
          if (stopped) return
          if (e instanceof ApiError && (e.code === 'live_unavailable' || e.status === 503 || e.status === 404)) {
            setStatus('polling')
            setProblem(null)
            lastAt.current ??= new Date(Date.now() - 60_000).toISOString()
            void poll()
            return
          }
          if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
            setProblem(e)
            setStatus('error')
            return
          }
          setProblem(e)
          setStatus('reconnecting')
          attempt++
          const wait = e instanceof ApiError && e.retryAfter ? e.retryAfter * 1000 : Math.min(15_000, 1000 * 2 ** attempt)
          await sleep(wait)
        }
      }
    }
    void loop()
    return () => {
      stopped = true
      ctrl.abort()
      if (pollTimer) clearTimeout(pollTimer)
    }
  }, [appId, running, apply])

  const clear = useCallback(() => setTaps([]), [])
  return { taps, status: appId && running ? status : ('idle' as LiveStatus), problem, clear }
}

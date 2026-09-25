import { useSearchParams } from 'react-router'
import type { RequestLogFilters, RequestOutcome } from '@/api/types'

// ---------- Filters bound to the URL ----------

const FILTER_KEYS = ['outcome', 'status', 'route', 'error_code', 'from', 'to', 'request_id', 'actor_type', 'user_id', 'business_id', 'min_latency_ms', 'application_id', 'device_id'] as const

function dayBoundary(day: string, end: boolean): string | undefined {
  if (!day) return undefined
  const d = new Date(`${day}T${end ? '23:59:59.999' : '00:00:00'}`)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function useLogFilterParams(pageSize = 25) {
  const [params, setParams] = useSearchParams()
  const get = (k: string) => params.get(k) ?? ''
  const page = Math.max(1, Number(params.get('page')) || 1)
  const set = (updates: Record<string, string>, resetPage = true) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(updates)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    if (resetPage) next.delete('page')
    setParams(next, { replace: true })
  }
  const values = Object.fromEntries(FILTER_KEYS.map((k) => [k, get(k)])) as Record<(typeof FILTER_KEYS)[number], string>
  const filters: RequestLogFilters = {
      outcome: (values.outcome as RequestOutcome) || undefined,
      status: values.status || undefined,
      route: values.route || undefined,
      error_code: values.error_code || undefined,
      date_from: dayBoundary(values.from, false),
      date_to: dayBoundary(values.to, true),
      request_id: values.request_id || undefined,
      actor_type: (values.actor_type as RequestLogFilters['actor_type']) || undefined,
      user_id: values.user_id || undefined,
      business_id: values.business_id || undefined,
      min_latency_ms: values.min_latency_ms || undefined,
      application_id: values.application_id || undefined,
      device_id: values.device_id || undefined,
      page,
      page_size: pageSize,
  }
  const active = FILTER_KEYS.some((k) => !!values[k])
  return { values, filters, page, set, clear: () => setParams({}, { replace: true }), active }
}


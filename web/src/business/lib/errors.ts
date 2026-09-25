import { ApiError } from '@/api/client'

/** Catalog ref (e.g. `NFC-6003`) from Part 2 error envelopes, if present. */
export function errorRef(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null
  const ref = (err as { ref?: unknown }).ref
  return typeof ref === 'string' && ref ? ref : null
}

export function requestId(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null
  const id = (err as { requestId?: unknown; request_id?: unknown }).requestId ?? (err as { request_id?: unknown }).request_id
  return typeof id === 'string' && id ? id : null
}

export function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403 && (err.code === 'insufficient_permissions' || err.code === 'forbidden')
}

export function requiredPermission(err: unknown): string | null {
  if (!(err instanceof ApiError) || !err.details || typeof err.details !== 'object') return null
  const r = (err.details as { required?: unknown }).required
  return typeof r === 'string' ? r : null
}

export function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404
}

/** Field errors for validation_error and invalid_action_config (`details` as list or map). */
export function fieldErrorsOf(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError)) return {}
  if (err.code === 'validation_error') return err.fieldErrors
  const out: Record<string, string> = {}
  const d = err.details
  if (Array.isArray(d)) {
    for (const x of d) {
      if (x && typeof x === 'object' && typeof (x as { field?: unknown }).field === 'string') {
        const raw = String((x as { field: string }).field).replace(/^(body|query|path)\./, '')
        const f = raw.includes('config.') ? (raw.split('config.').pop() ?? raw) : raw.replace(/^action\./, '')
        out[f] ??= String((x as { message?: unknown }).message ?? 'Invalid value')
      }
    }
  } else if (d && typeof d === 'object') {
    for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
      if (typeof v === 'string') out[k.replace(/^(action\.)?config\./, '')] = v
    }
  }
  return out
}

/** Human message incl. catalog ref, for toasts. */
export function formatError(err: unknown): string {
  if (isForbidden(err)) {
    const req = requiredPermission(err)
    return `You don’t have permission to do this${req ? ` (requires ${req})` : ''}.`
  }
  const ref = errorRef(err)
  return ref ? `${errorMessageSafe(err)} (${ref})` : errorMessageSafe(err)
}

function errorMessageSafe(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'validation_error' || err.code === 'invalid_action_config') {
      const f = Object.entries(fieldErrorsOf(err))
      if (f.length) return f.map(([k, v]) => `${k}: ${v}`).join(' · ')
    }
    if (err.isRateLimited) return err.retryAfter ? `Too many requests. Please wait ${err.retryAfter}s.` : 'Too many requests. Please slow down.'
    if (err.isPlanLimit) return `${err.message || 'Plan limit reached.'} Upgrade your plan in Billing to raise your limits.`
    return err.message || `Request failed (${err.status})`
  }
  if (err instanceof Error) return err.message
  return 'Something went wrong'
}

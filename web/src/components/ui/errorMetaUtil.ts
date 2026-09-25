import { ApiError } from '@/api/client'

export interface ErrorMetaInfo {
  ref?: string | null
  requestId?: string | null
  docsUrl?: string | null
}

export function metaOf(err: unknown): ErrorMetaInfo | null {
  if (!(err instanceof ApiError)) return null
  if (!err.ref && !err.requestId) return null
  return { ref: err.ref, requestId: err.requestId, docsUrl: err.docsUrl }
}


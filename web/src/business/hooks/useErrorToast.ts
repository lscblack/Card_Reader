import { useCallback } from 'react'
import { useToast } from '@/components/ui/toastContext'
import { formatError } from '../lib/errors'

/** Toasts an API error with its catalog ref (e.g. “… (NFC-6003)”) and permission wording. */
export function useErrorToast() {
  const toast = useToast()
  return useCallback((err: unknown, title?: string) => toast.error(formatError(err), title), [toast])
}

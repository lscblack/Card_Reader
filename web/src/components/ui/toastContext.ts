import { createContext, useContext } from 'react'

export type ToastTone = 'success' | 'error' | 'info'
export interface ToastMeta {
  ref?: string | null
  requestId?: string | null
  docsUrl?: string | null
}

export interface ToastApi {
  success: (msg: string, title?: string) => void
  error: (msg: string, title?: string, meta?: ToastMeta | null) => void
  info: (msg: string, title?: string) => void
  /** Error toast from any thrown value; shows catalog ref + request id when the API sent them. */
  fromError: (err: unknown, title?: string) => void
}

export const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}

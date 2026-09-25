import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/api/client'
import { ToastContext, type ToastApi, type ToastMeta, type ToastTone } from './toastContext'
import { ErrorMeta } from './ErrorMeta'
import { metaOf } from './errorMetaUtil'

interface ToastItem {
  id: number
  tone: ToastTone
  title?: string
  message: string
  meta?: ToastMeta | null
}

const icons = { success: CheckCircle2, error: XCircle, info: Info }
const iconColor = {
  success: 'text-emerald-500',
  error: 'text-red-500',
  info: 'text-accent',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((t) => t.id !== id)), [])

  const push = useCallback(
    (tone: ToastTone, message: string, title?: string, meta?: ToastMeta | null) => {
      const id = nextId.current++
      setItems((xs) => [...xs.slice(-3), { id, tone, message, title, meta }])
      setTimeout(() => dismiss(id), tone === 'error' ? (meta ? 12000 : 7000) : 4000)
    },
    [dismiss],
  )

  const api = useMemo<ToastApi>(
    () => ({
      success: (m, t) => push('success', m, t),
      error: (m, t, meta) => push('error', m, t, meta),
      info: (m, t) => push('info', m, t),
      fromError: (err, t) => push('error', errorMessage(err), t, metaOf(err)),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end"
        aria-live="polite"
      >
        {items.map((t) => {
          const Icon = icons[t.tone]
          return (
            <div
              key={t.id}
              role={t.tone === 'error' ? 'alert' : 'status'}
              className="animate-toast-in pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-border bg-surface p-3.5 shadow-lg"
            >
              <Icon className={cn('mt-0.5 h-4.5 w-4.5 shrink-0', iconColor[t.tone])} />
              <div className="min-w-0 flex-1">
                {t.title && <p className="text-[13px] font-semibold">{t.title}</p>}
                <p className="text-[13px] break-words text-muted">{t.message}</p>
                {t.meta && <ErrorMeta meta={t.meta} className="text-muted" />}
              </div>
              <button onClick={() => dismiss(t.id)} className="rounded p-0.5 text-subtle hover:text-fg" aria-label="Dismiss">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

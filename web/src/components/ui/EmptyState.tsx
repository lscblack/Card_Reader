import type { ReactNode } from 'react'
import { AlertTriangle, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { errorMessage, ApiError } from '@/api/client'
import { Button } from './Button'
import { ErrorMeta } from './ErrorMeta'
import { metaOf } from './errorMetaUtil'

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      {Icon && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-surface-2 text-muted">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-[13px] text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const isPlan = error instanceof ApiError && error.isPlanLimit
  const isRate = error instanceof ApiError && error.isRateLimited
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-10 text-center', className)} role="alert">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <h3 className="text-sm font-semibold">{isRate ? 'Slow down' : isPlan ? 'Plan limit reached' : 'Could not load data'}</h3>
      <p className="mt-1 max-w-md text-[13px] text-muted">{errorMessage(error)}</p>
      <ErrorMeta meta={metaOf(error)} className="justify-center text-muted" />
      {onRetry && (
        <Button className="mt-4" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

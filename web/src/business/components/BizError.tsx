import { AlertTriangle, Lock } from 'lucide-react'
import { ApiError } from '@/api/client'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { cn } from '@/lib/cn'
import { errorRef, formatError, isForbidden, requestId, requiredPermission } from '../lib/errors'
import { PERMISSION_LABELS } from '../lib/permissions'
import type { Permission } from '../api/types'

/** Catalog ref + request id line (copyable), shown under error messages. */
export function ErrorMeta({ error, className }: { error: unknown; className?: string }) {
  const ref = errorRef(error)
  const rid = requestId(error)
  if (!ref && !rid) return null
  return (
    <p className={cn('flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-subtle', className)}>
      {ref && (
        <a href={`/docs/errors#${ref}`} className="font-mono font-medium text-muted underline-offset-2 hover:underline">
          {ref}
        </a>
      )}
      {rid && (
        <span className="inline-flex items-center gap-0.5">
          Request{' '}<code className="font-mono break-all">{rid}</code>
          <CopyButton value={rid} label="Copy request ID" />
        </span>
      )}
    </p>
  )
}

export function NoAccess({ permission, what, className }: { permission?: string | null; what?: string; className?: string }) {
  const label = permission && permission in PERMISSION_LABELS ? PERMISSION_LABELS[permission as Permission] : permission
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)} role="alert">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-surface-2 text-muted">
        <Lock className="h-5 w-5" />
      </div>
      <h3 className="text-sm font-semibold">You don’t have access{what ? ` to ${what}` : ''}</h3>
      <p className="mt-1 max-w-sm text-[13px] text-muted">
        Your role doesn’t include {label ? <span className="font-medium text-fg">{label}</span> : 'this permission'}. Ask an owner or admin of this
        business to grant it.
      </p>
    </div>
  )
}

/** Full error state for a failed query: permission-aware, with ref + request id. */
export function BizErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  if (isForbidden(error)) return <NoAccess permission={requiredPermission(error)} className={className} />
  const notFound = error instanceof ApiError && error.status === 404
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-10 text-center', className)} role="alert">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <h3 className="text-sm font-semibold">{notFound ? 'Not found' : 'Could not load data'}</h3>
      <p className="mt-1 max-w-md text-[13px] text-muted">{formatError(error)}</p>
      <ErrorMeta error={error} className="mt-2" />
      {onRetry && !notFound && (
        <Button className="mt-4" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

/** Inline form error (Alert) with ref + request id. */
export function FormError({ error, className }: { error: unknown; className?: string }) {
  if (error == null) return null
  return (
    <Alert tone="danger" className={className}>
      <span>{formatError(error)}</span>
      {(errorRef(error) || requestId(error)) && <ErrorMeta error={error} className="mt-1 !justify-start" />}
    </Alert>
  )
}

import { ExternalLink } from 'lucide-react'
import { ApiError, errorMessage } from '@/api/client'
import { cn } from '@/lib/cn'
import { Alert } from './Alert'
import { metaOf, type ErrorMetaInfo } from './errorMetaUtil'
import { CopyButton } from './CopyButton'

/** Error catalog ref + copyable request id + "What does this mean?" link (Part 2 §A1). */
export function ErrorMeta({ meta, className }: { meta: ErrorMetaInfo | null; className?: string }) {
  if (!meta || (!meta.ref && !meta.requestId)) return null
  return (
    <div className={cn('mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs opacity-90', className)}>
      {meta.ref && (
        <span className="inline-flex items-center gap-1">
          <span className="opacity-75">Ref</span>
          <code className="rounded bg-black/5 px-1 py-px font-mono font-medium dark:bg-white/10">{meta.ref}</code>
        </span>
      )}
      {meta.requestId && (
        <span className="inline-flex min-w-0 items-center gap-0.5">
          <span className="opacity-75">Request</span>
          <code className="max-w-[160px] truncate rounded bg-black/5 px-1 py-px font-mono dark:bg-white/10" title={meta.requestId}>
            {meta.requestId}
          </code>
          <CopyButton value={meta.requestId} label="Copy request ID" className="h-5 px-1 text-current" />
        </span>
      )}
      {meta.docsUrl && (
        <a href={meta.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline">
          What does this mean? <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  )
}

/** Danger/warning alert for an API error, including catalog ref and request id when present. */
export function ErrorAlert({ error, title, className }: { error: unknown; title?: string; className?: string }) {
  const tone = error instanceof ApiError && (error.isPlanLimit || error.isRateLimited) ? 'warning' : 'danger'
  return (
    <Alert tone={tone} title={title} className={className}>
      <span>{errorMessage(error)}</span>
      <ErrorMeta meta={metaOf(error)} />
    </Alert>
  )
}

/** Inline ref badge + docs link for delivery rows (error_code / error_ref). */
export function ErrorRef({ code, refId, className }: { code?: string | null; refId?: string | null; className?: string }) {
  if (!code && !refId) return null
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1 text-[11.5px]', className)}>
      {code && <code className="rounded bg-surface-2 px-1 py-px font-mono text-muted ring-1 ring-border">{code}</code>}
      {refId && (
        <a
          href={`/docs/errors#${encodeURIComponent(refId)}`}
          target="_blank"
          rel="noreferrer"
          className="rounded px-1 py-px font-mono font-medium text-accent ring-1 ring-accent/30 hover:bg-accent-soft"
          title="Open the error reference"
          onClick={(e) => e.stopPropagation()}
        >
          {refId}
        </a>
      )}
    </span>
  )
}

import { useState, type FormEvent } from 'react'
import { Globe2, Lock, Plus, Trash2 } from 'lucide-react'
import type { AllowedOrigin } from '@/api/types'
import { ApiError, errorMessage } from '@/api/client'
import { useAddAllowedOrigin, useAllowedOrigins, useDeleteAllowedOrigin } from '@/hooks/queries'
import { dateTime } from '@/lib/format'
import { parseOrigin } from '@/lib/url'
import { Card, CardBody, CardHeader } from './ui/Card'
import { Button } from './ui/Button'
import { Badge } from './ui/Badge'
import { Input } from './ui/Input'
import { Alert } from './ui/Alert'
import { ConfirmDialog } from './ui/Modal'
import { ErrorState } from './ui/EmptyState'
import { SkeletonRows } from './ui/Spinner'
import { Table, TableWrap, TBody, TD, TH, THead, TR } from './ui/Table'
import { useToast } from './ui/toastContext'

/** Admin: browser origins allowed by CORS (contract §7.2). Env origins are read-only. */
export function AllowedOriginsCard() {
  const { data, isLoading, error, refetch } = useAllowedOrigins()
  const add = useAddAllowedOrigin()
  const del = useDeleteAllowedOrigin()
  const toast = useToast()
  const [origin, setOrigin] = useState('')
  const [note, setNote] = useState('')
  const [touched, setTouched] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [target, setTarget] = useState<AllowedOrigin | null>(null)

  const parsed = parseOrigin(origin)
  const showErr = touched && origin.trim() ? parsed.error : null

  async function onAdd(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    setAddError(null)
    if (!parsed.value) return
    try {
      await add.mutateAsync({ origin: parsed.value, note: note.trim() || undefined })
      toast.success(`${parsed.value} allowed`)
      setOrigin('')
      setNote('')
      setTouched(false)
    } catch (err) {
      setAddError(
        err instanceof ApiError && err.code === 'origin_exists'
          ? `${parsed.value} is already allowed.`
          : err instanceof ApiError && err.code === 'validation_error'
            ? Object.values(err.fieldErrors)[0] ?? errorMessage(err)
            : errorMessage(err),
      )
    }
  }

  const rows = [
    ...(data?.env ?? []).map((o) => ({ kind: 'env' as const, origin: o })),
    ...(data?.items ?? []).map((o) => ({ kind: 'db' as const, origin: o.origin, item: o })),
  ]

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Globe2 className="h-4 w-4 text-accent" /> Allowed origins (CORS)
          </span>
        }
        description="Browser origins allowed to call the API: the server's CORS_ORIGINS plus the ones added here. Changes apply within ~30 seconds."
      />
      <CardBody className="border-b border-border">
        <form onSubmit={onAdd} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-start" noValidate>
          <div>
            <Input
              aria-label="Origin"
              aria-invalid={!!showErr}
              placeholder="https://dashboard.example.com"
              value={origin}
              onChange={(e) => {
                setOrigin(e.target.value)
                setAddError(null)
              }}
              onBlur={() => setTouched(true)}
              spellCheck={false}
              autoCapitalize="none"
              className="font-mono text-[13px]"
            />
            {showErr ? (
              <p className="mt-1 text-[12.5px] text-red-600 dark:text-red-400">{showErr}</p>
            ) : parsed.warning && origin.trim() ? (
              <p className="mt-1 text-[12.5px] text-amber-700 dark:text-amber-400">{parsed.warning}</p>
            ) : (
              <p className="mt-1 text-[12.5px] text-subtle">scheme://host[:port] — no path or trailing slash.</p>
            )}
          </div>
          <Input aria-label="Note" placeholder="Note (optional), e.g. staging dashboard" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
          <Button type="submit" variant="primary" leftIcon={<Plus className="h-4 w-4" />} loading={add.isPending} disabled={!parsed.value}>
            Add origin
          </Button>
        </form>
        {addError && (
          <Alert tone="danger" className="mt-3">
            {addError}
          </Alert>
        )}
      </CardBody>
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <SkeletonRows rows={3} cols={4} />
      ) : (
        <TableWrap>
          <Table className="min-w-[640px]">
            <THead>
              <tr>
                <TH>Origin</TH>
                <TH>Source</TH>
                <TH>Note</TH>
                <TH>Added</TH>
                <TH className="w-12">
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {rows.length === 0 && (
                <tr>
                  <TD colSpan={5} className="py-6 text-center text-muted">
                    No origins configured.
                  </TD>
                </tr>
              )}
              {rows.map((r) => (
                <TR key={`${r.kind}-${r.origin}`}>
                  <TD className="font-mono text-[12.5px]">{r.origin}</TD>
                  <TD>
                    {r.kind === 'env' ? (
                      <Badge title="Set via the CORS_ORIGINS environment variable — edit the server config to change it">
                        <Lock className="h-3 w-3" /> from server config
                      </Badge>
                    ) : (
                      <Badge tone="accent">database</Badge>
                    )}
                  </TD>
                  <TD className="max-w-[240px] truncate text-muted">{r.kind === 'db' ? r.item.note || '—' : '—'}</TD>
                  <TD className="whitespace-nowrap text-muted">
                    {r.kind === 'db' ? (
                      <>
                        {dateTime(r.item.created_at)}
                        {r.item.created_by_email && <p className="text-xs text-subtle">{r.item.created_by_email}</p>}
                      </>
                    ) : (
                      '—'
                    )}
                  </TD>
                  <TD className="text-right">
                    {r.kind === 'db' && (
                      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${r.origin}`} onClick={() => setTarget(r.item)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      )}
      <ConfirmDialog
        open={!!target}
        onClose={() => setTarget(null)}
        title="Remove allowed origin?"
        description={target ? `Browsers on ${target.origin} will be blocked by CORS within ~30 seconds.` : undefined}
        confirmLabel="Remove origin"
        loading={del.isPending}
        onConfirm={async () => {
          if (!target) return
          try {
            await del.mutateAsync(target.id)
            toast.success(`${target.origin} removed`)
            setTarget(null)
          } catch (err) {
            toast.fromError(err)
          }
        }}
      >
        {target && typeof window !== 'undefined' && target.origin === window.location.origin && (
          <Alert tone="warning">This is the origin you&apos;re using right now — removing it may lock this dashboard out unless it&apos;s also in CORS_ORIGINS.</Alert>
        )}
      </ConfirmDialog>
    </Card>
  )
}

import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, RotateCcw, XCircle } from 'lucide-react'
import type { Delivery, NfcEvent } from '@/api/types'
import { useEvent, useRedeliver } from '@/hooks/queries'
import { useNow } from '@/hooks/useNow'
import { dateTime, deliveryError, relativeTime } from '@/lib/format'
import { Table, TableWrap, TBody, TD, TH, THead, TR } from './ui/Table'
import { Badge, EventStatusBadge, UidOnlyBadge } from './ui/Badge'
import { Drawer } from './ui/Modal'
import { Button } from './ui/Button'
import { CopyButton } from './ui/CopyButton'
import { Skeleton } from './ui/Spinner'
import { ErrorState } from './ui/EmptyState'
import { Alert } from './ui/Alert'
import { useToast } from './ui/toastContext'
import { ErrorRef } from './ui/ErrorMeta'

export function CardId({ value }: { value: string }) {
  return (
    <code className="rounded bg-surface-2 px-1.5 py-0.5 text-[12px] font-medium tracking-wide" translate="no">
      {value}
    </code>
  )
}

export function EventsTable({
  events,
  onSelect,
  compact = false,
}: {
  events: NfcEvent[]
  onSelect?: (e: NfcEvent) => void
  compact?: boolean
}) {
  const now = useNow()
  return (
    <TableWrap>
      <Table className={compact ? 'min-w-[600px]' : 'min-w-[860px]'}>
        <THead>
          <tr>
            <TH>Card ID</TH>
            <TH>Status</TH>
            {!compact && <TH>Application</TH>}
            <TH>Device</TH>
            {!compact && <TH>Mode</TH>}
            {!compact && <TH className="text-right">Attempts</TH>}
            <TH>Detected</TH>
          </tr>
        </THead>
        <TBody>
          {events.map((e) => (
            <TR
              key={e.id}
              onClick={onSelect ? () => onSelect(e) : undefined}
              onKeyDown={
                onSelect
                  ? (ev) => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault()
                        onSelect(e)
                      }
                    }
                  : undefined
              }
              tabIndex={onSelect ? 0 : undefined}
              aria-label={onSelect ? `Event ${e.card_id}, ${e.status}` : undefined}
            >
              <TD>
                <div className="flex items-center gap-2">
                  <CardId value={e.card_id} />
                  <UidOnlyBadge authenticated={e.authenticated} />
                </div>
                {e.card_type && <p className="mt-1 text-[11.5px] text-subtle">{e.card_type}</p>}
              </TD>
              <TD>
                <EventStatusBadge status={e.status} />
                {e.last_status_code != null && e.status !== 'delivered' && (
                  <span className="ml-1.5 font-mono text-[11px] text-subtle">HTTP {e.last_status_code}</span>
                )}
                {e.status !== 'delivered' && e.error_ref && <ErrorRef refId={e.error_ref} className="ml-1.5" />}
              </TD>
              {!compact && <TD className="max-w-[180px] truncate text-muted">{e.application_name}</TD>}
              <TD className="max-w-[180px] truncate text-muted">{e.device_name}</TD>
              {!compact && (
                <TD>
                  <Badge tone={e.delivery_mode === 'relay' ? 'accent' : 'info'}>{e.delivery_mode}</Badge>
                </TD>
              )}
              {!compact && <TD className="text-right tabular-nums text-muted">{e.attempts}</TD>}
              <TD className="whitespace-nowrap text-muted" title={dateTime(e.detected_at, true)}>
                {relativeTime(e.detected_at, now)}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </TableWrap>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 py-2 text-[13px] sm:grid-cols-[140px_1fr]">
      <dt className="text-subtle">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

export function DeliveryAttempt({ d }: { d: Delivery }) {
  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        {d.success ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-red-500" />}
        <span className="text-[13px] font-medium">Attempt #{d.attempt}</span>
        <Badge tone={d.mode === 'relay' ? 'accent' : 'info'}>{d.mode}</Badge>
        {d.status_code != null && (
          <Badge tone={d.success ? 'success' : 'danger'} className="font-mono">
            {d.status_code}
          </Badge>
        )}
        {d.latency_ms != null && <span className="text-xs text-subtle">{d.latency_ms} ms</span>}
        <span className="ml-auto text-xs text-subtle" title={dateTime(d.created_at, true)}>
          {dateTime(d.created_at, true)}
        </span>
      </div>
      <p className="mt-1.5 truncate font-mono text-[11.5px] text-subtle" title={d.url}>
        {d.url}
      </p>
      {d.error && (
        <p className="mt-1.5 text-[12.5px] text-red-600 dark:text-red-400">
          {deliveryError(d.error)?.blocked && <Badge tone="warning" className="mr-1.5">domain_not_allowed</Badge>}
          {deliveryError(d.error)?.text}
        </p>
      )}
      <ErrorRef code={d.error_code} refId={d.error_ref} className="mt-1.5" />
      {d.response_excerpt && (
        <pre className="mt-2 max-h-28 overflow-auto rounded-md bg-surface-2 p-2 text-[11.5px] whitespace-pre-wrap text-muted">
          {d.response_excerpt}
        </pre>
      )}
    </li>
  )
}

export function EventDetailDrawer({ eventId, onClose }: { eventId: string | null; onClose: () => void }) {
  const { data, isLoading, error, refetch } = useEvent(eventId)
  const redeliver = useRedeliver()
  const toast = useToast()

  return (
    <Drawer
      open={!!eventId}
      onClose={onClose}
      title="Event details"
      footer={
        data && data.delivery_mode === 'relay' ? (
          <Button
            variant="primary"
            leftIcon={<RotateCcw className="h-4 w-4" />}
            loading={redeliver.isPending}
            onClick={async () => {
              try {
                const d = await redeliver.mutateAsync(data.id)
                if (d.success) toast.success(`Delivered (HTTP ${d.status_code ?? '—'}, ${d.latency_ms ?? '—'} ms)`, 'Redelivered')
                else toast.error(d.error ?? `Endpoint responded ${d.status_code ?? 'with an error'}`, 'Redelivery failed')
              } catch (e) {
                toast.fromError(e)
              }
            }}
          >
            Redeliver now
          </Button>
        ) : undefined
      }
    >
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-5" />
          ))}
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : data ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <code className="text-lg font-semibold tracking-wide" translate="no">
              {data.card_id}
            </code>
            <CopyButton value={data.card_id} label="Copy card ID" />
            <EventStatusBadge status={data.status} />
            <UidOnlyBadge authenticated={data.authenticated} />
          </div>

          {!data.authenticated && (
            <Alert tone="warning" title="Card detected — UID only">
              This card was read but <strong>not cryptographically authenticated</strong>. UIDs can be cloned or emulated, so treat
              the card ID as an identifier, never as proof of identity.
            </Alert>
          )}

          <dl className="divide-y divide-border rounded-lg border border-border px-3">
            <Row label="Event ID">
              <span className="inline-flex items-center gap-1 font-mono text-[12px]">
                {data.id} <CopyButton value={data.id} label="Copy event ID" />
              </span>
            </Row>
            <Row label="Event type">{data.event_type}</Row>
            <Row label="Card type">{data.card_type ?? <span className="text-subtle">Unknown</span>}</Row>
            <Row label="Technologies">
              <div className="flex flex-wrap gap-1">
                {data.card_technologies.length ? data.card_technologies.map((t) => <Badge key={t}>{t}</Badge>) : '—'}
              </div>
            </Row>
            <Row label="Application">{data.application_name}</Row>
            <Row label="Device">{data.device_name}</Row>
            <Row label="Delivery mode">
              <Badge tone={data.delivery_mode === 'relay' ? 'accent' : 'info'}>{data.delivery_mode}</Badge>
            </Row>
            <Row label="Detected">{dateTime(data.detected_at, true)}</Row>
            <Row label="Received">{dateTime(data.received_at, true)}</Row>
            <Row label="Delivered">{dateTime(data.delivered_at, true)}</Row>
            {data.last_error && (
              <Row label="Last error">
                <span className="text-red-600 dark:text-red-400">{deliveryError(data.last_error)?.text}</span>
                <ErrorRef code={data.error_code} refId={data.error_ref} className="mt-1 flex" />
              </Row>
            )}
          </dl>

          <section>
            <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
              Delivery attempts <span className="text-subtle">({data.deliveries.length})</span>
            </h3>
            {data.deliveries.length === 0 ? (
              <p className="flex items-center gap-2 rounded-lg border border-dashed border-border p-4 text-[13px] text-muted">
                <AlertTriangle className="h-4 w-4 text-subtle" /> No delivery attempts yet.
              </p>
            ) : (
              <ol className="space-y-2">
                {[...data.deliveries]
                  .sort((a, b) => b.attempt - a.attempt || b.created_at.localeCompare(a.created_at))
                  .map((d) => (
                    <DeliveryAttempt key={d.id} d={d} />
                  ))}
              </ol>
            )}
            {data.delivery_mode === 'direct' && (
              <p className="mt-3 text-xs text-subtle">Direct-mode events are delivered by the phone; redelivery from the server isn&apos;t available.</p>
            )}
          </section>
        </div>
      ) : null}
    </Drawer>
  )
}

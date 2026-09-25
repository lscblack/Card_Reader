import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { FilterX, Pause, Play, ScrollText, Search, SlidersHorizontal } from 'lucide-react'
import type { Paginated, RequestLog, RequestOutcome } from '@/api/types'
import type { useLogFilterParams } from '@/hooks/useLogFilterParams'
import { useNow } from '@/hooks/useNow'
import { useDebounced } from '@/hooks/useDebounce'
import { dateTime, relativeTime } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Badge, type Tone } from './ui/Badge'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { CopyButton } from './ui/CopyButton'
import { Drawer } from './ui/Modal'
import { EmptyState, ErrorState } from './ui/EmptyState'
import { ErrorRef } from './ui/ErrorMeta'
import { Input, Select } from './ui/Input'
import { Pagination } from './ui/Pagination'
import { SkeletonRows, Spinner } from './ui/Spinner'
import { Table, TableWrap, TBody, TD, TH, THead, TR } from './ui/Table'

const outcomeTone: Record<RequestOutcome, Tone> = { success: 'success', client_error: 'warning', server_error: 'danger' }
const outcomeLabel: Record<RequestOutcome, string> = { success: 'Success', client_error: 'Client error', server_error: 'Server error' }

export function StatusCode({ code }: { code: number }) {
  const tone: Tone = code >= 500 ? 'danger' : code >= 400 ? 'warning' : code >= 300 ? 'info' : 'success'
  return (
    <Badge tone={tone} className="font-mono">
      {code}
    </Badge>
  )
}

function methodClass(m: string) {
  return m === 'GET' ? 'text-sky-700 dark:text-sky-300' : m === 'DELETE' ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-300'
}

export function Latency({ ms }: { ms: number | null | undefined }) {
  if (ms == null) return <span className="text-subtle">—</span>
  return <span className={cn('tabular-nums', ms >= 1000 ? 'font-medium text-red-600 dark:text-red-400' : ms >= 300 ? 'text-amber-700 dark:text-amber-400' : 'text-muted')}>{ms} ms</span>
}

export function RequestLogTable({ logs, onSelect, showActor }: { logs: RequestLog[]; onSelect: (l: RequestLog) => void; showActor?: boolean }) {
  const now = useNow()
  return (
    <TableWrap>
      <Table className="min-w-[860px]">
        <THead>
          <tr>
            <TH>Status</TH>
            <TH>Request</TH>
            <TH>Error</TH>
            {showActor && <TH>Actor</TH>}
            <TH className="text-right">Latency</TH>
            <TH>When</TH>
          </tr>
        </THead>
        <TBody>
          {logs.map((l) => (
            <TR
              key={l.id}
              onClick={() => onSelect(l)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(l)
                }
              }}
              aria-label={`${l.method} ${l.path} ${l.status_code}`}
            >
              <TD>
                <StatusCode code={l.status_code} />
              </TD>
              <TD className="max-w-[380px]">
                <p className="truncate font-mono text-[12.5px]" title={l.path}>
                  <span className={cn('mr-1.5 font-semibold', methodClass(l.method))}>{l.method}</span>
                  {l.path}
                </p>
                {l.route !== l.path && <p className="truncate font-mono text-[11px] text-subtle">{l.route}</p>}
              </TD>
              <TD>{l.error_code ? <ErrorRef code={l.error_code} refId={l.error_ref} /> : <span className="text-subtle">—</span>}</TD>
              {showActor && (
                <TD className="text-muted">
                  <Badge>{l.actor_type}</Badge>
                </TD>
              )}
              <TD className="text-right">
                <Latency ms={l.latency_ms} />
              </TD>
              <TD className="whitespace-nowrap text-muted" title={dateTime(l.created_at, true)}>
                {relativeTime(l.created_at, now)}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </TableWrap>
  )
}

function Row({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 py-2 text-[13px] sm:grid-cols-[140px_1fr]">
      <dt className="text-subtle">{label}</dt>
      <dd className={cn('min-w-0 break-words', mono && 'font-mono text-[12px]')}>{children ?? <span className="text-subtle">—</span>}</dd>
    </div>
  )
}

export function RequestLogDrawer({ log, onClose, extra }: { log: RequestLog | null; onClose: () => void; extra?: (l: RequestLog) => ReactNode }) {
  return (
    <Drawer open={!!log} onClose={onClose} title="Request details">
      {log && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusCode code={log.status_code} />
            <Badge tone={outcomeTone[log.outcome]} dot>
              {outcomeLabel[log.outcome]}
            </Badge>
            <span className="font-mono text-[13px] font-semibold">{log.method}</span>
            <span className="min-w-0 truncate font-mono text-[13px]">{log.path}</span>
          </div>
          {log.error_code && (
            <div className="rounded-lg border border-border p-3">
              <p className="mb-1.5 text-xs font-medium text-subtle">Error</p>
              <ErrorRef code={log.error_code} refId={log.error_ref} />
            </div>
          )}
          <dl className="divide-y divide-border rounded-lg border border-border px-3">
            <Row label="Request ID" mono>
              <span className="inline-flex items-center gap-1">
                {log.request_id} <CopyButton value={log.request_id} label="Copy request ID" />
              </span>
            </Row>
            <Row label="Route" mono>
              {log.route}
            </Row>
            <Row label="Latency">
              <Latency ms={log.latency_ms} />
            </Row>
            <Row label="Time">{dateTime(log.created_at, true)}</Row>
            <Row label="Actor">
              {log.actor_type}
              {log.actor_id && <span className="ml-1.5 font-mono text-[11.5px] text-subtle">{log.actor_id}</span>}
            </Row>
            <Row label="Application" mono>
              {log.application_id}
            </Row>
            <Row label="Device" mono>
              {log.device_id}
            </Row>
            {log.business_id && (
              <Row label="Business" mono>
                {log.business_id}
              </Row>
            )}
            <Row label="Client IP (hash)" mono>
              {log.ip_hash ? `${log.ip_hash.slice(0, 16)}…` : null}
            </Row>
            <Row label="Country">{log.country}</Row>
            <Row label="User agent">{log.user_agent}</Row>
          </dl>
          {extra?.(log)}
          <p className="text-xs text-subtle">Request logs never contain bodies, secrets or raw IP addresses.</p>
        </div>
      )}
    </Drawer>
  )
}

/** Text input that writes to the URL after a short pause. */
function DebouncedInput({ value, onCommit, ...rest }: { value: string; onCommit: (v: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [local, setLocal] = useState(value)
  const [prev, setPrev] = useState(value)
  if (value !== prev) {
    // External change (e.g. "Clear filters") resets the field.
    setPrev(value)
    setLocal(value)
  }
  const debounced = useDebounced(local, 400)
  const commitRef = useRef(onCommit)
  useEffect(() => {
    commitRef.current = onCommit
  })
  const valueRef = useRef(value)
  useEffect(() => {
    valueRef.current = value
  })
  useEffect(() => {
    if (debounced !== valueRef.current) commitRef.current(debounced)
  }, [debounced])
  return <Input value={local} onChange={(e) => setLocal(e.target.value)} {...rest} />
}

export function LogFilters({ f, admin }: { f: ReturnType<typeof useLogFilterParams>; admin?: boolean }) {
  const v = f.values
  const [open, setOpen] = useState(false)
  const count = Object.values(v).filter(Boolean).length
  return (
    <>
    <div className="border-b border-border px-4 py-2.5 sm:hidden">
      <Button size="sm" variant="secondary" leftIcon={<SlidersHorizontal className="h-3.5 w-3.5" />} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Filters{count ? ` (${count})` : ''}
      </Button>
    </div>
    <div className={cn('gap-2 border-b border-border px-4 py-3 sm:grid sm:grid-cols-2 sm:px-5 lg:grid-cols-4', open ? 'grid' : 'hidden')}>
      <div className="relative sm:col-span-2 lg:col-span-1">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-subtle" />
        <DebouncedInput aria-label="Request ID" placeholder="Request ID" value={v.request_id} onCommit={(x) => f.set({ request_id: x.trim() })} className="pl-8 font-mono text-[12.5px]" />
      </div>
      <Select aria-label="Outcome" value={v.outcome} onChange={(e) => f.set({ outcome: e.target.value })}>
        <option value="">All outcomes</option>
        <option value="success">Success (2xx/3xx)</option>
        <option value="client_error">Client errors (4xx)</option>
        <option value="server_error">Server errors (5xx)</option>
      </Select>
      <DebouncedInput aria-label="Status code" placeholder="Status, e.g. 422" inputMode="numeric" value={v.status} onCommit={(x) => f.set({ status: x.replace(/\D/g, '').slice(0, 3) })} />
      <DebouncedInput aria-label="Error code" placeholder="Error code, e.g. invalid_api_key" value={v.error_code} onCommit={(x) => f.set({ error_code: x.trim() })} className="font-mono text-[12.5px]" />
      <DebouncedInput aria-label="Route" placeholder="Route, e.g. /api/v1/device/events" value={v.route} onCommit={(x) => f.set({ route: x.trim() })} className="font-mono text-[12.5px] sm:col-span-2 lg:col-span-2" />
      <Input type="date" aria-label="From date" value={v.from} max={v.to || undefined} onChange={(e) => f.set({ from: e.target.value })} />
      <Input type="date" aria-label="To date" value={v.to} min={v.from || undefined} onChange={(e) => f.set({ to: e.target.value })} />
      {admin && (
        <>
          <Select aria-label="Actor type" value={v.actor_type} onChange={(e) => f.set({ actor_type: e.target.value })}>
            <option value="">All actors</option>
            {['user', 'api_key', 'device', 'pairing_code', 'public', 'anonymous'].map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
          <DebouncedInput aria-label="Min latency" placeholder="Min latency (ms)" inputMode="numeric" value={v.min_latency_ms} onCommit={(x) => f.set({ min_latency_ms: x.replace(/\D/g, '') })} />
          <DebouncedInput aria-label="User ID" placeholder="User ID" value={v.user_id} onCommit={(x) => f.set({ user_id: x.trim() })} className="font-mono text-[12.5px]" />
          <DebouncedInput aria-label="Business ID" placeholder="Business ID" value={v.business_id} onCommit={(x) => f.set({ business_id: x.trim() })} className="font-mono text-[12.5px]" />
        </>
      )}
    </div>
    </>
  )
}

/** Full request-log explorer card (filters, live toggle, table, pagination, drawer). */
export function RequestLogExplorer({
  query,
  f,
  admin,
  live,
  onLiveChange,
  detailExtra,
}: {
  query: { data?: Paginated<RequestLog>; isLoading: boolean; isFetching: boolean; error: unknown; refetch: () => unknown }
  f: ReturnType<typeof useLogFilterParams>
  admin?: boolean
  live: boolean
  onLiveChange: (v: boolean) => void
  detailExtra?: (l: RequestLog) => ReactNode
}) {
  const [selected, setSelected] = useState<RequestLog | null>(null)
  const { data, isLoading, isFetching, error, refetch } = query
  return (
    <>
      <Card>
        <LogFilters f={f} admin={admin} />
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2 text-xs text-subtle sm:px-5">
          {f.active && (
            <button className="inline-flex items-center gap-1 font-medium text-muted hover:text-fg" onClick={f.clear}>
              <FilterX className="h-3.5 w-3.5" /> Clear filters
            </button>
          )}
          <span className={cn('inline-flex items-center gap-1.5', !isFetching && 'invisible')}>
            <Spinner className="h-3 w-3" /> Updating…
          </span>
          <Button
            size="sm"
            variant={live ? 'primary' : 'ghost'}
            className="ml-auto"
            leftIcon={live ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            onClick={() => onLiveChange(!live)}
            aria-pressed={live}
          >
            {live ? 'Live' : 'Auto-refresh'}
          </Button>
        </div>
        {error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <SkeletonRows rows={8} cols={5} />
        ) : !data?.items.length ? (
          <EmptyState
            icon={ScrollText}
            title={f.active ? 'No requests match these filters' : 'No requests logged yet'}
            description={f.active ? 'Try widening the date range or clearing filters.' : 'Every API, device and webhook call made with your credentials shows up here.'}
          />
        ) : (
          <>
            <RequestLogTable logs={data.items} onSelect={setSelected} showActor={admin} />
            <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={(p) => f.set({ page: p > 1 ? String(p) : '' }, false)} />
          </>
        )}
      </Card>
      <RequestLogDrawer log={selected} onClose={() => setSelected(null)} extra={detailExtra} />
    </>
  )
}

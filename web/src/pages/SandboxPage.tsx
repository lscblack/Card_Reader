import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import {
  CheckCircle2,
  CircleSlash,
  Clock,
  Eraser,
  FlaskConical,
  Link2,
  Pause,
  Play,
  Plus,
  Send,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Trash2,
  XCircle,
} from 'lucide-react'
import type { SandboxEndpoint, SandboxRequest, SignatureStatus } from '@/api/types'
import { ApiError } from '@/api/client'
import { useApplications } from '@/hooks/queries'
import { useSandboxEndpoints, useSandboxMutations, useSandboxRequest, useSandboxRequests } from '@/hooks/useConsole'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useNow } from '@/hooks/useNow'
import { dateTime, num, relativeTime } from '@/lib/format'
import { cn } from '@/lib/cn'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge, UidOnlyBadge, type Tone } from '@/components/ui/Badge'
import { CopyButton } from '@/components/ui/CopyButton'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { ErrorAlert, ErrorRef } from '@/components/ui/ErrorMeta'
import { Field, Input, Select, Textarea } from '@/components/ui/Input'
import { ConfirmDialog, Drawer, Modal } from '@/components/ui/Modal'
import { Skeleton, Spinner } from '@/components/ui/Spinner'
import { Tabs } from '@/components/ui/Tabs'
import { Alert } from '@/components/ui/Alert'
import { useToast } from '@/components/ui/toastContext'
import { AppSelect } from '@/components/AppSelect'
import { StatusCode } from '@/components/RequestLogs'
import { RunConsole } from '@/components/RunConsole'
import { useTour, developerSandboxTour } from '@/tours'

const COMMON_CODES: { code: number; label: string }[] = [
  { code: 200, label: 'OK' },
  { code: 201, label: 'Created' },
  { code: 204, label: 'No Content' },
  { code: 400, label: 'Bad Request' },
  { code: 401, label: 'Unauthorized' },
  { code: 404, label: 'Not Found' },
  { code: 409, label: 'Conflict' },
  { code: 429, label: 'Too Many' },
  { code: 500, label: 'Server Error' },
  { code: 502, label: 'Bad Gateway' },
  { code: 503, label: 'Unavailable' },
]

const sigMeta: Record<SignatureStatus, { tone: Tone; label: string; icon: typeof ShieldCheck }> = {
  valid: { tone: 'success', label: 'Signature valid', icon: ShieldCheck },
  invalid: { tone: 'danger', label: 'Signature invalid', icon: ShieldAlert },
  missing: { tone: 'warning', label: 'Not signed', icon: CircleSlash },
  unverifiable: { tone: 'neutral', label: 'Unverifiable', icon: ShieldQuestion },
}

function SignatureBadge({ status }: { status: SignatureStatus }) {
  const m = sigMeta[status] ?? sigMeta.unverifiable
  return (
    <Badge tone={m.tone} className="gap-1">
      <m.icon className="h-3 w-3" /> {m.label}
    </Badge>
  )
}

function prettyBody(r: SandboxRequest): { text: string; json: boolean } {
  if (r.body_json != null) {
    try {
      return { text: JSON.stringify(r.body_json, null, 2), json: true }
    } catch {
      /* fall through */
    }
  }
  return { text: r.body || '', json: false }
}

function queryString(q: SandboxRequest['query']): string {
  if (!q) return ''
  if (typeof q === 'string') return q ? (q.startsWith('?') ? q : `?${q}`) : ''
  const s = new URLSearchParams(q).toString()
  return s ? `?${s}` : ''
}

// ---------------------------------------------------------------------------------------------

function ResponseSimulator({ ep, timeoutSeconds }: { ep: SandboxEndpoint; timeoutSeconds: number | null }) {
  const { update } = useSandboxMutations()
  const toast = useToast()
  const [status, setStatus] = useState(String(ep.response_status))
  const [delay, setDelay] = useState(ep.response_delay_ms)
  const [body, setBody] = useState(ep.response_body)
  const [headers, setHeaders] = useState(() =>
    Object.entries(ep.response_headers ?? {})
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n'),
  )
  const statusNum = Number(status)
  const statusErr = !Number.isInteger(statusNum) || statusNum < 100 || statusNum > 599 ? 'Use a status between 100 and 599.' : null
  const bodyBytes = new TextEncoder().encode(body).length
  const bodyErr = bodyBytes > 4096 ? `Body is ${num(bodyBytes)} bytes — the maximum is 4 KB.` : null
  const looksJson = /^\s*[[{]/.test(body)
  let jsonErr: string | null = null
  if (looksJson) {
    try {
      JSON.parse(body)
    } catch (e) {
      jsonErr = e instanceof Error ? e.message : 'Invalid JSON'
    }
  }
  const parsedHeaders: Record<string, string> = {}
  let headerErr: string | null = null
  for (const line of headers.split('\n')) {
    if (!line.trim()) continue
    const idx = line.indexOf(':')
    if (idx < 1) {
      headerErr = `“${line.trim()}” — use “Name: value”.`
      break
    }
    parsedHeaders[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  const dirty =
    statusNum !== ep.response_status ||
    delay !== ep.response_delay_ms ||
    body !== ep.response_body ||
    JSON.stringify(parsedHeaders) !== JSON.stringify(ep.response_headers ?? {})
  const timeoutMs = timeoutSeconds ? timeoutSeconds * 1000 : null
  const willTimeout = timeoutMs != null && delay > timeoutMs

  async function save() {
    try {
      await update.mutateAsync({
        id: ep.id,
        body: { response_status: statusNum, response_delay_ms: delay, response_body: body, response_headers: parsedHeaders },
      })
      toast.success('Response behaviour saved — it applies to the next request.')
    } catch (e) {
      toast.fromError(e, 'Could not save')
    }
  }

  return (
    <Card>
      <CardHeader title="Response simulator" description="Decide how this endpoint answers — test your retries, timeouts and error handling." />
      <CardBody className="space-y-5">
        <div>
          <p className="mb-2 text-[13px] font-medium">Status code</p>
          <div className="flex flex-wrap gap-1.5">
            {COMMON_CODES.map((c) => (
              <button
                key={c.code}
                type="button"
                onClick={() => setStatus(String(c.code))}
                aria-pressed={statusNum === c.code}
                className={cn(
                  'rounded-lg border px-2 py-1 text-xs transition-colors',
                  statusNum === c.code ? 'border-accent bg-accent-soft text-fg' : 'border-border text-muted hover:border-border-strong hover:text-fg',
                )}
              >
                <span className="font-mono font-semibold">{c.code}</span> <span className="hidden sm:inline">{c.label}</span>
              </button>
            ))}
            <Input
              aria-label="Custom status code"
              inputMode="numeric"
              value={status}
              onChange={(e) => setStatus(e.target.value.replace(/\D/g, '').slice(0, 3))}
              className="h-7 w-20 font-mono text-xs"
              aria-invalid={!!statusErr}
            />
          </div>
          {statusErr ? (
            <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{statusErr}</p>
          ) : (
            <p className="mt-1.5 text-xs text-subtle">
              {statusNum >= 200 && statusNum < 300 ? 'Counts as delivered.' : 'Counts as a failed delivery — relay mode retries it (10s, 60s, 300s…).'}
            </p>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <label htmlFor="sb-delay" className="text-[13px] font-medium">
              Response delay
            </label>
            <span className="font-mono text-xs text-muted tabular-nums">{(delay / 1000).toFixed(1)} s</span>
          </div>
          <input
            id="sb-delay"
            type="range"
            min={0}
            max={15000}
            step={250}
            value={delay}
            onChange={(e) => setDelay(Number(e.target.value))}
            className="w-full accent-[var(--accent-solid)]"
          />
          <p className={cn('mt-1.5 text-xs', willTimeout ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-subtle')}>
            {willTimeout
              ? `Longer than the linked application's ${timeoutSeconds}s endpoint timeout — deliveries will fail with delivery_timeout.`
              : timeoutSeconds
                ? `Delays above the application's endpoint timeout (${timeoutSeconds}s) simulate a timeout.`
                : 'Delays above an application’s endpoint timeout (1–30 s) simulate a timeout.'}
          </p>
        </div>

        <Field label="Response body" hint={bodyErr ? undefined : jsonErr ? undefined : `${num(bodyBytes)} / 4096 bytes`} error={bodyErr ?? (jsonErr ? `Not valid JSON: ${jsonErr}` : null)}>
          {(p) => <Textarea {...p} rows={5} value={body} onChange={(e) => setBody(e.target.value)} spellCheck={false} className="font-mono text-[12.5px]" />}
        </Field>
        <Field label="Response headers" optional hint="One per line: Name: value" error={headerErr}>
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              value={headers}
              onChange={(e) => setHeaders(e.target.value)}
              spellCheck={false}
              placeholder="Content-Type: application/json"
              className="font-mono text-[12.5px]"
            />
          )}
        </Field>
      </CardBody>
      <CardFooter>
        {dirty && (
          <Button
            onClick={() => {
              setStatus(String(ep.response_status))
              setDelay(ep.response_delay_ms)
              setBody(ep.response_body)
              setHeaders(
                Object.entries(ep.response_headers ?? {})
                  .map(([k, v]) => `${k}: ${v}`)
                  .join('\n'),
              )
            }}
          >
            Reset
          </Button>
        )}
        <Button variant="primary" onClick={save} loading={update.isPending} disabled={!dirty || !!statusErr || !!bodyErr || !!headerErr}>
          Save response
        </Button>
      </CardFooter>
    </Card>
  )
}

// ---------------------------------------------------------------------------------------------

function Inspector({ id }: { id: string }) {
  const { data: r, isLoading, error, refetch } = useSandboxRequest(id)
  const [tab, setTab] = useState<'overview' | 'headers' | 'body'>('overview')
  if (isLoading) return <div className="space-y-3 p-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-5" />)}</div>
  if (error || !r) return <ErrorState error={error} onRetry={() => refetch()} />
  const body = prettyBody(r)
  const passed = r.checks.filter((c) => c.passed).length
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <span className="font-mono text-[13px] font-semibold">{r.method}</span>
        <span className="min-w-0 truncate font-mono text-[12.5px] text-muted">
          {r.path}
          {queryString(r.query)}
        </span>
        <span className="ml-auto text-xs text-subtle">{dateTime(r.received_at, true)}</span>
      </div>
      <div className="px-4">
        <Tabs
          className="mt-1"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'overview', label: 'Verdict' },
            { value: 'headers', label: 'Headers', count: Object.keys(r.headers ?? {}).length },
            { value: 'body', label: 'Body' },
          ]}
        />
      </div>
      <div className="space-y-4 p-4">
        {tab === 'overview' && (
          <>
            <div
              className={cn(
                'rounded-xl border p-4',
                r.signature.status === 'valid'
                  ? 'border-emerald-300/70 bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-500/5'
                  : r.signature.status === 'invalid'
                    ? 'border-red-300/70 bg-red-50/60 dark:border-red-500/30 dark:bg-red-500/5'
                    : 'border-border bg-surface-2/60',
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <SignatureBadge status={r.signature.status} />
                {r.signature.mode && <Badge tone={r.signature.mode === 'relay' ? 'accent' : 'info'}>{r.signature.mode}</Badge>}
                {r.signature.error_ref && <ErrorRef refId={r.signature.error_ref} />}
              </div>
              <p className="mt-2 text-[13px] text-muted">
                {r.signature.reason ??
                  (r.signature.status === 'valid'
                    ? 'X-NFC-Signature matches the HMAC computed with the linked application’s secret.'
                    : r.signature.status === 'unverifiable'
                      ? 'Link this sandbox endpoint to an application so its signing secret can be used to verify requests.'
                      : r.signature.status === 'missing'
                        ? 'The request carried no X-NFC-Signature header — it did not come from the platform or a phone.'
                        : 'The signature does not match.')}
              </p>
            </div>
            {r.checks.length > 0 && (
              <div>
                <p className="mb-2 text-[13px] font-semibold">
                  Checks <span className="font-normal text-subtle">({passed}/{r.checks.length} passed)</span>
                </p>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {r.checks.map((c) => (
                    <li key={c.name} className="flex gap-2.5 px-3 py-2 text-[13px]">
                      {c.passed ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />}
                      <div className="min-w-0">
                        <p className="font-medium">{c.name}</p>
                        {c.detail && <p className="text-xs break-words text-muted">{c.detail}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <dl className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-3">
              <div>
                <dt className="text-xs text-subtle">Responded</dt>
                <dd className="mt-0.5">
                  <StatusCode code={r.response_status} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-subtle">Delay</dt>
                <dd className="mt-0.5 tabular-nums">{r.response_delay_ms} ms</dd>
              </div>
              <div>
                <dt className="text-xs text-subtle">Size</dt>
                <dd className="mt-0.5 tabular-nums">{num(r.size_bytes)} B</dd>
              </div>
              <div className="col-span-2 sm:col-span-3">
                <dt className="text-xs text-subtle">Event ID</dt>
                <dd className="mt-0.5 flex items-center gap-1 font-mono text-[12px]">
                  {r.event_id ?? '—'} {r.event_id && <CopyButton value={r.event_id} label="Copy event ID" />}
                </dd>
              </div>
              {r.device_id && (
                <div className="col-span-2 sm:col-span-3">
                  <dt className="text-xs text-subtle">Device ID</dt>
                  <dd className="mt-0.5 font-mono text-[12px]">{r.device_id}</dd>
                </div>
              )}
            </dl>
          </>
        )}
        {tab === 'headers' && (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-[12.5px]">
              <tbody className="divide-y divide-border">
                {Object.entries(r.headers ?? {}).map(([k, v]) => (
                  <tr key={k} className={cn(k.toLowerCase().startsWith('x-nfc-') && 'bg-accent-soft/40')}>
                    <td className="w-[40%] px-3 py-1.5 align-top font-mono font-medium break-all">{k}</td>
                    <td className="px-3 py-1.5 font-mono break-all text-muted">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === 'body' && (
          <div className="overflow-hidden rounded-xl border border-zinc-800 bg-code-bg text-code-fg">
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
              <span className="text-xs text-zinc-400">{body.json ? 'JSON' : 'Raw body'}</span>
              <CopyButton value={r.body} className="text-zinc-400 hover:bg-white/10 hover:text-white" showLabel label="Copy raw" />
            </div>
            <pre className="max-h-[420px] overflow-auto p-3 text-[12px] leading-relaxed">{body.text || <span className="text-zinc-500">(empty body)</span>}</pre>
            {body.json && (r.body_json as { security?: { level?: string } } | null)?.security?.level === 'uid_only' && (
              <div className="border-t border-white/10 px-3 py-2 text-xs text-zinc-400">
                <UidOnlyBadge /> <span className="ml-1">The card UID is an identifier, not proof of identity.</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function RequestStream({ ep }: { ep: SandboxEndpoint }) {
  const [live, setLive] = useState(true)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const { data, isLoading, error, refetch, isFetching } = useSandboxRequests(ep.id, page, live && page === 1)
  const now = useNow(5000)
  const items = useMemo(() => data?.items ?? [], [data])
  const current = selected ?? items[0]?.id ?? null
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            Incoming requests
            {live && page === 1 && (
              <span className="relative flex h-2 w-2" aria-label="Live">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
            )}
          </span>
        }
        description={`${num(data?.total ?? ep.request_count)} stored · the last 500 are kept`}
        actions={
          <>
            {isFetching && <Spinner className="h-3.5 w-3.5 text-subtle" />}
            <Button size="sm" variant={live ? 'secondary' : 'primary'} leftIcon={live ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} onClick={() => setLive((v) => !v)}>
              {live ? 'Pause' : 'Resume'}
            </Button>
          </>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="space-y-2 p-4">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : !items.length ? (
        <EmptyState
          icon={Clock}
          title="Waiting for the first request…"
          description="Send a test event, point an application at this URL, or curl it. Requests appear here within 2 seconds."
          action={<CopyButton value={ep.url} label="Copy URL" showLabel className="border border-border" />}
        />
      ) : (
        <div className="lg:grid lg:grid-cols-[minmax(260px,340px)_1fr] lg:divide-x lg:divide-border">
          <div>
            <ul className="max-h-[560px] divide-y divide-border overflow-y-auto" role="listbox" aria-label="Requests">
              {items.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={current === r.id}
                    onClick={() => {
                      setSelected(r.id)
                      // Below lg the inspector opens in a drawer; on desktop it's shown side by side.
                      if (window.matchMedia('(max-width: 1023px)').matches) setMobileOpen(true)
                    }}
                    className={cn('flex w-full flex-col gap-1 px-4 py-2.5 text-left transition-colors hover:bg-surface-2/70', current === r.id && 'lg:bg-accent-soft/50')}
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-[12px] font-semibold">{r.method}</span>
                      <StatusCode code={r.response_status} />
                      <span className="ml-auto text-[11.5px] text-subtle" title={dateTime(r.received_at, true)}>
                        {relativeTime(r.received_at, now)}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <SignatureBadge status={r.signature.status} />
                      {r.checks.some((c) => !c.passed) && (
                        <Badge tone="danger">
                          {r.checks.filter((c) => !c.passed).length} failed check{r.checks.filter((c) => !c.passed).length === 1 ? '' : 's'}
                        </Badge>
                      )}
                    </span>
                    {r.event_id && <span className="truncate font-mono text-[11px] text-subtle">event {r.event_id}</span>}
                  </button>
                </li>
              ))}
            </ul>
            {pages > 1 && (
              <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted">
                <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Newer
                </Button>
                Page {page} / {pages}
                <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                  Older
                </Button>
              </div>
            )}
          </div>
          <div className="hidden min-w-0 lg:block">{current && <Inspector key={current} id={current} />}</div>
        </div>
      )}
      <Drawer open={mobileOpen && !!selected} onClose={() => setMobileOpen(false)} title="Request">
        <div className="-mx-5 -my-4">{selected && <Inspector key={selected} id={selected} />}</div>
      </Drawer>
    </Card>
  )
}

// ---------------------------------------------------------------------------------------------

function EndpointHeader({ ep }: { ep: SandboxEndpoint }) {
  const toast = useToast()
  const apps = useApplications()
  const m = useSandboxMutations()
  const [useForOpen, setUseForOpen] = useState(false)
  const [appId, setAppId] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const linked = apps.data?.find((a) => a.id === ep.application_id)

  async function sendTest() {
    try {
      const r = await m.sendTest.mutateAsync(ep.id)
      if (!r || r.success) {
        toast.success(
          r ? `Delivered — HTTP ${r.status_code ?? '—'} in ${r.latency_ms ?? '—'} ms. It's at the top of the stream.` : 'Test event sent.',
          'Test event sent',
        )
      } else {
        toast.error(r.error ?? `Endpoint answered HTTP ${r.status_code ?? '—'}`, 'Test delivery failed', {
          ref: r.error_ref,
          docsUrl: r.error_ref ? `/docs/errors#${encodeURIComponent(r.error_ref)}` : null,
        })
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'sandbox_no_application') {
        toast.error('Choose an application under “Verify signatures with” first — the test is signed with its secret.', 'No application linked', {
          ref: e.ref,
          requestId: e.requestId,
          docsUrl: e.docsUrl,
        })
      } else toast.fromError(e, 'Test failed')
    }
  }

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold">{ep.name}</p>
            <p className="text-xs text-subtle">
              {num(ep.request_count)} requests · last {ep.last_request_at ? relativeTime(ep.last_request_at) : 'never'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              leftIcon={<Send className="h-3.5 w-3.5" />}
              onClick={sendTest}
              loading={m.sendTest.isPending}
              title={ep.application_id ? 'Runs the real signed delivery pipeline to this URL' : 'Link an application first'}
            >
              Send test event
            </Button>
            <Button size="sm" leftIcon={<Link2 className="h-3.5 w-3.5" />} onClick={() => setUseForOpen(true)} disabled={!apps.data?.length}>
              Use for application
            </Button>
            <Button size="sm" variant="ghost" leftIcon={<Eraser className="h-3.5 w-3.5" />} onClick={() => setConfirmClear(true)}>
              Clear
            </Button>
            <Button size="sm" variant="ghost" aria-label="Delete sandbox endpoint" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border-strong bg-surface-2 py-1 pr-1 pl-3">
          <code className="min-w-0 flex-1 overflow-x-auto py-1 text-[12.5px] whitespace-nowrap" translate="no">
            {ep.url}
          </code>
          <CopyButton value={ep.url} label="Copy URL" showLabel />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label htmlFor="sb-app" className="text-[13px] text-muted sm:w-56">
            Verify signatures with
          </label>
          <Select
            id="sb-app"
            value={ep.application_id ?? ''}
            onChange={async (e) => {
              try {
                await m.update.mutateAsync({ id: ep.id, body: { application_id: e.target.value || null } })
                toast.success(e.target.value ? 'Signatures will be verified with that application’s secret.' : 'Signature verification disabled.')
              } catch (err) {
                toast.fromError(err)
              }
            }}
            className="sm:max-w-xs"
          >
            <option value="">No application (don’t verify)</option>
            {apps.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          {linked && linked.endpoint.url !== ep.url && (
            <span className="text-xs text-subtle">“{linked.name}” currently delivers elsewhere.</span>
          )}
        </div>
      </CardBody>

      <Modal
        open={useForOpen}
        onClose={() => setUseForOpen(false)}
        title="Use this sandbox for an application"
        description="Sets the application's endpoint URL to this sandbox URL (and adds its host to the allowlist if one exists)."
        size="sm"
        footer={
          <>
            <Button onClick={() => setUseForOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={m.useFor.isPending}
              disabled={!appId}
              onClick={async () => {
                try {
                  await m.useFor.mutateAsync({ id: ep.id, appId })
                  toast.success('Application now delivers to the sandbox.')
                  setUseForOpen(false)
                } catch (e) {
                  toast.fromError(e)
                }
              }}
            >
              Point it here
            </Button>
          </>
        }
      >
        <Field label="Application">{(p) => <AppSelect id={p.id} value={appId} onChange={setAppId} className="sm:w-full" />}</Field>
        <Alert tone="warning" className="mt-3">
          The application&apos;s current endpoint URL will be replaced. Note it down if you need to switch back.
        </Alert>
      </Modal>
      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Clear captured requests?"
        description="All stored requests for this endpoint are deleted. The URL keeps working."
        confirmLabel="Clear requests"
        loading={m.clear.isPending}
        onConfirm={async () => {
          try {
            await m.clear.mutateAsync(ep.id)
            toast.success('Requests cleared')
            setConfirmClear(false)
          } catch (e) {
            toast.fromError(e)
          }
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete sandbox endpoint?"
        description="Its URL stops working immediately and captured requests are deleted. Applications pointing at it will fail to deliver."
        confirmLabel="Delete endpoint"
        loading={m.remove.isPending}
        onConfirm={async () => {
          try {
            await m.remove.mutateAsync(ep.id)
            toast.success('Sandbox endpoint deleted')
            setConfirmDelete(false)
          } catch (e) {
            toast.fromError(e)
          }
        }}
      />
    </Card>
  )
}

function CreateEndpointModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { create } = useSandboxMutations()
  const [name, setName] = useState('')
  const [appId, setAppId] = useState('')
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New sandbox endpoint"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={create.isPending}
            disabled={!name.trim()}
            onClick={async () => {
              try {
                const ep = await create.mutateAsync({ name: name.trim(), application_id: appId || null })
                setName('')
                onCreated(ep.id)
                onClose()
              } catch {
                /* shown below */
              }
            }}
          >
            Create endpoint
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {create.error != null && <ErrorAlert error={create.error} />}
        <Field label="Name">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="Staging receiver" data-autofocus maxLength={80} />}</Field>
        <Field label="Verify signatures with" optional hint="Uses this application’s signing secret to check X-NFC-Signature.">
          {(p) => (
            <Select {...p} value={appId} onChange={(e) => setAppId(e.target.value)}>
              <option value="">None</option>
              <AppOptions />
            </Select>
          )}
        </Field>
      </div>
    </Modal>
  )
}

function AppOptions() {
  const apps = useApplications()
  return (
    <>
      {apps.data?.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </>
  )
}

export default function SandboxPage() {
  useDocumentTitle('Sandbox')
  const { data, isLoading, error, refetch } = useSandboxEndpoints()
  const apps = useApplications()
  const [params, setParams] = useSearchParams()
  const [creating, setCreating] = useState(false)
  const selectedId = params.get('endpoint')
  const ep = data?.find((e) => e.id === selectedId) ?? data?.[0]
  const select = (id: string) => setParams({ endpoint: id }, { replace: true })

  // Keep the URL pointing at a real endpoint after deletes.
  useEffect(() => {
    if (data && selectedId && !data.some((e) => e.id === selectedId)) setParams({}, { replace: true })
  }, [data, selectedId, setParams])

  const linkedApp = apps.data?.find((a) => a.id === ep?.application_id)
  useTour('developer.sandbox', developerSandboxTour, { ready: !!ep })

  return (
    <>
      <PageHeader
        title="Sandbox"
        description="A hosted test endpoint that shows exactly what the platform and phones send you — headers, body, signature verdict — and answers however you like."
        actions={
          <>
            {data && data.length > 1 && ep && (
              <Select aria-label="Sandbox endpoint" value={ep.id} onChange={(e) => select(e.target.value)} className="sm:w-56">
                {data.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </Select>
            )}
            <Button variant={data?.length ? 'secondary' : 'primary'} leftIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              New endpoint
            </Button>
          </>
        }
      />
      {error ? (
        <Card>
          <ErrorState error={error} onRetry={() => refetch()} />
        </Card>
      ) : isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      ) : !ep ? (
        <Card>
          <EmptyState
            icon={FlaskConical}
            title="No sandbox endpoints"
            description="Create one to get a URL you can point any application at while you build your integration."
            action={
              <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
                Create sandbox endpoint
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          <EndpointHeader key={`h-${ep.id}`} ep={ep} />
          <RunConsole key={`run-${ep.id}`} sandbox={ep} />
          <div data-tour="sandbox-stream">
            <RequestStream key={`s-${ep.id}`} ep={ep} />
          </div>
          <div data-tour="sandbox-simulator">
          <ResponseSimulator key={`r-${ep.id}-${ep.response_status}-${ep.response_delay_ms}`} ep={ep} timeoutSeconds={linkedApp?.endpoint.timeout_seconds ?? null} />
          </div>
        </div>
      )}
      <CreateEndpointModal open={creating} onClose={() => setCreating(false)} onCreated={select} />
    </>
  )
}

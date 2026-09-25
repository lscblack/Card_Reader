import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Link2, RefreshCw, Search, Wrench } from 'lucide-react'
import { request } from '@/api/client'
import { cn } from '@/lib/cn'
import { CodeBlock } from '../components/Code'
import { B, C, Callout, DocHeader, H2, P, PrevNext, Table } from '../components/Prose'

interface CatalogEntry {
  code: string
  ref: string
  http_status: number | null
  source: 'api' | 'delivery' | 'mobile'
  title: string
  description: string
  fix: string
}

const fetchCatalog = () => request<CatalogEntry[]>('GET', '/errors', { auth: false })

const envelope = `{
  "error": {
    "code": "invalid_api_key",
    "message": "The API key is not valid.",
    "details": null,
    "ref": "NFC-1003",
    "request_id": "3f9c…",
    "docs_url": "{PUBLIC_WEB_URL}/docs/errors#NFC-1003"
  }
}`

const ranges: [string, string][] = [
  ['NFC-1xxx', 'Auth, sessions and credentials'],
  ['NFC-2xxx', 'Request, validation and rate limiting'],
  ['NFC-3xxx', 'Applications, keys, endpoints and allowlists'],
  ['NFC-4xxx', 'Devices, events and pairing'],
  ['NFC-5xxx', 'Webhook delivery failures'],
  ['NFC-6xxx', 'Business domain (cards, actions, team…)'],
  ['NFC-7xxx', 'Plans, billing and limits'],
  ['NFC-8xxx', 'Sandbox and admin'],
  ['NFC-9xxx', 'Server and infrastructure (NFC-9000 = internal error)'],
  ['MOB-1xxx', 'Mobile-app-side failures: NFC hardware, offline, TLS, signing…'],
]

/** Carried over from the original dashboard docs; shown when the live catalog is unavailable. */
const commonCodes: [string, string, string][] = [
  ['401', 'invalid_credentials', 'Wrong email or password'],
  ['401', 'unauthorized · invalid_token · token_expired · token_revoked', 'Dashboard session missing, invalid, expired or invalidated (e.g. after a password change) — sign in again'],
  ['401', 'invalid_api_key · api_key_revoked', 'Device registration with an unknown or revoked API key'],
  ['401', 'invalid_device_token', 'Unknown device token'],
  ['401', 'invalid_pairing_code', 'Pairing code unknown, already used, expired or cancelled'],
  ['401', 'device_revoked', 'The device was revoked — wipe the token and register again'],
  ['402', 'plan_limit_reached', "Your plan's application, device, card or monthly event limit is reached"],
  ['403', 'account_disabled', 'Your account was deactivated by an administrator'],
  ['403', 'application_disabled', 'The application is paused — devices keep their token and retry later'],
  ['403', 'insufficient_permissions', 'Your business role lacks the permission in details.required'],
  ['409', 'event_id_conflict', 'The event_id was already used by another device'],
  ['409', 'endpoint_outside_allowlist', 'The new allowed-domains list would exclude the current endpoint URL'],
  ['409', 'origin_exists', 'That allowed origin is already configured'],
  ['422', 'domain_not_allowed', "The endpoint host is not in the application's allowed domains"],
  ['422', 'validation_error', 'Invalid input; details lists { field, message }'],
  ['429', 'rate_limited', 'Too many requests — wait for Retry-After seconds'],
  ['500', 'internal_error', 'Unexpected server error — quote the request_id'],
]

const sourceLabel: Record<CatalogEntry['source'], string> = { api: 'API', delivery: 'Delivery', mobile: 'Mobile app' }

function refSortKey(ref: string) {
  const m = /^([A-Z]+)-(\d+)$/.exec(ref)
  return m ? `${m[1] === 'NFC' ? 0 : 1}-${m[2].padStart(6, '0')}` : `2-${ref}`
}

function EntryCard({ e, highlighted }: { e: CatalogEntry; highlighted: boolean }) {
  return (
    <li
      id={e.ref}
      className={cn(
        'group scroll-mt-24 rounded-xl border bg-surface p-4 transition-colors sm:p-5',
        highlighted ? 'border-accent ring-2 ring-accent/30' : 'border-border',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <a href={`#${e.ref}`} className="inline-flex items-center gap-1 font-mono text-[13.5px] font-bold text-accent hover:underline">
          {e.ref}
          <Link2 className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
        </a>
        <code className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] break-all text-fg">{e.code}</code>
        <span className="ml-auto flex gap-1.5">
          {e.http_status != null && (
            <span className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[11.5px] font-semibold text-muted">HTTP {e.http_status}</span>
          )}
          <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11.5px] font-medium text-muted">{sourceLabel[e.source] ?? e.source}</span>
        </span>
      </div>
      <h3 className="mt-2.5 text-[15.5px] font-semibold text-fg">{e.title}</h3>
      <p className="mt-1 text-[14px] leading-relaxed text-muted">{e.description}</p>
      {e.fix && (
        <p className="mt-3 flex gap-2 rounded-lg bg-surface-2 p-3 text-[13.5px] leading-relaxed text-muted">
          <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <span>
            <B>How to fix:</B> {e.fix}
          </span>
        </p>
      )}
    </li>
  )
}

const selectCls =
  'h-10 rounded-lg border border-border bg-surface px-3 text-[14px] text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring'

export default function Errors() {
  const location = useLocation()
  const q = useQuery({ queryKey: ['public', 'error-catalog'], queryFn: fetchCatalog, staleTime: 10 * 60_000, retry: 1 })
  const [text, setText] = useState('')
  const [source, setSource] = useState<'all' | CatalogEntry['source']>('all')
  const [status, setStatus] = useState<string>('all')
  const hashRef = decodeURIComponent(location.hash.slice(1))

  const all = useMemo(() => [...(q.data ?? [])].sort((a, b) => refSortKey(a.ref).localeCompare(refSortKey(b.ref))), [q.data])
  const statuses = useMemo(
    () => Array.from(new Set(all.map((e) => (e.http_status == null ? 'none' : String(e.http_status))))).sort(),
    [all],
  )
  const counts = useMemo(() => {
    const c = { api: 0, delivery: 0, mobile: 0 }
    for (const e of all) if (e.source in c) c[e.source] += 1
    return c
  }, [all])

  const filtered = useMemo(() => {
    const t = text.trim().toLowerCase()
    return all.filter((e) => {
      if (source !== 'all' && e.source !== source) return false
      if (status !== 'all' && (e.http_status == null ? 'none' : String(e.http_status)) !== status) return false
      if (!t) return true
      return `${e.ref} ${e.code} ${e.title} ${e.description} ${e.fix} ${e.http_status ?? ''}`.toLowerCase().includes(t)
    })
  }, [all, text, source, status])

  // Deep link: /docs/errors#NFC-1003 → scroll once the catalog has rendered.
  useEffect(() => {
    if (!hashRef || !q.data) return
    const t = window.setTimeout(() => document.getElementById(hashRef)?.scrollIntoView({ block: 'start' }), 60)
    return () => window.clearTimeout(t)
  }, [hashRef, q.data])

  return (
    <article>
      <DocHeader slug="errors" />

      <H2 id="envelope">Error envelope</H2>
      <P>
        Every non-2xx response uses the same envelope. <C>code</C> is machine-readable, <C>ref</C> is a stable catalog id, and{' '}
        <C>docs_url</C> links straight to the entry on this page. Quote <C>request_id</C> when asking for support — it identifies the request
        in the logs.
      </P>
      <CodeBlock language="json" title="Error envelope" code={envelope} />
      <P>
        Failed webhook deliveries carry <C>error_code</C> and <C>error_ref</C> on the delivery and event (e.g. <C>delivery_timeout</C>). The
        mobile app shows the <C>ref</C> for API errors and uses <C>MOB-*</C> refs for local failures.
      </P>

      <H2 id="ranges">Ref ranges</H2>
      <Table head={['Range', 'Area']} rows={ranges.map(([r, a]) => [<C key="r">{r}</C>, a])} minWidth={420} />

      <H2 id="catalog">Catalog</H2>
      {q.isError ? (
        <>
          <Callout tone="warning" title="The live error catalog is unavailable">
            <p>
              We couldn&apos;t load <C>GET /api/v1/errors</C> right now, so refs, descriptions and fixes can&apos;t be shown. The most common
              codes are listed below; try again in a moment.
            </p>
            <button
              type="button"
              onClick={() => q.refetch()}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-[13px] font-medium text-fg hover:bg-surface-2"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', q.isFetching && 'animate-spin')} aria-hidden="true" /> Retry
            </button>
          </Callout>
          <Table head={['HTTP', 'code', 'Meaning']} rows={commonCodes.map(([h, c, m]) => [h, <C key="c">{c}</C>, m])} />
        </>
      ) : (
        <>
          <div className="sticky top-16 z-10 -mx-1 my-4 flex flex-col gap-2 bg-bg/90 px-1 py-2 backdrop-blur sm:flex-row">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Search errors</span>
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
              <input
                type="search"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Search by ref, code or text — e.g. NFC-1003, timeout"
                className="h-10 w-full rounded-lg border border-border bg-surface pr-3 pl-9 text-[14px] text-fg outline-none placeholder:text-subtle focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            <div className="flex gap-2">
              <label className="min-w-0 flex-1 sm:flex-none">
                <span className="sr-only">Source</span>
                <select value={source} onChange={(e) => setSource(e.target.value as typeof source)} className={cn(selectCls, 'w-full')}>
                  <option value="all">All sources</option>
                  <option value="api">API ({counts.api})</option>
                  <option value="delivery">Delivery ({counts.delivery})</option>
                  <option value="mobile">Mobile ({counts.mobile})</option>
                </select>
              </label>
              <label className="min-w-0 flex-1 sm:flex-none">
                <span className="sr-only">HTTP status</span>
                <select value={status} onChange={(e) => setStatus(e.target.value)} className={cn(selectCls, 'w-full')}>
                  <option value="all">Any status</option>
                  {statuses.map((s) => (
                    <option key={s} value={s}>
                      {s === 'none' ? 'No HTTP status' : `HTTP ${s}`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {q.isLoading ? (
            <ul className="space-y-3" aria-busy="true" aria-label="Loading error catalog">
              {Array.from({ length: 5 }, (_, i) => (
                <li key={i} className="h-28 animate-pulse rounded-xl border border-border bg-surface-2" />
              ))}
            </ul>
          ) : (
            <>
              <p className="mb-3 text-[13px] text-subtle" aria-live="polite">
                Showing {filtered.length} of {all.length} errors
              </p>
              {filtered.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-8 text-center text-[14px] text-muted">
                  No errors match these filters.
                </p>
              ) : (
                <ul className="space-y-3">
                  {filtered.map((e) => (
                    <EntryCard key={e.ref} e={e} highlighted={e.ref === hashRef} />
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
      <PrevNext slug="errors" />
    </article>
  )
}

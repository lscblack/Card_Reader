import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Search, Siren } from 'lucide-react'
import { useAdminErrors } from '@/hooks/useAdmin3'
import { useDebounced } from '@/hooks/useDebounce'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useNow } from '@/hooks/useNow'
import { num, relativeTime } from '@/lib/format'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Delta, SourceBadge } from '@/components/ErrorCenterBits'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { Input, Select, Switch } from '@/components/ui/Input'
import { SkeletonRows } from '@/components/ui/Spinner'
import { Table, TableWrap, TBody, TD, TH, THead, TR } from '@/components/ui/Table'
import { Sparkline } from '@/components/Sparkline'

export default function AdminErrorsPage() {
  useDocumentTitle('Admin · Error center')
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const now = useNow()
  const range = params.get('range') ?? '24h'
  const source = params.get('source') ?? ''
  const only = params.get('only') !== '0'
  const [q, setQ] = useState(params.get('q') ?? '')
  const dq = useDebounced(q.trim(), 300)
  const { data, isLoading, error, refetch } = useAdminErrors({ range, source: source || undefined, q: dq || undefined, only_occurring: only })
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }
  const sorted = [...(data ?? [])].sort((a, b) => (b.stats?.count ?? -1) - (a.stats?.count ?? -1))
  const total = sorted.reduce((s, e) => s + (e.stats?.count ?? 0), 0)

  return (
    <>
      <PageHeader title="Error center" description="Every error the platform can return, what it means, how often it happens and who it affects." />
      <Card>
        <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:px-5">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-subtle" />
            <Input aria-label="Search errors" placeholder="Search code, ref or meaning" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
          </div>
          <Select aria-label="Range" value={range} onChange={(e) => set('range', e.target.value)} className="sm:w-32">
            <option value="24h">24 hours</option>
            <option value="7d">7 days</option>
            <option value="30d">30 days</option>
          </Select>
          <Select aria-label="Source" value={source} onChange={(e) => set('source', e.target.value)} className="sm:w-36">
            <option value="">All sources</option>
            <option value="api">API</option>
            <option value="delivery">Delivery</option>
            <option value="mobile">Mobile</option>
          </Select>
          <label className="flex items-center gap-2 text-[13px] text-muted">
            <Switch checked={only} onChange={(v) => set('only', v ? '' : '0')} label="Only occurring" /> Only occurring
          </label>
        </div>
        {!isLoading && !error && (
          <p className="border-b border-border px-4 py-2 text-xs text-subtle sm:px-5">
            {num(sorted.length)} error codes · {num(total)} occurrences in {range}
          </p>
        )}
        {error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <SkeletonRows rows={8} cols={5} />
        ) : !sorted.length ? (
          <EmptyState icon={Siren} title={only ? 'No errors occurred in this range' : 'No errors match'} description={only ? 'Turn off “Only occurring” to browse the whole catalog.' : undefined} />
        ) : (
          <TableWrap>
            <Table className="min-w-[900px]">
              <THead>
                <tr>
                  <TH>Error</TH>
                  <TH>Meaning</TH>
                  <TH className="text-right">Count</TH>
                  <TH>Trend</TH>
                  <TH>Affected</TH>
                  <TH>Last seen</TH>
                </tr>
              </THead>
              <TBody>
                {sorted.map((e) => (
                  <TR key={e.ref} onClick={() => navigate(`/admin/errors/${encodeURIComponent(e.ref)}?range=${range}`)} tabIndex={0} onKeyDown={(ev) => ev.key === 'Enter' && navigate(`/admin/errors/${encodeURIComponent(e.ref)}?range=${range}`)}>
                    <TD>
                      <p className="flex items-center gap-1.5">
                        <code className="font-mono text-[12.5px] font-medium">{e.code}</code>
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs">
                        <span className="font-mono text-accent">{e.ref}</span>
                        <SourceBadge source={e.source} />
                        {e.http_status && <span className="font-mono text-subtle">{e.http_status}</span>}
                      </p>
                    </TD>
                    <TD className="max-w-[340px]">
                      <p className="font-medium">{e.title}</p>
                      <p className="line-clamp-1 text-xs text-muted">{e.description}</p>
                    </TD>
                    <TD className="text-right">
                      {e.stats ? (
                        <>
                          <p className="font-semibold tabular-nums">{num(e.stats.count)}</p>
                          <Delta now={e.stats.count} prev={e.stats.previous_count} />
                        </>
                      ) : (
                        <span className="text-xs text-subtle">client-side</span>
                      )}
                    </TD>
                    <TD>{e.stats ? <Sparkline values={e.stats.trend.map((t) => t.count)} label={`${e.code} trend`} /> : <span className="text-xs text-subtle">—</span>}</TD>
                    <TD className="text-xs whitespace-nowrap text-muted">
                      {e.stats ? `${num(e.stats.affected_users)} users · ${num(e.stats.affected_devices)} devices` : '—'}
                    </TD>
                    <TD className="whitespace-nowrap text-muted">{e.stats?.last_seen_at ? relativeTime(e.stats.last_seen_at, now) : 'Never'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </>
  )
}

import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, ArrowLeft, ExternalLink, Lightbulb, Smartphone, Users } from 'lucide-react'
import type { RequestLog } from '@/api/types'
import { useAdminError } from '@/hooks/useAdmin3'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { axisProps, chartColors } from '@/lib/chartColors'
import { dateTime, num } from '@/lib/format'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Spinner'
import { StatCard } from '@/components/StatCard'
import { RequestLogDrawer, RequestLogTable } from '@/components/RequestLogs'
import { DeliveriesTable } from '@/components/Webhooks'
import { Delta, SourceBadge } from '@/components/ErrorCenterBits'

export default function AdminErrorDetailPage() {
  const { ref } = useParams()
  const [params, setParams] = useSearchParams()
  const range = params.get('range') ?? '7d'
  const { data: e, isLoading, error, refetch } = useAdminError(ref, range)
  const [log, setLog] = useState<RequestLog | null>(null)
  useDocumentTitle(`Admin · ${ref ?? 'Error'}`)
  const bucketFmt = (iso: string) =>
    range === '24h' ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

  return (
    <>
      <Link to={`/admin/errors?range=${range}`} className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" /> Error center
      </Link>
      {error ? (
        <Card>
          <ErrorState error={error} onRetry={() => refetch()} />
        </Card>
      ) : isLoading || !e ? (
        <div className="space-y-4">
          <Skeleton className="h-8 w-80" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <>
          <PageHeader
            title={
              <span className="flex flex-wrap items-center gap-2.5">
                <code className="font-mono">{e.code}</code>
                <span className="font-mono text-base text-accent">{e.ref}</span>
                <SourceBadge source={e.source} />
                {e.http_status && <span className="font-mono text-base text-subtle">HTTP {e.http_status}</span>}
              </span>
            }
            description={e.title}
            actions={
              <>
                <Select aria-label="Range" value={range} onChange={(ev) => setParams({ range: ev.target.value }, { replace: true })} className="w-32">
                  <option value="24h">24 hours</option>
                  <option value="7d">7 days</option>
                  <option value="30d">30 days</option>
                </Select>
                <a
                  href={`/docs/errors#${encodeURIComponent(e.ref)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3 text-sm font-medium hover:bg-surface-2"
                >
                  Public docs <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </>
            }
          />
          <div className="space-y-6">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader title="What it means" />
                <CardBody className="text-[13.5px] leading-relaxed text-muted">{e.description}</CardBody>
              </Card>
              <Card>
                <CardHeader
                  title={
                    <span className="flex items-center gap-2">
                      <Lightbulb className="h-4 w-4 text-amber-500" /> How to fix it
                    </span>
                  }
                />
                <CardBody className="text-[13.5px] leading-relaxed text-muted">{e.fix}</CardBody>
              </Card>
            </div>
            {!e.stats ? (
              <Card>
                <EmptyState icon={Smartphone} title="Client-side error" description="Mobile (MOB-*) errors happen on the phone and aren’t reported to the server, so there are no statistics." />
              </Card>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                  <StatCard label={`Occurrences (${range})`} value={num(e.stats.count)} icon={AlertTriangle} hint={<Delta now={e.stats.count} prev={e.stats.previous_count} />} />
                  <StatCard label="Previous period" value={num(e.stats.previous_count)} />
                  <StatCard label="Affected users / devices" value={`${num(e.stats.affected_users)} / ${num(e.stats.affected_devices)}`} icon={Users} />
                  <StatCard label="Last seen" value={e.stats.last_seen_at ? dateTime(e.stats.last_seen_at) : 'Never'} />
                </div>
                <Card>
                  <CardHeader title="Trend" />
                  <CardBody>
                    <div className="h-56" role="img" aria-label={`${e.code} occurrences over time`}>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={e.stats.trend.map((t) => ({ ...t, label: bucketFmt(t.bucket) }))} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                          <CartesianGrid vertical={false} stroke={chartColors.grid} />
                          <XAxis dataKey="label" {...axisProps} minTickGap={24} />
                          <YAxis {...axisProps} allowDecimals={false} width={40} />
                          <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12, color: 'var(--fg)' }} />
                          <Area type="monotone" dataKey="count" name="Occurrences" stroke={chartColors.primary} fill={chartColors.primary} fillOpacity={0.15} strokeWidth={2} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </CardBody>
                </Card>
                <div className="grid gap-6 lg:grid-cols-2">
                  <Card>
                    <CardHeader title="Top routes" />
                    {!e.top_routes.length ? (
                      <EmptyState title="No route data" />
                    ) : (
                      <ul className="divide-y divide-border">
                        {e.top_routes.map((r) => (
                          <li key={r.route} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                            <Link to={`/admin/logs?route=${encodeURIComponent(r.route)}&error_code=${encodeURIComponent(e.code)}`} className="min-w-0 truncate font-mono text-[12.5px] hover:text-accent">
                              {r.route}
                            </Link>
                            <span className="text-[13px] font-medium tabular-nums">{num(r.count)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                  <Card>
                    <CardHeader title="Top users" />
                    {!e.top_users.length ? (
                      <EmptyState title="No user data" />
                    ) : (
                      <ul className="divide-y divide-border">
                        {e.top_users.map((u) => (
                          <li key={u.id} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                            <Link to={`/admin/accounts/${u.id}`} className="min-w-0 truncate text-[13px] hover:text-accent">
                              {u.email}
                            </Link>
                            {u.count != null && <span className="text-[13px] font-medium tabular-nums">{num(u.count)}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                </div>
                {e.recent.length > 0 && (
                  <Card>
                    <CardHeader
                      title="Recent requests"
                      actions={
                        <Link to={`/admin/logs?error_code=${encodeURIComponent(e.code)}`} className="text-[13px] font-medium text-accent hover:underline">
                          All in log explorer
                        </Link>
                      }
                    />
                    <RequestLogTable logs={e.recent} onSelect={setLog} showActor />
                  </Card>
                )}
                {e.recent_deliveries.length > 0 && (
                  <Card>
                    <CardHeader title="Recent deliveries" />
                    <DeliveriesTable deliveries={e.recent_deliveries} />
                  </Card>
                )}
              </>
            )}
          </div>
        </>
      )}
      <RequestLogDrawer log={log} onClose={() => setLog(null)} />
    </>
  )
}

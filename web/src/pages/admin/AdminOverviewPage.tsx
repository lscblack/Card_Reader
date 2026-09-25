import { useState } from 'react'
import { Link } from 'react-router'
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Activity, AlertTriangle, AppWindow, ArrowRight, Building2, Gauge, Nfc, Send, Smartphone, Timer, Users } from 'lucide-react'
import type { AdminOverview, AdminRange } from '@/api/types'
import { useAdminOverview } from '@/hooks/useConsole'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { axisProps, chartColors } from '@/lib/chartColors'
import { compact, num, percent } from '@/lib/format'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { ErrorState, EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Spinner'
import { ErrorRef } from '@/components/ui/ErrorMeta'
import { Table, TableWrap, TBody, TD, TH, THead } from '@/components/ui/Table'
import { StatCard } from '@/components/StatCard'
import { LiveToggle, RangePicker, SplitMeter } from '@/components/AdminBits'
import { useTour, adminConsoleTour } from '@/tours'

function bucketLabel(iso: string, range: AdminRange) {
  const d = new Date(iso)
  return range === '1h' || range === '24h'
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const tooltipStyle = {
  contentStyle: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12, color: 'var(--fg)' },
  labelStyle: { color: 'var(--muted)', marginBottom: 4 },
}

function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full" style={{ background: i.color }} /> {i.label}
        </span>
      ))}
    </div>
  )
}

function Charts({ o, range }: { o: AdminOverview; range: AdminRange }) {
  const data = o.timeline.map((t) => ({ ...t, label: bucketLabel(t.bucket, range) }))
  if (!data.length) return <EmptyState icon={Activity} title="No traffic in this range" />
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div>
        <Legend
          items={[
            { label: 'Requests', color: chartColors.primary },
            { label: 'Errors', color: chartColors.warning },
          ]}
        />
        <div className="h-60" role="img" aria-label="Requests and errors over time">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
              <defs>
                <linearGradient id="reqFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chartColors.primary} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={chartColors.primary} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={chartColors.grid} />
              <XAxis dataKey="label" {...axisProps} minTickGap={28} />
              <YAxis {...axisProps} width={44} tickFormatter={(v: number) => compact(v)} allowDecimals={false} />
              <Tooltip {...tooltipStyle} />
              <Area type="monotone" dataKey="requests" name="Requests" stroke={chartColors.primary} strokeWidth={2} fill="url(#reqFill)" />
              <Area type="monotone" dataKey="errors" name="Errors" stroke={chartColors.warning} strokeWidth={2} fill="transparent" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div>
        <Legend
          items={[
            { label: 'p95 latency (ms)', color: chartColors.neutral },
          ]}
        />
        <div className="h-60" role="img" aria-label="p95 latency over time">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid vertical={false} stroke={chartColors.grid} />
              <XAxis dataKey="label" {...axisProps} minTickGap={28} />
              <YAxis {...axisProps} width={44} tickFormatter={(v: number) => `${v}`} />
              <Tooltip {...tooltipStyle} formatter={(v) => [`${v} ms`, 'p95']} />
              <Line type="monotone" dataKey="p95_ms" name="p95" stroke={chartColors.neutral} strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

export default function AdminOverviewPage() {
  useDocumentTitle('Admin · Overview')
  const [range, setRange] = useState<AdminRange>('24h')
  const [live, setLive] = useState(false)
  const { data: o, error, refetch } = useAdminOverview(range, live)
  useTour('admin.console', adminConsoleTour, { ready: !!o })

  return (
    <>
      <PageHeader
        title="Platform overview"
        description="Traffic, errors, deliveries and devices across every account."
        actions={
          <>
            <span data-tour="admin-range" className="inline-flex">
              <RangePicker value={range} onChange={setRange} />
            </span>
            <LiveToggle live={live} onChange={setLive} />
          </>
        }
      />
      {error ? (
        <Card>
          <ErrorState error={error} onRetry={() => refetch()} />
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatCard label="Users" value={num(o?.users.total)} icon={Users} loading={!o} hint={o && `${num(o.users.developers)} dev · ${num(o.users.businesses)} business · +${num(o.users.new_in_range)} new`} />
            <StatCard label="Businesses" value={num(o?.businesses)} icon={Building2} loading={!o} hint={o && `${num(o.users.active_24h)} users active 24h`} />
            <StatCard label="Applications" value={num(o?.applications)} icon={AppWindow} loading={!o} />
            <StatCard label="Devices online" value={o ? `${num(o.devices.online)} / ${num(o.devices.total)}` : '—'} icon={Smartphone} loading={!o} hint={o && `${num(o.devices.revoked)} revoked`} />
            <StatCard label="Requests" value={compact(o?.requests.total)} icon={Activity} loading={!o} hint={o && `${num(o.requests.rpm_now)} req/min now`} />
            <StatCard
              label="Error rate"
              value={o ? percent(o.requests.error_rate, 2) : '—'}
              icon={AlertTriangle}
              loading={!o}
              hint={o && `${num(o.requests.client_error)} 4xx · ${num(o.requests.server_error)} 5xx`}
            />
            <StatCard label="Latency p95" value={o?.requests.p95_ms != null ? `${o.requests.p95_ms} ms` : '—'} icon={Timer} loading={!o} hint={o && `p50 ${o.requests.p50_ms ?? '—'} · p99 ${o.requests.p99_ms ?? '—'} ms`} />
            <StatCard label="Events / taps" value={o ? `${compact(o.events_in_range)} / ${compact(o.taps_in_range)}` : '—'} icon={Nfc} loading={!o} hint="NFC events · business taps" />
          </div>

          <Card>
            <CardHeader title="Traffic" description="Requests, errors and p95 latency per time bucket." />
            <CardBody>{!o ? <Skeleton className="h-60 w-full" /> : <Charts o={o} range={range} />}</CardBody>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    <Send className="h-4 w-4 text-accent" /> Delivery health
                  </span>
                }
                description={o ? `Success rate ${o.deliveries.success_rate == null ? '—' : percent(o.deliveries.success_rate)} · queue depth ${num(o.deliveries.queue_depth)}` : undefined}
                actions={
                  <Link to="/admin/deliveries" className="text-[13px] font-medium text-accent hover:underline">
                    Deliveries
                  </Link>
                }
              />
              <CardBody>
                {!o ? <Skeleton className="h-10" /> : <SplitMeter a={o.deliveries.succeeded} b={o.deliveries.failed} aLabel="Succeeded" bLabel="Failed" />}
              </CardBody>
            </Card>
            <Card>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    <Gauge className="h-4 w-4 text-accent" /> Device fleet
                  </span>
                }
                description="Online = heartbeat or event within 2 minutes."
                actions={
                  <Link to="/admin/devices" className="text-[13px] font-medium text-accent hover:underline">
                    Monitor
                  </Link>
                }
              />
              <CardBody>
                {!o ? (
                  <Skeleton className="h-10" />
                ) : (
                  <SplitMeter a={o.devices.online} b={o.devices.offline} aLabel="Online" bLabel="Offline" bColor="var(--border-strong)" />
                )}
              </CardBody>
            </Card>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader title="Top routes" />
              {!o ? (
                <CardBody>
                  <Skeleton className="h-40" />
                </CardBody>
              ) : !o.top_routes.length ? (
                <EmptyState title="No requests" />
              ) : (
                <TableWrap>
                  <Table className="min-w-[520px]">
                    <THead>
                      <tr>
                        <TH>Route</TH>
                        <TH className="text-right">Requests</TH>
                        <TH className="text-right">Errors</TH>
                        <TH className="text-right">p95</TH>
                      </tr>
                    </THead>
                    <TBody>
                      {o.top_routes.map((r) => (
                        <tr key={r.route}>
                          <TD className="max-w-[280px] truncate font-mono text-[12px]">
                            <Link to={`/admin/logs?route=${encodeURIComponent(r.route)}`} className="hover:text-accent">
                              {r.route}
                            </Link>
                          </TD>
                          <TD className="text-right tabular-nums">{num(r.count)}</TD>
                          <TD className={r.error_rate > 0.05 ? 'text-right text-red-600 tabular-nums dark:text-red-400' : 'text-right text-muted tabular-nums'}>
                            {percent(r.error_rate)}
                          </TD>
                          <TD className="text-right whitespace-nowrap text-muted tabular-nums">{r.p95_ms != null ? `${r.p95_ms} ms` : "—"}</TD>
                        </tr>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
              )}
            </Card>
            <Card>
              <CardHeader
                title="Top errors"
                actions={
                  <Link to="/admin/logs?outcome=server_error" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
                    Explore <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                }
              />
              {!o ? (
                <CardBody>
                  <Skeleton className="h-40" />
                </CardBody>
              ) : !o.top_errors.length ? (
                <EmptyState title="No errors in this range" description="Nice." />
              ) : (
                <ul className="divide-y divide-border">
                  {o.top_errors.map((e) => {
                    const max = o.top_errors[0].count || 1
                    return (
                      <li key={e.error_code} className="px-4 py-2.5 sm:px-5">
                        <div className="flex items-center justify-between gap-3">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <Link
                              to={`/admin/logs?error_code=${encodeURIComponent(e.error_code)}`}
                              className="truncate font-mono text-[12.5px] hover:text-accent"
                              title="Show matching requests"
                            >
                              {e.error_code}
                            </Link>
                            <ErrorRef refId={e.error_ref} />
                          </span>
                          <span className="text-[13px] font-medium tabular-nums">{num(e.count)}</span>
                        </div>
                        <div className="mt-1.5 h-1 rounded-full bg-surface-3">
                          <div className="h-full rounded-full" style={{ width: `${(e.count / max) * 100}%`, background: chartColors.warning }} />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  )
}

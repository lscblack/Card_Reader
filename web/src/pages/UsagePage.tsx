import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts'
import { BarChart3, Check, Table2 } from 'lucide-react'
import type { Plan, UsageDaily } from '@/api/types'
import { usePlans, useSubscription, useUsage } from '@/hooks/queries'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { compact, dateOnly, money, num, percent } from '@/lib/format'
import { cn } from '@/lib/cn'
import { chartColors } from '@/lib/chartColors'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Spinner'
import { Select } from '@/components/ui/Input'
import { Table, TableWrap, TBody, TD, TH, THead } from '@/components/ui/Table'
import { FreeOfferBanner } from '@/components/FreeOfferBanner'

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const ratio = limit ? Math.min(1, used / limit) : 0
  const tone = ratio >= 1 ? 'bg-red-500' : ratio >= 0.8 ? 'bg-amber-500' : 'bg-accent-solid'
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[13px]">
        <span className="font-medium">{label}</span>
        <span className="text-muted tabular-nums">
          <span className="font-medium text-fg">{num(used)}</span> / {limit == null ? 'Unlimited' : num(limit)}
        </span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit ?? undefined}
        aria-valuenow={used}
      >
        <div className={cn('h-full rounded-full transition-[width]', tone)} style={{ width: limit == null ? '0%' : `${ratio * 100}%` }} />
      </div>
      {limit != null && ratio >= 0.8 && (
        <p className={cn('mt-1.5 text-xs', ratio >= 1 ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-400')}>
          {ratio >= 1 ? 'Limit reached — new requests return 402 plan_limit_reached.' : `${percent(ratio, 0)} used`}
        </p>
      )}
    </div>
  )
}

const shortDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

function ChartTooltip({ active, payload, label }: TooltipContentProps<number, string>) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload as UsageDaily
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-[12.5px] shadow-lg">
      <p className="mb-1 font-medium">{dateOnly(`${label}T00:00:00`)}</p>
      <p className="flex items-center gap-2 text-muted">
        <span className="h-2 w-2 rounded-sm bg-[var(--chart-2)]" /> Delivered <span className="ml-auto pl-4 font-medium text-fg tabular-nums">{num(row.delivered)}</span>
      </p>
      <p className="flex items-center gap-2 text-muted">
        <span className="h-2 w-2 rounded-sm bg-[var(--chart-1)]" /> Failed <span className="ml-auto pl-4 font-medium text-fg tabular-nums">{num(row.failed)}</span>
      </p>
      <p className="mt-1 flex items-center gap-2 border-t border-border pt-1 text-muted">
        Total events <span className="ml-auto pl-4 font-medium text-fg tabular-nums">{num(row.events)}</span>
      </p>
    </div>
  )
}

function DailyChart({ daily }: { daily: UsageDaily[] }) {
  const [asTable, setAsTable] = useState(false)
  return (
    <Card>
      <CardHeader
        title="Daily events"
        description="Card events per day, split by delivery outcome. Pending/retrying events are counted in the total only."
        actions={
          <Button size="sm" variant="ghost" leftIcon={asTable ? <BarChart3 className="h-4 w-4" /> : <Table2 className="h-4 w-4" />} onClick={() => setAsTable((v) => !v)}>
            {asTable ? 'Chart' : 'Table'}
          </Button>
        }
      />
      <CardBody>
        {asTable ? (
          <TableWrap className="max-h-80 overflow-y-auto">
            <Table>
              <THead>
                <tr>
                  <TH>Date</TH>
                  <TH className="text-right">Events</TH>
                  <TH className="text-right">Delivered</TH>
                  <TH className="text-right">Failed</TH>
                </tr>
              </THead>
              <TBody>
                {[...daily].reverse().map((d) => (
                  <tr key={d.date}>
                    <TD>{dateOnly(`${d.date}T00:00:00`)}</TD>
                    <TD className="text-right tabular-nums">{num(d.events)}</TD>
                    <TD className="text-right tabular-nums">{num(d.delivered)}</TD>
                    <TD className="text-right tabular-nums">{num(d.failed)}</TD>
                  </tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-4 text-xs text-muted">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-[var(--chart-2)]" /> Delivered
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-[var(--chart-1)]" /> Failed
              </span>
            </div>
            <div className="h-64 w-full" role="img" aria-label="Bar chart of daily events, delivered versus failed. Use the Table button for the data.">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daily} margin={{ top: 4, right: 4, bottom: 0, left: -12 }} barCategoryGap="20%">
                  <CartesianGrid vertical={false} stroke={chartColors.grid} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={shortDate}
                    tick={{ fill: chartColors.axis, fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--border)' }}
                    minTickGap={24}
                  />
                  <YAxis
                    allowDecimals={false}
                    tickFormatter={(v: number) => compact(v)}
                    tick={{ fill: chartColors.axis, fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={44}
                  />
                  <Tooltip content={(p) => <ChartTooltip {...(p as TooltipContentProps<number, string>)} />} cursor={{ fill: chartColors.cursor }} />
                  <Bar dataKey="delivered" stackId="a" fill={chartColors.success} stroke={chartColors.surface} strokeWidth={1} name="Delivered" />
                  <Bar dataKey="failed" stackId="a" fill={chartColors.danger} stroke={chartColors.surface} strokeWidth={1} radius={[4, 4, 0, 0]} name="Failed" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  )
}

function PlanCard({ plan, current }: { plan: Plan; current: boolean }) {
  const paid = plan.price_monthly_cents > 0
  return (
    <div className={cn('flex flex-col rounded-xl border bg-surface p-5', current ? 'border-accent ring-1 ring-accent' : 'border-border')}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold">{plan.name}</h3>
        {current && <Badge tone="accent">Current plan</Badge>}
      </div>
      <p className="mt-2">
        <span className="text-2xl font-semibold tracking-tight">{money(plan.price_monthly_cents, plan.currency)}</span>
        <span className="text-[13px] text-muted"> / month</span>
      </p>
      <ul className="mt-4 flex-1 space-y-2 text-[13px] text-muted">
        <li className="flex gap-2">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          {plan.events_per_month == null ? 'Unlimited' : compact(plan.events_per_month)} events / month
        </li>
        <li className="flex gap-2">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          {plan.max_applications == null ? 'Unlimited' : plan.max_applications} applications
        </li>
        <li className="flex gap-2">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          {plan.max_devices == null ? 'Unlimited' : plan.max_devices} devices
        </li>
        {plan.features.map((f) => (
          <li key={f} className="flex gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            {f}
          </li>
        ))}
      </ul>
      <div className="mt-5">
        {current ? (
          <Button className="w-full" disabled>
            Your plan
          </Button>
        ) : paid ? (
          <Button className="w-full" disabled title="Paid plans are not available yet">
            Upgrade — coming soon
          </Button>
        ) : (
          <Button className="w-full" disabled>
            Free forever
          </Button>
        )}
      </div>
    </div>
  )
}

export default function UsagePage() {
  useDocumentTitle('Usage')
  const [days, setDays] = useState(30)
  const usage = useUsage(days)
  const plans = usePlans()
  const sub = useSubscription()
  const u = usage.data
  const currentCode = sub.data?.plan.code ?? u?.plan.code

  return (
    <>
      <PageHeader
        title="Usage & billing"
        description="Your plan, how much of it you're using, and delivery health over time."
        actions={
          <Select aria-label="Range" value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-36">
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </Select>
        }
      />
      <FreeOfferBanner className="mb-6" />
      {usage.error ? (
        <Card>
          <ErrorState error={usage.error} onRetry={() => usage.refetch()} />
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
            <Card className="p-5">
              {!u ? (
                <div className="space-y-3">
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-8 w-32" />
                  <Skeleton className="h-4 w-full" />
                </div>
              ) : (
                <>
                  <p className="text-[12.5px] font-medium text-muted">Current plan</p>
                  <p className="mt-1 text-2xl font-semibold tracking-tight">{u.plan.name}</p>
                  <p className="text-[13px] text-muted">
                    {money(u.plan.price_monthly_cents, u.plan.currency)} / month
                    {sub.data && (
                      <>
                        {' · '}
                        <span className="capitalize">{sub.data.status}</span>
                      </>
                    )}
                  </p>
                  <div className="mt-4 rounded-lg bg-surface-2 p-3 text-[13px]">
                    <p className="text-xs text-subtle">Billing period</p>
                    <p className="font-medium">
                      {dateOnly(u.period_start)} – {dateOnly(u.period_end)}
                    </p>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-lg font-semibold tabular-nums">{compact(u.totals.events)}</p>
                      <p className="text-[11.5px] text-subtle">Events</p>
                    </div>
                    <div>
                      <p className="text-lg font-semibold tabular-nums">{compact(u.totals.delivered)}</p>
                      <p className="text-[11.5px] text-subtle">Delivered</p>
                    </div>
                    <div>
                      <p className="text-lg font-semibold tabular-nums">{compact(u.totals.failed)}</p>
                      <p className="text-[11.5px] text-subtle">Failed</p>
                    </div>
                  </div>
                </>
              )}
            </Card>
            <Card>
              <CardHeader title="Limits" description="Resets at the start of each billing period (events only)." />
              <CardBody className="space-y-5">
                {!u ? (
                  Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)
                ) : (
                  <>
                    <Meter label="Events this period" used={u.totals.events} limit={u.limits.events_per_month} />
                    <Meter label="Applications" used={u.totals.applications} limit={u.limits.applications} />
                    <Meter label="Devices" used={u.totals.devices} limit={u.limits.devices} />
                  </>
                )}
              </CardBody>
            </Card>
          </div>

          {!u ? <Skeleton className="h-80 w-full rounded-xl" /> : <DailyChart daily={u.daily} />}

          <section>
            <h2 className="mb-1 text-[15px] font-semibold tracking-tight">Plans</h2>
            <p className="mb-4 text-[13px] text-muted">Paid plans are coming soon. Online payments aren&apos;t enabled yet.</p>
            {plans.error ? (
              <Card>
                <ErrorState error={plans.error} onRetry={() => plans.refetch()} />
              </Card>
            ) : !plans.data ? (
              <div className="grid gap-4 md:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-72 rounded-xl" />
                ))}
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-3">
                {plans.data.filter((p) => !p.audience || p.audience === 'developer').map((p) => (
                  <PlanCard key={p.code} plan={p} current={p.code === currentCode} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </>
  )
}

import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Activity, Globe, MousePointerClick, Nfc, Radio, Users } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { cn } from '@/lib/cn'
import { dateTime, num, relativeTime } from '@/lib/format'
import type { AnalyticsRange, CardTap } from '../api/types'
import { useBusiness, useCan } from '../hooks/context'
import { useAnalytics, useCards } from '../hooks/queries'
import { CHART } from '../lib/chart'
import { DEVICE_TYPE_LABEL, RANGES, actionLabel, assigneeTypeLabel, countryName, delta } from '../lib/format'
import { FilterBar, FilterSelect, KpiCard, TapResultBadge, TapSourceBadge } from '../components/bits'
import { BizErrorState, NoAccess } from '../components/BizError'
import { EmployeeSelect } from '../components/Pickers'
import { RangePicker } from '../components/inputs'
import { BarList, HourChart, TimelineChart } from '../components/charts'
import { TapDetailDrawer } from '../components/Taps'

export default function AnalyticsPage() {
  const { business, base } = useBusiness()
  const can = useCan()
  const navigate = useNavigate()
  useDocumentTitle('Analytics')
  const [params, setParams] = useSearchParams()
  const range = (RANGES.some((r) => r.value === params.get('range')) ? params.get('range') : '30d') as AnalyticsRange
  const cardId = params.get('card_id') ?? ''
  const employeeId = params.get('employee_id') ?? ''
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }
  const allowed = can('analytics.view')
  const { data: a, error, isLoading, isFetching, refetch } = useAnalytics(business.id, { range, card_id: cardId || undefined, employee_id: employeeId || undefined }, allowed)
  const cards = useCards(business.id, { page_size: 100 }, allowed)
  const [tap, setTap] = useState<CardTap | null>(null)
  const rangeLabel = RANGES.find((r) => r.value === range)?.label.toLowerCase()

  if (!allowed) {
    return (
      <>
        <PageHeader title="Analytics" />
        <Card>
          <NoAccess permission="analytics.view" what="analytics" />
        </Card>
      </>
    )
  }

  const p = a?.previous_period_totals
  return (
    <>
      <PageHeader
        title="Analytics"
        description="How customers interact with your cards and tags. Link-preview bots are excluded."
        actions={<RangePicker value={range} onChange={(v) => set('range', v)} />}
      />
      <Card className="mb-6">
        <FilterBar className="border-b-0">
          <FilterSelect
            label="Card or tag"
            value={cardId}
            onChange={(v) => set('card_id', v)}
            options={[{ value: '', label: 'All cards & tags' }, ...(cards.data?.items ?? []).map((c) => ({ value: c.id, label: c.name }))]}
            className="sm:w-60"
          />
          <EmployeeSelect aria-label="Employee" value={employeeId} onChange={(v) => set('employee_id', v)} emptyLabel="All employees" className="sm:w-56" />
          {(cardId || employeeId) && (
            <Button size="sm" variant="ghost" onClick={() => setParams(range === '30d' ? {} : { range }, { replace: true })}>
              Clear filters
            </Button>
          )}
          {isFetching && !isLoading && <span className="text-xs text-subtle sm:ml-auto">Updating…</span>}
        </FilterBar>
      </Card>

      {error ? (
        <Card>
          <BizErrorState error={error} onRetry={() => refetch()} />
        </Card>
      ) : (
        <div className={cn('space-y-6 transition-opacity', isFetching && !isLoading && 'opacity-70')}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <KpiCard label="Taps" value={a?.totals.taps ?? 0} icon={MousePointerClick} loading={!a} delta={a ? delta(a.totals.taps, p?.taps) : undefined} />
            <KpiCard label="Unique visitors" value={a?.totals.unique_visitors ?? 0} icon={Users} loading={!a} delta={a ? delta(a.totals.unique_visitors, p?.unique_visitors) : undefined} />
            <KpiCard label="Web taps" value={a?.totals.web_taps ?? 0} icon={Globe} loading={!a} delta={a ? delta(a.totals.web_taps, p?.web_taps) : undefined} />
            <KpiCard label="Reader taps" value={a?.totals.reader_taps ?? 0} icon={Radio} loading={!a} delta={a ? delta(a.totals.reader_taps, p?.reader_taps) : undefined} />
            <KpiCard label="Active cards" value={a?.totals.active_cards ?? 0} icon={Nfc} loading={!a} delta={a ? delta(a.totals.active_cards, p?.active_cards) : undefined} />
            <KpiCard label="Active employees" value={a?.totals.active_employees ?? 0} icon={Activity} loading={!a} delta={a ? delta(a.totals.active_employees, p?.active_employees) : undefined} />
          </div>
          <p className="-mt-3 text-xs text-subtle">Changes compare with the previous {rangeLabel}.</p>

          <Card>
            <CardHeader title="Taps over time" description={a ? `${num(a.totals.taps)} taps · ${num(a.totals.unique_visitors)} unique visitors` : undefined} />
            <CardBody>
              {!a ? (
                <Skeleton className="h-64" />
              ) : (
                <TimelineChart
                  data={a.timeline}
                  height={260}
                  label={`Daily taps and unique visitors over the last ${rangeLabel}`}
                  series={[
                    { key: 'taps', label: 'Taps', color: CHART.primary },
                    { key: 'unique_visitors', label: 'Unique visitors', color: CHART.secondary },
                  ]}
                />
              )}
            </CardBody>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Top cards & tags" />
              <CardBody>
                {!a ? (
                  <Skeleton className="h-48" />
                ) : (
                  <BarList items={a.by_card.map((c) => ({ key: c.card_id, label: c.name, value: c.taps, onClick: () => set('card_id', c.card_id) }))} />
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Top employees" />
              <CardBody>
                {!a ? (
                  <Skeleton className="h-48" />
                ) : (
                  <BarList
                    items={a.by_employee.map((e) => ({ key: e.employee_id, label: e.name, value: e.taps, onClick: () => navigate(`${base}/employees/${e.employee_id}`) }))}
                    empty="No taps on employee cards in this period."
                  />
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="By action" />
              <CardBody>{!a ? <Skeleton className="h-40" /> : <BarList items={a.by_action.filter((x) => x.action_type).map((x) => ({ key: x.action_type, label: actionLabel(x.action_type), value: x.taps }))} />}</CardBody>
            </Card>
            <Card>
              <CardHeader title="Device types" description="Phones that opened your links (readers count as Android)." />
              <CardBody>
                {!a ? (
                  <Skeleton className="h-40" />
                ) : (
                  <BarList items={a.by_device_type.filter((x) => x.device_type).map((x) => ({ key: x.device_type, label: DEVICE_TYPE_LABEL[x.device_type] ?? x.device_type, value: x.taps }))} color={CHART.secondary} />
                )}
              </CardBody>
            </Card>
            {(!a || a.by_assignee_type) && (
              <Card className="lg:col-span-2">
                <CardHeader title="By owner type" description="Taps on company cards vs cards held by employees or customers." />
                <CardBody>
                  {!a ? (
                    <Skeleton className="h-24" />
                  ) : (
                    <BarList
                      items={(['business', 'employee', 'customer', 'unassigned'] as const)
                        .map((k) => ({
                          key: k,
                          label: k === 'business' ? `${business.name} (company)` : k === 'unassigned' ? 'Unassigned' : `${assigneeTypeLabel(k)}s`,
                          value: a.by_assignee_type?.[k] ?? 0,
                        }))
                        .filter((x) => x.value > 0)}
                      color={CHART.tertiary}
                    />
                  )}
                </CardBody>
              </Card>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className={a && a.by_country.some((x) => x.country) ? 'lg:col-span-2' : 'lg:col-span-3'}>
              <CardHeader title="Time of day" description="When taps happen (your local time)." />
              <CardBody>{!a ? <Skeleton className="h-44" /> : <HourChart data={a.by_hour} />}</CardBody>
            </Card>
            {a && a.by_country.some((x) => x.country) && (
              <Card>
                <CardHeader title="Countries" />
                <CardBody>
                  <BarList items={a.by_country.filter((x) => x.country).slice(0, 8).map((x) => ({ key: x.country, label: countryName(x.country), value: x.taps }))} color={CHART.tertiary} />
                </CardBody>
              </Card>
            )}
          </div>

          <Card>
            <CardHeader
              title="Last activity"
              actions={
                <Link to={`${base}/events`} className="text-[13px] font-medium text-accent hover:underline">
                  All events
                </Link>
              }
            />
            <CardBody>
              {!a ? (
                <Skeleton className="h-10" />
              ) : a.last_activity ? (
                <button type="button" onClick={() => setTap(a.last_activity)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg p-1 text-left hover:bg-surface-2">
                  <span className="font-medium">{a.last_activity.card_name ?? 'Unknown card'}</span>
                  {a.last_activity.assignee && <span className="text-muted">· {a.last_activity.assignee.name}</span>}
                  <TapSourceBadge source={a.last_activity.source} />
                  <TapResultBadge result={a.last_activity.result} />
                  <span className="text-[13px] text-subtle sm:ml-auto" title={dateTime(a.last_activity.created_at)}>
                    {relativeTime(a.last_activity.created_at)}
                  </span>
                </button>
              ) : (
                <p className="text-[13px] text-muted">No taps in this period.</p>
              )}
            </CardBody>
          </Card>
        </div>
      )}
      <TapDetailDrawer tap={tap} onClose={() => setTap(null)} />
    </>
  )
}

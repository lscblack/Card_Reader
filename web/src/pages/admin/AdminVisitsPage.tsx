import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Eye, Globe, LifeBuoy, Users } from 'lucide-react'
import { visitsApi } from '@/api/visits'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/EmptyState'
import { Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Spinner'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { num } from '@/lib/format'
import { BarList, TimelineChart } from '@/business/components/charts'
import { KpiCard } from '@/business/components/bits'
import { CHART } from '@/business/lib/chart'

const RANGES = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 365, label: 'Last 12 months' },
]
const KIND_LABEL = { site: 'Website pages', support: 'Support page', business: 'Business pages (/b/…)', personal: 'Personal cards (/p/…)' }
const DEVICE_LABEL: Record<string, string> = { ios: 'iPhone / iPad', android: 'Android', desktop: 'Desktop', other: 'Other' }

export default function AdminVisitsPage() {
  useDocumentTitle('Visits')
  const [days, setDays] = useState(30)
  const q = useQuery({ queryKey: ['admin', 'visits', days], queryFn: () => visitsApi.site(days) })
  const v = q.data
  const range = RANGES.find((r) => r.value === days)?.label.toLowerCase()

  return (
    <>
      <PageHeader
        title="Visits"
        description="People opening the website, the Support page, business pages and personal cards. Bots and signed-in dashboards aren’t counted."
        actions={
          <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        }
      />
      {q.error ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Visits today" value={v?.today.visits ?? 0} icon={Eye} loading={!v} hint={v ? `${num(v.today.unique_visitors)} unique` : undefined} />
            <KpiCard label="Visits · 7 days" value={v?.last_7_days.visits ?? 0} icon={CalendarDays} loading={!v} hint={v ? `${num(v.last_7_days.unique_visitors)} unique` : undefined} />
            <KpiCard label={`Visits · ${range}`} value={v?.period.visits ?? 0} icon={Globe} loading={!v} />
            <KpiCard label={`Unique visitors · ${range}`} value={v?.period.unique_visitors ?? 0} icon={Users} loading={!v} hint="Counted per day" />
          </div>

          <Card>
            <CardHeader title="Visits over time" description={v ? `${num(v.period.visits)} visits · ${num(v.period.unique_visitors)} unique visitors` : undefined} />
            <CardBody>
              {!v ? (
                <Skeleton className="h-64" />
              ) : (
                <TimelineChart
                  data={v.daily}
                  height={260}
                  label={`Daily visits and unique visitors, ${range}`}
                  series={[
                    { key: 'visits', label: 'Visits', color: CHART.primary },
                    { key: 'unique_visitors', label: 'Unique visitors', color: CHART.secondary },
                  ]}
                />
              )}
            </CardBody>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Where visits go" />
              <CardBody>
                {!v ? (
                  <Skeleton className="h-40" />
                ) : (
                  <BarList
                    items={(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((k) => ({
                      key: k,
                      label: (
                        <span className="flex items-center gap-1.5">
                          {k === 'support' && <LifeBuoy className="h-3.5 w-3.5 text-accent" />}
                          {KIND_LABEL[k]}
                        </span>
                      ),
                      value: v.by_kind[k],
                    }))}
                  />
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Top pages" />
              <CardBody>
                {!v ? (
                  <Skeleton className="h-40" />
                ) : (
                  <BarList
                    items={v.top_pages.map((p) => ({ key: p.path, label: <span className="font-mono text-[12.5px]">{p.path}</span>, value: p.visits, href: p.path }))}
                    empty="No visits in this period yet."
                  />
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Where visitors come from" description="Other websites that linked here (direct visits aren’t listed)." />
              <CardBody>
                {!v ? <Skeleton className="h-40" /> : <BarList items={v.top_referrers.map((r) => ({ key: r.host, label: r.host, value: r.visits }))} empty="No referring websites in this period." />}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Devices" />
              <CardBody>
                {!v ? (
                  <Skeleton className="h-40" />
                ) : (
                  <BarList items={Object.entries(v.devices).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ key: k, label: DEVICE_LABEL[k] ?? k, value: n }))} />
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </>
  )
}

import { useState } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Spinner'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { BarList, TimelineChart } from '@/business/components/charts'
import { KpiCard } from '@/business/components/bits'
import { BizErrorState } from '@/business/components/BizError'
import { delta } from '@/business/lib/format'
import { CHART } from '@/business/lib/chart'
import { usePStats } from '../hooks/queries'
import { SOURCE_LABELS } from '../lib/card'
import { ActivityList } from '../components/ActivityList'

const RANGES = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
]

export default function ActivityPage() {
  useDocumentTitle('Activity')
  const [range, setRange] = useState('30d')
  const [page, setPage] = useState(1)
  const { data: s, error, refetch } = usePStats(range)
  return (
    <>
      <PageHeader
        title="Activity"
        description="Who viewed, tapped and exchanged with your cards."
        actions={
          <div className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5" role="radiogroup" aria-label="Range">
            {RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                role="radio"
                aria-checked={range === r.value}
                onClick={() => setRange(r.value)}
                className={range === r.value ? 'h-7 rounded-md bg-surface px-2.5 text-[12.5px] font-medium shadow-xs ring-1 ring-border' : 'h-7 rounded-md px-2.5 text-[12.5px] font-medium text-muted hover:text-fg'}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />
      <div className="space-y-6">
        {error ? (
          <Card>
            <BizErrorState error={error} onRetry={() => refetch()} />
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard label="Views" value={s?.totals.views ?? 0} loading={!s} delta={s ? delta(s.totals.views, s.previous_totals?.views) : undefined} />
              <KpiCard label="NFC taps" value={s?.totals.nfc_taps ?? 0} loading={!s} delta={s ? delta(s.totals.nfc_taps, s.previous_totals?.nfc_taps) : undefined} />
              <KpiCard label="Exchanges" value={s?.totals.exchanges ?? 0} loading={!s} delta={s ? delta(s.totals.exchanges, s.previous_totals?.exchanges) : undefined} />
              <KpiCard label="Leads" value={s?.totals.leads ?? 0} loading={!s} delta={s ? delta(s.totals.leads, s.previous_totals?.leads) : undefined} />
            </div>
            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader title="Over time" />
                <CardBody>
                  {!s ? (
                    <Skeleton className="h-56" />
                  ) : (
                    <TimelineChart
                      data={s.timeline}
                      height={220}
                      label="Daily views, NFC taps and exchanges"
                      series={[
                        { key: 'views', label: 'Views', color: CHART.primary },
                        { key: 'nfc_taps', label: 'NFC taps', color: CHART.secondary },
                        { key: 'exchanges', label: 'Exchanges', color: CHART.tertiary },
                      ]}
                    />
                  )}
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="How people opened your card" />
                <CardBody>{!s ? <Skeleton className="h-40" /> : <BarList items={s.by_source.map((x) => ({ key: x.source, label: SOURCE_LABELS[x.source] ?? x.source, value: x.count }))} />}</CardBody>
              </Card>
            </div>
          </>
        )}
        <Card>
          <CardHeader title="Timeline" />
          <ActivityList page={page} onPage={setPage} />
        </Card>
      </div>
    </>
  )
}

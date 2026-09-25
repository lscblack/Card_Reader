import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { Activity, Pause, Play } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonRows } from '@/components/ui/Spinner'
import { Pagination } from '@/components/ui/Pagination'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import type { CardTap, TapFilters, TapResult, TapSource } from '../api/types'
import { useBusiness } from '../hooks/context'
import { useBizDevices, useTaps } from '../hooks/queries'
import { TAP_RESULT } from '../lib/format'
import { FilterBar, FilterSelect } from '../components/bits'
import { BizErrorState } from '../components/BizError'
import { EmployeeSelect } from '../components/Pickers'
import { TapDetailDrawer, TapsTable } from '../components/Taps'

export default function EventsPage() {
  const { business } = useBusiness()
  useDocumentTitle('NFC Events')
  const [params, setParams] = useSearchParams()
  const [live, setLive] = useState(true)
  const [tap, setTap] = useState<CardTap | null>(null)
  const devices = useBizDevices(business.id)
  const get = (k: string) => params.get(k) ?? ''
  const page = Number(params.get('page')) || 1
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    if (k !== 'page') next.delete('page')
    setParams(next, { replace: true })
  }
  const filters: TapFilters = {
    source: get('source') as TapSource | '',
    result: get('result') as TapResult | '',
    employee_id: get('employee_id') || undefined,
    card_id: get('card_id') || undefined,
    device_id: get('device_id') || undefined,
    date_from: get('from') ? `${get('from')}T00:00:00Z` : undefined,
    date_to: get('to') ? `${get('to')}T23:59:59Z` : undefined,
    page,
    page_size: 25,
  }
  const filtered = ['source', 'result', 'employee_id', 'card_id', 'device_id', 'from', 'to'].some((k) => params.get(k))
  const { data, error, isLoading, refetch, isFetching } = useTaps(business.id, filters, live && page === 1 ? 10_000 : false)

  return (
    <>
      <PageHeader
        title="NFC Events"
        description="Every tap on your cards and tags — from customers’ phones (web) and from your NFC Terminal devices (reader)."
        actions={
          <Button leftIcon={live ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} onClick={() => setLive((l) => !l)} aria-pressed={live}>
            {live ? 'Pause live' : 'Resume live'}
          </Button>
        }
      />
      <Card>
        <FilterBar>
          <FilterSelect
            label="Source"
            value={get('source')}
            onChange={(v) => set('source', v)}
            options={[
              { value: '', label: 'All sources' },
              { value: 'web', label: 'Web (customer phone)' },
              { value: 'reader', label: 'Reader (your device)' },
            ]}
          />
          <FilterSelect
            label="Result"
            value={get('result')}
            onChange={(v) => set('result', v)}
            options={[{ value: '', label: 'All results' }, ...Object.entries(TAP_RESULT).map(([value, m]) => ({ value, label: m.label }))]}
          />
          <EmployeeSelect aria-label="Employee" value={get('employee_id')} onChange={(v) => set('employee_id', v)} emptyLabel="All employees" className="sm:w-48" />
          <FilterSelect
            label="Device"
            value={get('device_id')}
            onChange={(v) => set('device_id', v)}
            options={[{ value: '', label: 'All devices' }, ...(devices.data ?? []).map((d) => ({ value: d.id, label: d.name }))]}
            className="sm:w-44"
          />
          <div className="flex items-center gap-2">
            <Input type="date" aria-label="From date" value={get('from')} onChange={(e) => set('from', e.target.value)} className="sm:w-40" />
            <span className="text-subtle">–</span>
            <Input type="date" aria-label="To date" value={get('to')} onChange={(e) => set('to', e.target.value)} className="sm:w-40" />
          </div>
          {filtered && (
            <Button size="sm" variant="ghost" onClick={() => setParams({}, { replace: true })}>
              Clear
            </Button>
          )}
          {live && page === 1 && (
            <span className="inline-flex items-center gap-1.5 text-xs text-subtle sm:ml-auto" aria-live="polite">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              {isFetching ? 'Refreshing…' : 'Live'}
            </span>
          )}
        </FilterBar>
        {error ? (
          <BizErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <SkeletonRows rows={8} cols={6} />
        ) : !data?.items.length ? (
          <EmptyState
            icon={Activity}
            title={filtered ? 'No taps match these filters' : 'No taps yet'}
            description={filtered ? 'Try widening the date range or clearing filters.' : 'When someone taps one of your cards or tags it appears here within seconds.'}
          />
        ) : (
          <>
            <TapsTable taps={data.items} onOpen={setTap} />
            <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={(p) => set('page', String(p))} />
          </>
        )}
      </Card>
      <TapDetailDrawer tap={tap} onClose={() => setTap(null)} />
    </>
  )
}

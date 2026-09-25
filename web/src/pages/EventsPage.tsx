import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Activity, FilterX, Info, Pause, Play, Search } from 'lucide-react'
import type { EventFilters, EventStatus } from '@/api/types'
import { useDevices, useEvents } from '@/hooks/queries'
import { useDebounced } from '@/hooks/useDebounce'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { cn } from '@/lib/cn'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { SkeletonRows, Spinner } from '@/components/ui/Spinner'
import { Pagination } from '@/components/ui/Pagination'
import { UidOnlyBadge } from '@/components/ui/Badge'
import { AppSelect } from '@/components/AppSelect'
import { EventDetailDrawer, EventsTable } from '@/components/Events'

const PAGE_SIZE = 25
const STATUSES: EventStatus[] = ['pending', 'delivered', 'retrying', 'failed']

/** Converts a local YYYY-MM-DD into an ISO-8601 UTC instant at the start / end of that local day. */
function dayBoundary(day: string, end: boolean): string | undefined {
  if (!day) return undefined
  const d = new Date(`${day}T${end ? '23:59:59.999' : '00:00:00'}`)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export default function EventsPage() {
  useDocumentTitle('NFC Events')
  const [params, setParams] = useSearchParams()
  const [selected, setSelected] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(false)

  const app = params.get('app') ?? ''
  const device = params.get('device') ?? ''
  const status = (params.get('status') ?? '') as EventStatus | ''
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const page = Math.max(1, Number(params.get('page')) || 1)
  const [cardInput, setCardInput] = useState(params.get('card') ?? '')
  const card = useDebounced(cardInput.trim().toUpperCase().replace(/[:\s-]/g, ''), 350)

  const setParam = (updates: Record<string, string>, resetPage = true) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(updates)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    if (resetPage) next.delete('page')
    setParams(next, { replace: true })
  }

  // Sync the debounced card search into the URL.
  useEffect(() => {
    if ((params.get('card') ?? '') !== card) setParam({ card })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card])

  const filters: EventFilters = useMemo(
    () => ({
      application_id: app || undefined,
      device_id: device || undefined,
      card_id: card || undefined,
      status: status || undefined,
      date_from: dayBoundary(from, false),
      date_to: dayBoundary(to, true),
      page,
      page_size: PAGE_SIZE,
    }),
    [app, device, card, status, from, to, page],
  )

  const { data, isLoading, isFetching, error, refetch } = useEvents(filters, autoRefresh ? 5000 : false)
  const devices = useDevices({ application_id: app || undefined })
  const hasFilters = !!(app || device || card || status || from || to)

  return (
    <>
      <PageHeader
        title="NFC Events"
        description="Every card tap reported by your devices, with its delivery status."
        actions={
          <Button
            variant={autoRefresh ? 'primary' : 'secondary'}
            leftIcon={autoRefresh ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            onClick={() => setAutoRefresh((v) => !v)}
            aria-pressed={autoRefresh}
          >
            {autoRefresh ? 'Live · every 5s' : 'Auto-refresh'}
          </Button>
        }
      />

      <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-border bg-surface px-3.5 py-2.5 text-[13px] text-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <p>
          Events marked <UidOnlyBadge /> mean a card was <strong className="text-fg">detected</strong> and its UID read — the card was{' '}
          <strong className="text-fg">not</strong> cryptographically authenticated. Treat card IDs as identifiers, not proof of identity.
        </p>
      </div>

      <Card>
        <div className="grid gap-2 border-b border-border px-4 py-3 sm:grid-cols-2 sm:px-5 lg:grid-cols-3 2xl:grid-cols-6">
          <AppSelect allowAll value={app} onChange={(v) => setParam({ app: v, device: '' })} className="sm:w-full" />
          <Select aria-label="Device" value={device} onChange={(e) => setParam({ device: e.target.value })}>
            <option value="">All devices</option>
            {devices.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-subtle" />
            <Input
              aria-label="Card ID"
              placeholder="Card ID (hex)"
              value={cardInput}
              onChange={(e) => setCardInput(e.target.value)}
              className="pl-8 font-mono text-[13px] uppercase placeholder:font-sans placeholder:normal-case"
              spellCheck={false}
            />
          </div>
          <Select aria-label="Status" value={status} onChange={(e) => setParam({ status: e.target.value })}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </Select>
          <Input type="date" aria-label="From date" value={from} max={to || undefined} onChange={(e) => setParam({ from: e.target.value })} />
          <Input type="date" aria-label="To date" value={to} min={from || undefined} onChange={(e) => setParam({ to: e.target.value })} />
        </div>
        {(hasFilters || isFetching) && (
          <div className="flex items-center gap-3 border-b border-border px-4 py-2 text-xs text-subtle sm:px-5">
            {hasFilters && (
              <button
                className="inline-flex items-center gap-1 font-medium text-muted hover:text-fg"
                onClick={() => {
                  setCardInput('')
                  setParams({}, { replace: true })
                }}
              >
                <FilterX className="h-3.5 w-3.5" /> Clear filters
              </button>
            )}
            <span className={cn('ml-auto inline-flex items-center gap-1.5', !isFetching && 'invisible')}>
              <Spinner className="h-3 w-3" /> Updating…
            </span>
          </div>
        )}

        {error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isLoading ? (
          <SkeletonRows rows={8} cols={6} />
        ) : !data?.items.length ? (
          <EmptyState
            icon={Activity}
            title={hasFilters ? 'No events match these filters' : 'No card events yet'}
            description={
              hasFilters ? 'Try widening the date range or clearing filters.' : 'Tap an NFC card on a registered device to see it here.'
            }
          />
        ) : (
          <>
            <EventsTable events={data.items} onSelect={(e) => setSelected(e.id)} />
            <Pagination
              page={data.page}
              pageSize={data.page_size}
              total={data.total}
              onPage={(p) => setParam({ page: p > 1 ? String(p) : '' }, false)}
            />
          </>
        )}
      </Card>

      <EventDetailDrawer eventId={selected} onClose={() => setSelected(null)} />
    </>
  )
}

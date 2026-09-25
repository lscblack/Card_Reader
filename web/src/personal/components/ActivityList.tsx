import { Eye, Handshake, Inbox, Nfc, Radio } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonRows } from '@/components/ui/Spinner'
import { Pagination } from '@/components/ui/Pagination'
import { useNow } from '@/hooks/useNow'
import { dateTime, relativeTime } from '@/lib/format'
import { BizErrorState } from '@/business/components/BizError'
import type { ActivityItem } from '../api/types'
import { useActivity } from '../hooks/queries'
import { SOURCE_LABELS } from '../lib/card'

const META: Record<string, { icon: typeof Eye; text: (a: ActivityItem) => string }> = {
  view: { icon: Eye, text: (a) => `Someone viewed your card${a.source ? ` via ${SOURCE_LABELS[a.source]?.toLowerCase() ?? a.source}` : ''}` },
  nfc_tap: { icon: Nfc, text: () => 'A phone read your card over NFC' },
  exchange: { icon: Handshake, text: (a) => `You exchanged cards with ${a.counterpart_name ?? 'someone'}` },
  lead: { icon: Inbox, text: (a) => `${a.counterpart_name ?? 'Someone'} shared their details with you` },
  terminal_read: { icon: Radio, text: (a) => a.description ?? 'Read by a terminal' },
}

export function ActivityList({ limit, page = 1, onPage }: { limit?: number; page?: number; onPage?: (p: number) => void }) {
  const now = useNow()
  const { data, error, isLoading, refetch } = useActivity(page)
  if (error) return <BizErrorState error={error} onRetry={() => refetch()} />
  if (isLoading) return <SkeletonRows rows={limit ?? 6} cols={2} />
  const items = (data?.items ?? []).slice(0, limit ?? undefined)
  if (!items.length) return <EmptyState icon={Eye} title="No activity yet" description="Share your card — views, taps and exchanges show up here." />
  return (
    <>
      <ul className="divide-y divide-border">
        {items.map((a) => {
          const m = META[a.type] ?? { icon: Eye, text: () => a.title ?? a.type }
          return (
            <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
                <m.icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px]">{m.text(a)}</span>
                {a.card_label && <span className="block text-xs text-subtle">{a.card_label} card</span>}
              </span>
              <span className="shrink-0 text-xs text-subtle" title={dateTime(a.created_at)}>
                {relativeTime(a.created_at, now)}
              </span>
            </li>
          )
        })}
      </ul>
      {onPage && data && <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPage={onPage} />}
    </>
  )
}

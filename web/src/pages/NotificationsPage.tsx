import { useState } from 'react'
import { useNavigate } from 'react-router'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Bell, CheckCheck, CheckCircle2, ExternalLink, Info, XCircle } from 'lucide-react'
import { notificationsApi } from '@/api/platform'
import type { AppNotification } from '@/api/types'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useNow } from '@/hooks/useNow'
import { useUnreadNotifications } from '@/hooks/useUnreadNotifications'
import { dateTime, relativeTime } from '@/lib/format'
import { cn } from '@/lib/cn'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState } from '@/components/ui/EmptyState'
import { SkeletonRows } from '@/components/ui/Spinner'
import { Pagination } from '@/components/ui/Pagination'
import { useToast } from '@/components/ui/toastContext'

const PAGE_SIZE = 20
const sevIcon = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle }
const sevColor = {
  info: 'text-accent bg-accent-soft',
  success: 'text-emerald-600 bg-emerald-500/10 dark:text-emerald-400',
  warning: 'text-amber-600 bg-amber-500/10 dark:text-amber-400',
  error: 'text-red-600 bg-red-500/10 dark:text-red-400',
}

/** Full notifications inbox, shared by every dashboard (developer, business, personal, admin). */
export default function NotificationsPage() {
  useDocumentTitle('Notifications')
  const qc = useQueryClient()
  const navigate = useNavigate()
  const now = useNow(30_000)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [page, setPage] = useState(1)
  const { count } = useUnreadNotifications()

  const list = useQuery({
    queryKey: ['notifications', 'list', filter, page],
    queryFn: () => notificationsApi.list({ unread: filter === 'unread' || undefined, page }),
    placeholderData: keepPreviousData,
  })
  const toast = useToast()
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] })

  async function open(n: AppNotification) {
    if (!n.read_at) await notificationsApi.read(n.id).then(refresh).catch(() => undefined)
    if (!n.link) return
    if (n.link.startsWith('/')) navigate(n.link)
    else window.open(n.link, '_blank', 'noopener')
  }

  const setTab = (f: 'all' | 'unread') => {
    setFilter(f)
    setPage(1)
  }

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Updates about your account, builds, exchanges and anything that needs your attention."
        actions={
          <Button
            leftIcon={<CheckCheck className="h-4 w-4" />}
            disabled={!count}
            onClick={() => void notificationsApi.readAll().then(refresh).catch((e: unknown) => toast.fromError(e))}
          >
            Mark all read
          </Button>
        }
      />
      <Card>
        <div className="flex items-center gap-1 border-b border-border px-4 py-2.5 sm:px-5" role="tablist" aria-label="Filter">
          {(['all', 'unread'] as const).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setTab(f)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors',
                filter === f ? 'bg-accent-soft text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
              )}
            >
              {f === 'all' ? 'All' : 'Unread'}
              {f === 'unread' && count > 0 && (
                <span className="rounded-full bg-accent-solid px-1.5 text-[10.5px] font-semibold text-accent-fg">{count > 99 ? '99+' : count}</span>
              )}
            </button>
          ))}
        </div>
        {list.error ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : list.isLoading ? (
          <SkeletonRows rows={5} cols={3} />
        ) : !list.data?.items.length ? (
          <EmptyState
            icon={Bell}
            title={filter === 'unread' ? "You're all caught up" : 'No notifications yet'}
            description={filter === 'unread' ? 'There are no unread notifications.' : 'When something needs your attention, it will show up here.'}
          />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {list.data.items.map((n) => {
                const Icon = sevIcon[n.severity] ?? Info
                return (
                  <li key={n.id}>
                    <button
                      onClick={() => void open(n)}
                      className={cn(
                        'flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2 sm:px-5',
                        !n.read_at && 'bg-accent-soft/40',
                      )}
                    >
                      <span className={cn('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg', sevColor[n.severity] ?? sevColor.info)}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className={cn('truncate text-[13.5px]', n.read_at ? 'font-medium text-muted' : 'font-semibold text-fg')}>{n.title}</span>
                          {!n.read_at && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />}
                        </span>
                        <span className="mt-0.5 block text-[13px] text-muted">{n.body}</span>
                        <span className="mt-1 block text-xs text-subtle" title={dateTime(n.created_at)}>
                          {relativeTime(n.created_at, now)}
                        </span>
                      </span>
                      {n.link && <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden="true" />}
                    </button>
                  </li>
                )
              })}
            </ul>
            <div className="border-t border-border px-4 py-3 sm:px-5">
              <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} />
            </div>
          </>
        )}
      </Card>
    </>
  )
}

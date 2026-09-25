import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Bell, CheckCheck, CheckCircle2, Info, XCircle } from 'lucide-react'
import { notificationsApi } from '@/api/platform'
import type { AppNotification } from '@/api/types'
import { useNow } from '@/hooks/useNow'
import { relativeTime } from '@/lib/format'
import { cn } from '@/lib/cn'
import { Spinner } from './ui/Spinner'
import { useToast } from './ui/toastContext'

const sevIcon = { info: Info, success: CheckCircle2, warning: AlertTriangle, error: XCircle }
const sevColor = {
  info: 'text-accent',
  success: 'text-emerald-500',
  warning: 'text-amber-500',
  error: 'text-red-500',
}

function countOf(r: { count: number } | { unread: number } | undefined): number {
  if (!r) return 0
  return 'count' in r ? r.count : r.unread
}

/** In-app notifications (Part 3 §10): unread badge, dropdown, mark read, toast for new success/error items. */
export function NotificationBell() {
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const now = useNow(30_000)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const seen = useRef<Set<string> | null>(null)

  const unread = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: notificationsApi.unreadCount,
    refetchInterval: 30_000,
    retry: false,
  })
  const count = countOf(unread.data)
  const list = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => notificationsApi.list({ page: 1 }),
    enabled: open || count > 0,
    retry: false,
  })

  // Refresh the list when the unread count changes; toast genuinely new success/error items.
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ['notifications', 'list'] })
  }, [count, qc])
  useEffect(() => {
    const items = list.data?.items
    if (!items) return
    if (seen.current === null) {
      seen.current = new Set(items.map((n) => n.id))
      return
    }
    for (const n of items) {
      if (seen.current.has(n.id)) continue
      seen.current.add(n.id)
      if (!n.read_at && (n.severity === 'success' || n.severity === 'error')) {
        if (n.severity === 'success') toast.success(n.body, n.title)
        else toast.error(n.body, n.title)
      }
    }
  }, [list.data, toast])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Hide entirely when the API doesn't support notifications yet.
  if (unread.isError && !unread.data) return null

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['notifications'] })])

  async function openItem(n: AppNotification) {
    if (!n.read_at) {
      void notificationsApi
        .read(n.id)
        .then(refresh)
        .catch(() => undefined)
    }
    if (n.link) {
      setOpen(false)
      if (n.link.startsWith('/')) navigate(n.link)
      else window.open(n.link, '_blank', 'noopener')
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
        data-tour="notifications"
      >
        <Bell className="h-4.5 w-4.5" />
        {count > 0 && (
          <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-solid px-1 text-[10px] font-semibold text-accent-fg">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="animate-pop-in fixed inset-x-3 top-16 z-50 max-h-[70vh] overflow-hidden rounded-xl border border-border bg-surface shadow-xl sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 sm:w-96"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p className="text-[13px] font-semibold">Notifications</p>
            <button
              className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline disabled:opacity-50"
              disabled={!count}
              onClick={() => void notificationsApi.readAll().then(refresh)}
            >
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </button>
          </div>
          <div className="max-h-[calc(70vh-44px)] overflow-y-auto">
            {list.isLoading ? (
              <div className="flex justify-center py-8 text-subtle">
                <Spinner />
              </div>
            ) : !list.data?.items.length ? (
              <p className="px-4 py-10 text-center text-[13px] text-muted">You&apos;re all caught up.</p>
            ) : (
              <ul className="divide-y divide-border">
                {list.data.items.map((n) => {
                  const Icon = sevIcon[n.severity] ?? Info
                  return (
                    <li key={n.id}>
                      <button
                        onClick={() => void openItem(n)}
                        className={cn('flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2', !n.read_at && 'bg-accent-soft/40')}
                      >
                        <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', sevColor[n.severity])} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-start justify-between gap-2">
                            <span className={cn('text-[13px]', !n.read_at ? 'font-semibold' : 'font-medium')}>{n.title}</span>
                            {!n.read_at && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-solid" aria-label="Unread" />}
                          </span>
                          <span className="mt-0.5 block text-xs text-muted">{n.body}</span>
                          <span className="mt-1 block text-[11px] text-subtle">{relativeTime(n.created_at, now)}</span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

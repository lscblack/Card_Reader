import { useQuery } from '@tanstack/react-query'
import { notificationsApi } from '@/api/platform'

type UnreadResponse = { count: number } | { unread: number }

export function unreadCountOf(r: UnreadResponse | undefined): number {
  if (!r) return 0
  return 'count' in r ? r.count : r.unread
}

/**
 * Unread notification count, shared by the top-bar bell and the sidebar badge
 * (same query key, so both stay in sync and only one request is made).
 */
export function useUnreadNotifications() {
  const q = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: notificationsApi.unreadCount,
    refetchInterval: 30_000,
    retry: false,
  })
  return { count: unreadCountOf(q.data), supported: !(q.isError && !q.data), query: q }
}

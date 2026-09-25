import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Construction, X } from 'lucide-react'
import { metaApi } from '@/api/usage'

/** Platform-wide notice set by admins (Part 2 §E: `GET /meta/status`). Refreshed every minute. */
export function MaintenanceBanner() {
  const { data } = useQuery({
    queryKey: ['meta-status'],
    queryFn: metaApi.status,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
  })
  const [dismissed, setDismissed] = useState<string | null>(null)
  const msg = data?.maintenance_message?.trim()
  if (!msg || dismissed === msg) return null
  return (
    <div className="mb-6 flex items-start gap-3 rounded-xl border border-sky-300/70 bg-sky-50 px-4 py-3 text-[13px] text-sky-900 dark:border-sky-400/25 dark:bg-sky-500/10 dark:text-sky-100" role="status">
      <Construction className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="min-w-0 flex-1 break-words">{msg}</p>
      <button
        onClick={() => setDismissed(msg)}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10"
        aria-label="Dismiss notice"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

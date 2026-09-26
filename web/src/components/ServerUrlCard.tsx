import { Smartphone, TriangleAlert } from 'lucide-react'
import { API_BASE_URL } from '@/api/client'
import { useServerMeta } from '@/hooks/queries'
import { Card } from '@/components/ui/Card'
import { CopyButton } from '@/components/ui/CopyButton'

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function isLoopback(url: string): boolean {
  try {
    return LOOPBACK.has(new URL(url).hostname)
  } catch {
    return false
  }
}

/** The URL to type into the nexTap app's "Server URL" field, with a copy button. */
export function ServerUrlCard() {
  const { data } = useServerMeta()
  const url = data?.device_server_url ?? API_BASE_URL
  const loopback = isLoopback(url)

  return (
    <Card className="px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
            <Smartphone className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-medium">Server URL for the mobile app</p>
            <p className="text-xs text-muted">Easiest: use “Pair a phone” and scan the QR code. Or enter this URL in nexTap with an API key.</p>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1 sm:flex-none">
          <code className="min-w-0 truncate rounded-md border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-[13px]">
            {url}
          </code>
          <CopyButton value={url} label="Copy server URL" />
        </div>
      </div>
      {loopback && (
        <p className="mt-2.5 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
          <TriangleAlert className="mt-px size-3.5 shrink-0" />
          A phone can't reach localhost. Set DEVICE_SERVER_URL in the backend .env to your computer's LAN address (e.g.
          http://192.168.1.20:8000).
        </p>
      )}
    </Card>
  )
}

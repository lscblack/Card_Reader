import { useState } from 'react'
import { Download, QrCode as QrIcon, Smartphone } from 'lucide-react'
import { useAppRelease } from '@/hooks/useAppRelease'
import { cn } from '@/lib/cn'
import { formatBytes } from '@/lib/format'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { CopyButton } from './ui/CopyButton'
import { QrCode } from './QrCode'

/** "Download Android app" card with version/size/SHA-256 and a QR code phones can scan. Hidden when there's no release. */
export function DownloadAppCard({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { data: r } = useAppRelease()
  const [showQr, setShowQr] = useState(false)
  if (!r) return null
  return (
    <Card className={cn('px-4 py-3.5 sm:px-5', className)} data-tour="download-app">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
            <Smartphone className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-medium">nexTap for Android</p>
            <p className="text-xs text-muted">
              v{r.version_name} ({r.build_number}) · {formatBytes(r.file_size)} · Android {r.min_android}+
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" leftIcon={<QrIcon className="h-3.5 w-3.5" />} onClick={() => setShowQr((v) => !v)} aria-expanded={showQr}>
            {showQr ? 'Hide QR' : 'Scan to download'}
          </Button>
          <a
            href={r.download_url}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent-solid px-2.5 text-[13px] font-medium text-accent-fg shadow-sm hover:bg-accent-solid-hover"
            download
          >
            <Download className="h-3.5 w-3.5" /> Download APK
          </a>
        </div>
      </div>
      {showQr && (
        <div className="mt-4 flex flex-col items-center gap-3 border-t border-border pt-4 sm:flex-row sm:items-start">
          <QrCode value={r.download_url} size={compact ? 140 : 168} label="QR code linking to the Android app download" />
          <div className="min-w-0 space-y-2 text-xs text-muted">
            <p>Scan with the phone’s camera to download the APK directly, then allow installs from your browser when Android asks.</p>
            <p className="flex items-center gap-1">
              <span className="shrink-0">SHA-256</span>
              <code className="truncate font-mono text-[11px]" title={r.sha256}>
                {r.sha256}
              </code>
              <CopyButton value={r.sha256} label="Copy SHA-256" />
            </p>
          </div>
        </div>
      )}
    </Card>
  )
}

/** Inline download block for the pair-phone dialog (button + QR side by side). */
export function DownloadAppInline() {
  const { data: r } = useAppRelease()
  if (!r) return null
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border p-3">
      <QrCode value={r.download_url} size={88} label="QR code to download the Android app" />
      <div className="min-w-0 space-y-1.5">
        <p className="text-[13px] font-medium">Don’t have nexTap yet?</p>
        <p className="text-xs text-muted">Scan to download v{r.version_name} ({formatBytes(r.file_size)}).</p>
        <a href={r.download_url} download className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
          <Download className="h-3.5 w-3.5" /> Download APK
        </a>
      </div>
    </div>
  )
}

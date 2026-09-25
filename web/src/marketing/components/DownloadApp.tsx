import { Download, ShieldCheck, Smartphone } from 'lucide-react'
import { QrCode } from '@/components/QrCode'
import { cn } from '@/lib/cn'
import { absoluteDownloadUrl, formatBytes, useAppRelease } from '../appRelease'

/**
 * "Download the Android app" card: version, size, minimum Android, a download button and a QR code for
 * phones. Shows "coming soon" when no release is published (404) or the API is unreachable.
 */
export function DownloadApp({ className, compact = false }: { className?: string; compact?: boolean }) {
  const q = useAppRelease()
  const release = q.data ?? null
  const url = release ? absoluteDownloadUrl(release) : null

  if (compact) {
    return (
      <div className={cn('rounded-xl border border-border bg-surface p-3 text-[12.5px]', className)}>
        <p className="flex items-center gap-1.5 font-semibold text-fg">
          <Smartphone className="h-4 w-4 text-accent" aria-hidden="true" /> NFC Terminal for Android
        </p>
        {url && release ? (
          <a href={url} className="mt-2 inline-flex items-center gap-1.5 font-medium text-accent hover:underline" rel="noopener">
            <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download v{release.version_name} · {formatBytes(release.file_size)}
          </a>
        ) : (
          <p className="mt-1 text-subtle">{q.isLoading ? 'Checking for the latest build…' : 'Download coming soon.'}</p>
        )}
      </div>
    )
  }

  return (
    <div className={cn('grid items-center gap-6 rounded-2xl border border-border bg-surface p-6 sm:grid-cols-[1fr_auto] sm:p-8', className)}>
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-[13px] font-semibold text-accent">
          <Smartphone className="h-4 w-4" aria-hidden="true" /> NFC Terminal for Android
        </p>
        <h3 className="mt-2 text-2xl font-semibold tracking-tight text-fg">Turn a phone into a reader today</h3>
        {release && url ? (
          <>
            <p className="mt-2 text-[14.5px] text-muted">
              Version <span className="font-semibold text-fg">{release.version_name}</span> · {formatBytes(release.file_size)} · Android {release.min_android}+
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <a
                href={url}
                rel="noopener"
                className="inline-flex items-center gap-2 rounded-lg bg-accent-solid px-4 py-2.5 text-[14px] font-semibold text-accent-fg transition-colors hover:bg-accent-solid-hover"
              >
                <Download className="h-4 w-4" aria-hidden="true" /> Download APK
              </a>
              <span className="text-[12.5px] text-subtle">or scan the QR code with your phone</span>
            </div>
            <p className="mt-4 flex items-start gap-1.5 text-[12px] break-all text-subtle">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                SHA-256 <span className="font-mono">{release.sha256}</span>
              </span>
            </p>
          </>
        ) : (
          <p className="mt-2 text-[14.5px] text-muted">
            {q.isLoading ? 'Checking for the latest build…' : 'The downloadable Android build is coming soon. Ask your administrator for the app in the meantime.'}
          </p>
        )}
      </div>
      {url && (
        <div className="justify-self-center">
          <QrCode value={url} size={148} label={`QR code to download NFC Terminal ${release?.version_name ?? ''}`} />
        </div>
      )}
    </div>
  )
}

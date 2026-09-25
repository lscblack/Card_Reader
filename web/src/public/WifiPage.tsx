import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { BadgeCheck, Check, Copy, Eye, EyeOff, Wifi } from 'lucide-react'
import { ApiError } from '@/api/client'
import { QrCode } from '@/components/QrCode'
import { publicApi } from './api'
import { PublicSkeleton, Unavailable } from './Unavailable'
import { UNAVAILABLE_REASONS } from './reasons'
import { PoweredBy } from '@/components/PoweredBy'

/** Android/iOS camera-compatible Wi-Fi QR payload (special chars escaped). */
function wifiPayload(ssid: string, password: string | null, security: string, hidden: boolean) {
  const esc = (s: string) => s.replace(/([\\;,:"])/g, '\\$1')
  return `WIFI:T:${security === 'nopass' ? 'nopass' : security};S:${esc(ssid)};${password && security !== 'nopass' ? `P:${esc(password)};` : ''}${hidden ? 'H:true;' : ''};`
}

/** `/w/:code` — shows the Wi-Fi network for a tag with a `wifi` action. */
export default function WifiPage() {
  const { code = '' } = useParams()
  const [show, setShow] = useState(false)
  const [copied, setCopied] = useState(false)
  const { data, error, isLoading } = useQuery({
    queryKey: ['public', 'wifi', code],
    queryFn: () => publicApi.wifi(code),
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
  })
  useEffect(() => {
    document.title = data ? `Wi-Fi · ${data.ssid}` : 'Wi-Fi'
  }, [data])
  if (isLoading) return <PublicSkeleton />
  if (error || !data) {
    const r = UNAVAILABLE_REASONS[(error instanceof ApiError && (error.details as { reason?: string } | null)?.reason) || '']
    return <Unavailable title={r?.title} body={r?.body} />
  }

  async function copy() {
    if (!data?.password) return
    try {
      await navigator.clipboard.writeText(data.password)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setShow(true)
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center bg-bg px-4 py-10">
      <div className="w-full max-w-sm">
        {data.business && (
          <p className="mb-6 flex items-center justify-center gap-1.5 text-sm font-medium text-muted">
            {data.business.logo_url && <img src={data.business.logo_url} alt="" className="h-6 w-6 rounded-md object-cover" />}
            {data.business.name}
            {data.business.verified && <BadgeCheck className="h-4 w-4 text-accent" aria-label="Verified business" />}
          </p>
        )}
        <div className="rounded-3xl border border-border bg-surface p-6 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <Wifi className="h-7 w-7" />
          </div>
          <p className="mt-4 text-sm text-muted">Wi-Fi network</p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight break-words">{data.ssid}</h1>
          {data.hidden && <p className="mt-1 text-xs text-subtle">Hidden network — add it manually by name.</p>}

          {data.password && data.security !== 'nopass' ? (
            <div className="mt-5 space-y-2 text-left">
              <p className="text-xs font-medium text-subtle">Password</p>
              <div className="flex items-center gap-1 rounded-xl border border-border-strong bg-surface-2 py-1.5 pr-1.5 pl-3">
                <code className="min-w-0 flex-1 truncate font-mono text-[15px]" translate="no">
                  {show ? data.password : '•'.repeat(Math.min(16, data.password.length))}
                </code>
                <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-3">
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <button
                type="button"
                onClick={copy}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent-solid text-[15px] font-semibold text-accent-fg shadow-sm hover:bg-accent-solid-hover"
              >
                {copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                {copied ? 'Password copied' : 'Copy password'}
              </button>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted">This is an open network — no password needed.</p>
          )}

          <div className="mt-6 flex flex-col items-center gap-2 border-t border-border pt-5">
            <QrCode value={data.wifi_qr || wifiPayload(data.ssid, data.password, data.security, data.hidden)} size={180} label={`QR code to join the ${data.ssid} Wi-Fi network`} />
            <p className="max-w-[240px] text-xs text-subtle">On another phone, scan this with the camera to join automatically.</p>
          </div>
        </div>
        <p className="mt-8 text-center"><PoweredBy /></p>
      </div>
    </main>
  )
}

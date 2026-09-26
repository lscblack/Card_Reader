import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Clock, Handshake, LogIn, RefreshCw, Smartphone } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Spinner'
import { QrCode } from '@/components/QrCode'
import { DownloadAppCard } from '@/components/DownloadApp'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useNow } from '@/hooks/useNow'
import { cn } from '@/lib/cn'
import { UrlQrPanel } from '@/business/components/inputs'
import { BizErrorState, FormError } from '@/business/components/BizError'
import type { LoginCode } from '../api/types'
import { cardsApi, sessionsApi } from '../api/personal'
import { usePCards } from '../hooks/queries'

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function ExchangeQr({ cardId }: { cardId: string }) {
  const now = useNow(1000)
  const q = useQuery({ queryKey: ['personal', 'exchange-qr', cardId], queryFn: () => cardsApi.exchangeQr(cardId), gcTime: 0, staleTime: 9 * 60_000 })
  const left = q.data ? new Date(q.data.expires_at).getTime() - now : 0
  return (
    <Card>
      <CardHeader title="Exchange QR" description="For phones without NFC: they scan this in the NFC Terminal app and you both get each other’s card." />
      <CardBody className="flex flex-col items-center gap-3">
        {q.error ? (
          <BizErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <Skeleton className="h-[220px] w-[220px]" />
        ) : left <= 0 ? (
          <div className="flex h-[220px] flex-col items-center justify-center gap-3 text-center">
            <Clock className="h-7 w-7 text-subtle" />
            <p className="text-[13px] text-muted">This code expired.</p>
            <Button size="sm" leftIcon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => q.refetch()}>
              New code
            </Button>
          </div>
        ) : (
          <>
            <QrCode value={q.data.qr_payload} size={220} label="Exchange QR code" />
            <p className={cn('inline-flex items-center gap-1.5 text-[13px] tabular-nums', left < 60_000 ? 'text-amber-600 dark:text-amber-400' : 'text-muted')}>
              <Clock className="h-3.5 w-3.5" /> Expires in {mmss(left)}
            </p>
          </>
        )}
      </CardBody>
    </Card>
  )
}

function PhoneLogin() {
  const now = useNow(1000)
  const [code, setCode] = useState<LoginCode | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const status = useQuery({
    queryKey: ['personal', 'login-code', code?.id],
    queryFn: () => sessionsApi.loginCode(code!.id),
    enabled: !!code,
    gcTime: 0,
    // Poll while pending; stop on an error or once the 5-minute code has expired.
    refetchInterval: (q) =>
      q.state.error || (code && Date.parse(code.expires_at) < Date.now()) ? false : !q.state.data || q.state.data.status === 'pending' ? 2000 : false,
  })
  const mounted = useRef(true)
  // Set on every mount: StrictMode mounts → unmounts → re-mounts in development, and a
  // cleanup-only effect would leave this false forever (the new code was silently dropped).
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  async function start() {
    setError(null)
    setCreating(true)
    try {
      const c = await sessionsApi.createLoginCode()
      if (mounted.current) setCode(c)
    } catch (e) {
      setError(e)
    } finally {
      setCreating(false)
    }
  }
  const left = code ? new Date(code.expires_at).getTime() - now : 0
  const st = status.data?.status ?? 'pending'
  const expired = st === 'expired' || (st === 'pending' && !!code && left <= 0)
  return (
    <Card>
      <CardHeader title="Sign in on your phone" description="Scan with the NFC Terminal app to sign it in as you — no password typing. The code works once, for 5 minutes." />
      <CardBody className="flex flex-col items-center gap-3 text-center">
        <FormError error={error} className="w-full" />
        {!code ? (
          <div className="flex h-[220px] flex-col items-center justify-center gap-3">
            <Smartphone className="h-8 w-8 text-subtle" />
            <Button variant="primary" leftIcon={<LogIn className="h-4 w-4" />} loading={creating} onClick={start}>
              Show sign-in QR
            </Button>
          </div>
        ) : st === 'used' ? (
          <div className="flex h-[220px] flex-col items-center justify-center gap-2" role="status">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
            <p className="text-base font-semibold">Signed in on {status.data?.session?.device_name ?? 'your phone'} ✓</p>
            <p className="text-[13px] text-muted">Your cards are now on the phone.</p>
            <Button size="sm" onClick={() => setCode(null)}>
              Done
            </Button>
          </div>
        ) : expired ? (
          <div className="flex h-[220px] flex-col items-center justify-center gap-3">
            <Clock className="h-7 w-7 text-subtle" />
            <p className="text-[13px] text-muted">The code expired.</p>
            <Button size="sm" leftIcon={<RefreshCw className="h-3.5 w-3.5" />} loading={creating} onClick={start}>
              New code
            </Button>
          </div>
        ) : (
          <>
            <QrCode value={code.qr_payload} size={220} label="QR code to sign in on your phone" />
            <p className="inline-flex items-center gap-2 text-[13px] text-muted" aria-live="polite">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
              </span>
              Waiting for your phone… <span className="tabular-nums">{mmss(left)}</span>
            </p>
          </>
        )}
      </CardBody>
    </Card>
  )
}

export default function SharePage() {
  useDocumentTitle('Share')
  const cards = usePCards()
  const [picked, setPicked] = useState('')
  const card = cards.data?.find((c) => c.id === picked) ?? cards.data?.find((c) => c.is_primary) ?? cards.data?.[0]
  return (
    <>
      <PageHeader
        title="Share"
        description="Your phone shares your primary card over NFC. These are the other ways."
        actions={
          (cards.data?.length ?? 0) > 1 && (
            <Select aria-label="Card" value={card?.id ?? ''} onChange={(e) => setPicked(e.target.value)} className="sm:w-56">
              {cards.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                  {c.is_primary ? ' (primary)' : ''}
                </option>
              ))}
            </Select>
          )
        }
      />
      {cards.error ? (
        <Card>
          <BizErrorState error={cards.error} onRetry={() => cards.refetch()} />
        </Card>
      ) : !card ? (
        <Skeleton className="h-72" />
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Public link & QR"
              description={card.share_settings.web_page_enabled ? 'Anyone can open it — no app needed. Print it, add it to your email signature or LinkedIn.' : 'Your public web page is turned off for this card.'}
              actions={
                <Link to={`/me/cards/${card.id}`} className="text-[13px] font-medium text-accent hover:underline">
                  Sharing settings
                </Link>
              }
            />
            <CardBody>
              <UrlQrPanel url={`${card.public_url}?via=qr`} label={card.label} filename={`${card.slug}-qr`} qrSize={160} hint="The QR adds ?via=qr so you can see how people found you in Activity." />
            </CardBody>
          </Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <ExchangeQr key={card.id} cardId={card.id} />
            <PhoneLogin />
          </div>
          <Card>
            <CardBody className="flex items-start gap-3 text-[13px] text-muted">
              <Handshake className="mt-0.5 h-5 w-5 shrink-0 text-subtle" />
              <p>
                <span className="font-medium text-fg">Tap to exchange.</span> Open the app, choose <em>Share</em> and hold your phone near theirs. With automatic exchange on, you both get each other’s card. iPhones without the
                app open your public page instead.
              </p>
            </CardBody>
          </Card>
          <DownloadAppCard />
        </div>
      )}
    </>
  )
}

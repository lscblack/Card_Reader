import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ChevronDown, Clock, QrCode as QrIcon, RefreshCw, ScanLine, Smartphone } from 'lucide-react'
import { applicationsApi, pairingApi } from '@/api/applications'
import { errorMessage } from '@/api/client'
import type { PairingCodeCreated } from '@/api/types'
import { useApplications } from '@/hooks/queries'
import { useNow } from '@/hooks/useNow'
import { cn } from '@/lib/cn'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { Field, Input } from './ui/Input'
import { ErrorAlert } from '@/components/ui/ErrorMeta'
import { Alert } from './ui/Alert'
import { CopyButton } from './ui/CopyButton'
import { AppSelect } from './AppSelect'
import { QrCode } from './QrCode'
import { DownloadAppInline } from './DownloadApp'

function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function ManualEntry({ serverUrl, code }: { serverUrl: string; code: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-[13px] font-medium text-muted hover:text-fg"
      >
        Can&apos;t scan? Enter manually
        <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-border px-3 py-3">
          <p className="text-xs text-subtle">In nexTap choose manual setup and enter both values. The code works once.</p>
          {[
            ['Server URL', serverUrl],
            ['Pairing code', code],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="mb-1 text-xs font-medium">{label}</p>
              <div className="flex items-center gap-1 rounded-lg border border-border-strong bg-surface-2 py-1 pr-1 pl-3">
                <code className="min-w-0 flex-1 overflow-x-auto py-1 text-[12.5px] whitespace-nowrap select-all" translate="no">
                  {value}
                </code>
                <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} showLabel />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * QR pairing (contract §7.3). The plaintext pairing code lives only in this component's state and is
 * dropped on close; a still-pending code is cancelled server-side when the dialog closes.
 */
interface PairPhoneProps {
  open: boolean
  onClose: () => void
  /** When given, the application is fixed (e.g. from the app detail page). */
  applicationId?: string
}

/** Mounted only while open, so timers/polling stop and a pending code is cancelled on unmount. */
export function PairPhoneModal(props: PairPhoneProps) {
  return props.open ? <PairPhoneDialog {...props} /> : null
}

/** A prominent "Pair a phone" button that opens the pairing dialog. */
export function PairPhoneButton({
  applicationId,
  size = 'md',
  variant = 'primary',
  disabled,
}: {
  applicationId?: string
  size?: 'sm' | 'md'
  variant?: 'primary' | 'secondary'
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant={variant} size={size} leftIcon={<QrIcon className="h-4 w-4" />} onClick={() => setOpen(true)} disabled={disabled}>
        Pair a phone
      </Button>
      <PairPhoneModal open={open} onClose={() => setOpen(false)} applicationId={applicationId} />
    </>
  )
}

function PairPhoneDialog({ open, onClose, applicationId }: PairPhoneProps) {
  const qc = useQueryClient()
  const apps = useApplications()
  const [appId, setAppId] = useState(applicationId ?? '')
  const [deviceName, setDeviceName] = useState('')
  const [created, setCreated] = useState<PairingCodeCreated | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const now = useNow(1000)
  const effectiveAppId = applicationId ?? (appId || (apps.data?.find((a) => a.is_active) ?? apps.data?.[0])?.id || '')
  const appName = apps.data?.find((a) => a.id === effectiveAppId)?.name

  const status = useQuery({
    queryKey: ['pairing', created?.id],
    queryFn: () => pairingApi.get(created!.id),
    enabled: !!created,
    gcTime: 0,
    refetchInterval: (q) => (!q.state.data || q.state.data.status === 'pending' ? 2000 : false),
    refetchIntervalInBackground: true,
  })

  const remaining = created ? new Date(created.expires_at).getTime() - now : 0
  const state = status.data?.status ?? 'pending'
  const expired = state === 'expired' || (state === 'pending' && created != null && remaining <= 0)
  const used = state === 'used'

  // Track the pending code so it can be cancelled when the dialog closes/unmounts.
  const pendingId = useRef<string | null>(null)
  useEffect(() => {
    pendingId.current = created && !used && !expired ? created.id : null
  }, [created, used, expired])
  useEffect(
    () => () => {
      if (pendingId.current) void pairingApi.cancel(pendingId.current).catch(() => undefined)
    },
    [],
  )

  // Refresh device lists once the phone has redeemed the code.
  useEffect(() => {
    if (used) {
      void qc.invalidateQueries({ queryKey: ['devices'] })
      void qc.invalidateQueries({ queryKey: ['applications'] })
      void qc.invalidateQueries({ queryKey: ['overview'] })
    }
  }, [used, qc])

  async function generate(e?: FormEvent) {
    e?.preventDefault()
    if (!effectiveAppId) return
    setError(null)
    setCreating(true)
    try {
      setCreated(await applicationsApi.createPairingCode(effectiveAppId, deviceName.trim() ? { device_name: deviceName.trim() } : {}))
    } catch (err) {
      setError(err)
    } finally {
      setCreating(false)
    }
  }

  function close() {
    if (pendingId.current) void pairingApi.cancel(pendingId.current).catch(() => undefined)
    pendingId.current = null
    setCreated(null)
    setError(null)
    setDeviceName('')
    onClose()
  }

  const device = status.data?.device

  return (
    <Modal
      open={open}
      onClose={close}
      title={
        <span className="flex items-center gap-2">
          <QrIcon className="h-4.5 w-4.5 text-accent" /> Pair a phone
        </span>
      }
      description={appName && created ? `Registers a new NFC reader for “${appName}”.` : 'Register an Android phone as an NFC reader by scanning a QR code — no API key typing.'}
      size="md"
      footer={
        created ? (
          <Button variant={used ? 'primary' : 'secondary'} onClick={close}>
            {used ? 'Done' : 'Cancel'}
          </Button>
        ) : (
          <>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" type="submit" form="pair-form" loading={creating} disabled={!effectiveAppId}>
              Generate QR code
            </Button>
          </>
        )
      }
    >
      {!created ? (
        <form id="pair-form" onSubmit={generate} className="space-y-4" noValidate>
          {error != null && <ErrorAlert error={error} />}
          {!applicationId && (
            <Field label="Application">
              {(p) => <AppSelect id={p.id} value={effectiveAppId} onChange={setAppId} className="sm:w-full" />}
            </Field>
          )}
          <Field label="Device name" optional hint="Preset on the phone when it pairs, e.g. “Front desk Pixel”.">
            {(p) => <Input {...p} value={deviceName} onChange={(e) => setDeviceName(e.target.value)} maxLength={100} data-autofocus />}
          </Field>
          <p className="text-xs text-subtle">The code is single-use and expires after 10 minutes. It counts toward your device limit only when used.</p>
          <DownloadAppInline />
        </form>
      ) : used ? (
        <div className="flex flex-col items-center py-6 text-center" role="status">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <p className="mt-3 text-base font-semibold">Paired ✓</p>
          {device ? (
            <p className="mt-1 flex items-center gap-1.5 text-[13px] text-muted">
              <Smartphone className="h-4 w-4" />
              <span className="font-medium text-fg">{device.name}</span>
              {device.model && <span>· {device.model}</span>}
            </p>
          ) : (
            <p className="mt-1 text-[13px] text-muted">The phone is registered.</p>
          )}
          <p className="mt-3 max-w-xs text-xs text-subtle">Tap a card on the phone — the event will show up under NFC Events.</p>
        </div>
      ) : expired ? (
        <div className="flex flex-col items-center py-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-2 text-subtle">
            <Clock className="h-7 w-7" />
          </div>
          <p className="mt-3 text-base font-semibold">This code has expired</p>
          <p className="mt-1 text-[13px] text-muted">Pairing codes are valid for 10 minutes and can be used once.</p>
          {error != null && <Alert tone="danger" className="mt-3">{errorMessage(error)}</Alert>}
          <Button className="mt-4" variant="primary" leftIcon={<RefreshCw className="h-4 w-4" />} loading={creating} onClick={() => generate()}>
            Generate new code
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-3">
            <QrCode value={created.qr_payload} size={260} label="Pairing QR code — scan it with the nexTap app" />
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[13px]">
              <span className={cn('inline-flex items-center gap-1.5 font-medium tabular-nums', remaining < 60_000 ? 'text-amber-600 dark:text-amber-400' : 'text-muted')}>
                <Clock className="h-3.5 w-3.5" /> Expires in {formatRemaining(remaining)}
              </span>
              <span className="inline-flex items-center gap-1.5 text-subtle" aria-live="polite">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
                </span>
                Waiting for the phone…
              </span>
            </div>
          </div>
          <ol className="space-y-1.5 rounded-lg bg-surface-2 p-3 text-[13px] text-muted">
            <li className="flex gap-2">
              <span className="font-semibold text-fg">1.</span>
              <span>
                Open <span className="font-medium text-fg">nexTap</span> on the Android phone.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-fg">2.</span>
              <span>
                Tap <span className="inline-flex items-center gap-1 font-medium text-fg"><ScanLine className="h-3.5 w-3.5" />Scan QR code</span> and point the camera at this code.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-fg">3.</span>
              <span className="min-w-0">
                Check the server shown on the phone matches <code className="font-mono text-[12px] break-all text-fg">{created.server_url}</code>.
              </span>
            </li>
          </ol>
          <ManualEntry serverUrl={created.server_url} code={created.code} />
          <DownloadAppInline />
        </div>
      )}
    </Modal>
  )
}

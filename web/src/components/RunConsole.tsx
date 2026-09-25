import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
  BellOff,
  ChevronRight,
  Download,
  Eraser,
  Link2,
  Pause,
  Play,
  Radio,
  ShieldAlert,
  ShieldCheck,
  Terminal,
} from 'lucide-react'
import type { Application, LiveDeliveryAttempt, SandboxEndpoint } from '@/api/types'
import { errorDocsUrl } from '@/api/client'
import { useApplications } from '@/hooks/queries'
import { useSandboxMutations } from '@/hooks/useConsole'
import { useLiveRun, type LiveStatus, type LiveTap } from '@/hooks/useLiveRun'
import { cn } from '@/lib/cn'
import { Button } from './ui/Button'
import { CopyButton } from './ui/CopyButton'
import { Select } from './ui/Input'
import { useToast } from './ui/toastContext'

const statusLabel: Record<LiveStatus, string> = {
  idle: 'stopped',
  connecting: 'connecting…',
  live: 'live',
  reconnecting: 'reconnecting…',
  polling: 'live (polling)',
  error: 'error',
}

function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sine'
    o.frequency.setValueAtTime(880, ctx.currentTime)
    o.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.08)
    g.gain.setValueAtTime(0.0001, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18)
    o.connect(g).connect(ctx.destination)
    o.start()
    o.stop(ctx.currentTime + 0.2)
    o.onended = () => void ctx.close()
  } catch {
    /* audio blocked */
  }
}

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })

function statusTone(code: number | null, success: boolean) {
  if (success) return 'text-emerald-400'
  if (code != null && code >= 400 && code < 500) return 'text-amber-300'
  return 'text-red-400'
}

function Attempt({ a }: { a: LiveDeliveryAttempt }) {
  const [showPayload, setShowPayload] = useState(false)
  const payload = a.request_payload != null ? JSON.stringify(a.request_payload, null, 2) : null
  const ctype = a.response_headers?.['content-type']
  return (
    <div className="space-y-1.5 border-l border-white/10 pl-3">
      <p className="flex flex-wrap items-center gap-x-2 text-zinc-300">
        <ArrowUpRight className="h-3.5 w-3.5 text-zinc-500" />
        <span className="font-semibold text-zinc-100">POST</span>
        <span className="min-w-0 break-all text-zinc-400">{a.url}</span>
        <span className="text-zinc-500">
          ({a.mode}, attempt {a.attempt})
        </span>
      </p>
      {payload && (
        <div>
          <button className="inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-100" onClick={() => setShowPayload((v) => !v)} aria-expanded={showPayload}>
            <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', showPayload && 'rotate-90')} /> request payload
          </button>
          {showPayload && (
            <div className="relative mt-1 rounded-md bg-black/40 p-2">
              <CopyButton value={payload} label="Copy payload" className="absolute top-1 right-1 text-zinc-400 hover:bg-white/10 hover:text-white" />
              <pre className="max-h-64 overflow-auto pr-8 text-[11.5px] leading-relaxed text-zinc-300">{payload}</pre>
            </div>
          )}
        </div>
      )}
      <p className="flex flex-wrap items-center gap-x-2">
        <ArrowDownLeft className="h-3.5 w-3.5 text-zinc-500" />
        <span className={cn('font-semibold', statusTone(a.status_code, a.success))}>{a.status_code ?? 'no response'}</span>
        {a.latency_ms != null && <span className="text-zinc-400">{a.latency_ms} ms</span>}
        {ctype && <span className="text-zinc-500">{ctype}</span>}
        {a.success ? <span className="text-emerald-400">✓ delivered</span> : <span className="text-red-400">✗ failed</span>}
      </p>
      {a.error_code && (
        <p className="flex flex-wrap items-center gap-2 text-red-300">
          <span>{a.error_code}</span>
          {a.error_ref && (
            <a href={errorDocsUrl(a.error_ref)} target="_blank" rel="noreferrer" className="rounded border border-red-400/40 px-1 hover:bg-red-400/10">
              {a.error_ref} ↗
            </a>
          )}
        </p>
      )}
      {a.response_excerpt && <pre className="max-h-28 overflow-auto rounded-md bg-black/30 p-2 text-[11.5px] whitespace-pre-wrap text-zinc-400">{a.response_excerpt}</pre>}
    </div>
  )
}

function TapBlock({ t, fresh }: { t: LiveTap; fresh: boolean }) {
  const r = t.received
  const card = r?.card_id ?? t.business?.card_id
  return (
    <div className={cn('rounded-lg border px-3 py-3 transition-colors duration-700', fresh ? 'border-red-400/60 bg-red-500/10' : 'border-white/10 bg-white/[0.02]')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-zinc-500">[{time(r?.detected_at ?? t.at)}]</span>
        <span className="text-[11px] font-semibold tracking-wider text-zinc-400 uppercase">card</span>
        {card && (
          <span className="inline-flex items-center gap-1">
            <span className="text-lg font-semibold tracking-wider text-white sm:text-xl">{card}</span>
            <CopyButton value={card} label="Copy card ID" className="text-zinc-400 hover:bg-white/10 hover:text-white" />
          </span>
        )}
        <span className="rounded bg-amber-400/15 px-1 text-[11px] font-medium text-amber-200">UID only</span>
      </div>
      <p className="mt-1 text-zinc-400">
        {r ? (
          <>
            {r.device_name} · {r.card_type ?? 'unknown type'} · {r.card_technologies.join(', ') || '—'} · {r.delivery_mode}
          </>
        ) : t.business ? (
          <>
            {t.business.card_name}
            {t.business.assignee_name ? ` · ${t.business.assignee_name}` : ''} · {t.business.result}
            {t.business.action_type ? ` → ${t.business.action_type}` : ''}
          </>
        ) : null}
      </p>
      {t.attempts.length > 0 && (
        <div className="mt-3 space-y-3">
          {t.attempts.map((a) => (
            <Attempt key={a.attempt} a={a} />
          ))}
        </div>
      )}
      {t.sandbox.map((s) => (
        <p key={s.request_id} className="mt-2 flex flex-wrap items-center gap-2 pl-3">
          {s.signature_status === 'valid' ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> : <ShieldAlert className="h-3.5 w-3.5 text-amber-300" />}
          <span className={s.signature_status === 'valid' ? 'text-emerald-400' : 'text-amber-300'}>signature {s.signature_status}</span>
          <span className={s.checks_failed ? 'text-red-400' : 'text-zinc-400'}>
            {s.checks_failed ? `${s.checks_failed} failed check${s.checks_failed === 1 ? '' : 's'}` : 'all checks passed'}
          </span>
          <Link to={`/dashboard/sandbox?endpoint=${s.endpoint_id}`} className="text-zinc-400 underline-offset-2 hover:text-white hover:underline">
            inspect →
          </Link>
        </p>
      ))}
      {r && !t.attempts.length && !t.business && <p className="mt-2 animate-pulse pl-3 text-zinc-500">delivering…</p>}
    </div>
  )
}

/**
 * "Run" console (Part 3 §8): the live debugging view of card taps and their deliveries.
 * `fixedAppId` locks the application (app detail "Live" tab); `sandbox` enables one-click connect.
 */
export function RunConsole({ fixedAppId, sandbox, className }: { fixedAppId?: string; sandbox?: SandboxEndpoint; className?: string }) {
  const apps = useApplications()
  const toast = useToast()
  const { useFor } = useSandboxMutations()
  const [picked, setPicked] = useState('')
  const [running, setRunning] = useState(false)
  const [sound, setSound] = useState(false)
  const [freshKey, setFreshKey] = useState<string | null>(null)
  const appId = fixedAppId ?? (picked || apps.data?.find((a) => sandbox && a.endpoint.url === sandbox.url)?.id || apps.data?.[0]?.id || '')
  const app: Application | undefined = apps.data?.find((a) => a.id === appId)
  const soundRef = useRef(sound)
  useEffect(() => {
    soundRef.current = sound
  })

  const { taps, status, problem, clear } = useLiveRun(appId || null, running, (t) => {
    setFreshKey(t.key)
    if (soundRef.current) beep()
  })
  useEffect(() => {
    if (!freshKey) return
    const t = setTimeout(() => setFreshKey(null), 1600)
    return () => clearTimeout(t)
  }, [freshKey])

  const connected = !sandbox || (app && app.endpoint.url === sandbox.url)
  const exportJson = useMemo(
    () => () => {
      const blob = new Blob([JSON.stringify({ application_id: appId, exported_at: new Date().toISOString(), taps }, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `nfc-run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    },
    [appId, taps],
  )

  return (
    <div className={cn('overflow-hidden rounded-xl border border-border bg-surface shadow-xs', className)} data-tour="run-console">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-5">
        <div className="mr-auto flex min-w-0 items-center gap-2">
          <Terminal className="h-4 w-4 text-accent" />
          <p className="text-[15px] font-semibold tracking-tight">Run</p>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
              status === 'live' || status === 'polling' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : status === 'idle' ? 'bg-surface-2 text-subtle' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
            )}
            aria-live="polite"
          >
            {(status === 'live' || status === 'polling') && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />}
            {statusLabel[status]}
          </span>
        </div>
        {!fixedAppId && (
          <Select aria-label="Application" value={appId} onChange={(e) => setPicked(e.target.value)} className="h-8 w-full text-[13px] sm:w-52" disabled={running}>
            {!apps.data?.length && <option value="">No applications</option>}
            {apps.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        )}
        {sandbox && app && !connected && (
          <Button
            size="sm"
            leftIcon={<Link2 className="h-3.5 w-3.5" />}
            loading={useFor.isPending}
            onClick={async () => {
              try {
                await useFor.mutateAsync({ id: sandbox.id, appId: app.id })
                toast.success(`“${app.name}” now delivers to this sandbox.`)
              } catch (e) {
                toast.fromError(e)
              }
            }}
            data-tour="sandbox-connect"
          >
            Connect app to sandbox
          </Button>
        )}
        <Button size="icon-sm" variant="ghost" onClick={() => setSound((v) => !v)} aria-pressed={sound} aria-label={sound ? 'Mute tap sound' : 'Play a sound on each tap'} title="Sound on tap">
          {sound ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={clear} disabled={!taps.length} aria-label="Clear" title="Clear">
          <Eraser className="h-4 w-4" />
        </Button>
        <Button size="icon-sm" variant="ghost" onClick={exportJson} disabled={!taps.length} aria-label="Export as JSON" title="Export JSON">
          <Download className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant={running ? 'secondary' : 'primary'}
          leftIcon={running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          onClick={() => setRunning((v) => !v)}
          disabled={!appId}
        >
          {running ? 'Pause' : 'Run'}
        </Button>
      </div>

      <div className="max-h-[560px] min-h-[260px] overflow-y-auto bg-code-bg px-4 py-4 font-mono text-[12.5px] leading-relaxed text-zinc-200 sm:px-5" role="log" aria-live="polite" aria-label="Live taps">
        <p className="text-zinc-500">
          $ nfc run --app &quot;{app?.name ?? '…'}&quot;
          {app?.endpoint.url ? ` → ${app.endpoint.url}` : ''}
        </p>
        {!running ? (
          <p className="mt-3 text-zinc-400">
            Press <span className="font-semibold text-white">Run</span>, then tap a card on a phone registered to this application. Every tap, the exact payload we send and your endpoint’s answer will
            appear here.
          </p>
        ) : (
          <p className="mt-3 flex items-center gap-2 text-zinc-300">
            <Radio className="h-3.5 w-3.5 animate-pulse text-red-400" /> Waiting for a card tap… tap a card on your registered phone
          </p>
        )}
        {problem != null && status !== 'idle' && (
          <p className="mt-2 text-amber-300">
            {problem instanceof Error ? problem.message : 'Connection problem'} — {status === 'error' ? 'stopped' : 'retrying automatically'}
          </p>
        )}
        {sandbox && app && !connected && <p className="mt-2 text-amber-300">“{app.name}” delivers elsewhere — connect it to this sandbox to see verdicts here.</p>}
        <div className="mt-4 space-y-3">
          {taps.map((t) => (
            <TapBlock key={t.key} t={t} fresh={t.key === freshKey} />
          ))}
        </div>
      </div>
    </div>
  )
}

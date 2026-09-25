import { CheckCircle2, Server, Smartphone } from 'lucide-react'
import type { DeliveryMode } from '@/api/types'
import { cn } from '@/lib/cn'

const modes: {
  value: DeliveryMode
  title: string
  tag?: string
  icon: typeof Server
  summary: string
  pros: string[]
  cons: string[]
}[] = [
  {
    value: 'relay',
    title: 'Relay',
    tag: 'Recommended',
    icon: Server,
    summary: 'Phone → Platform → your endpoint',
    pros: [
      'Webhook secret never leaves our servers',
      'Server-side retries with backoff (10s, 60s, 300s…)',
      'Full delivery log + redeliver from the dashboard',
      'Custom headers applied server-side',
    ],
    cons: ['One extra network hop (slightly higher latency)'],
  },
  {
    value: 'direct',
    title: 'Direct',
    icon: Smartphone,
    summary: 'Phone → your endpoint (reports outcome to us)',
    pros: ['Lowest latency', 'Works when your endpoint is only reachable from the phone’s network (e.g. LAN)'],
    cons: [
      'Phone holds a per-device signing key (derived; master secret stays server-side)',
      'Retries happen on the phone only',
      'Custom headers are sent to the device',
    ],
  },
]

export function DeliveryModePicker({
  value,
  onChange,
  compact = false,
  disabled,
}: {
  value: DeliveryMode
  onChange: (m: DeliveryMode) => void
  compact?: boolean
  disabled?: boolean
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Delivery mode">
      {modes.map((m) => {
        const active = value === m.value
        return (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(m.value)}
            className={cn(
              'rounded-xl border p-3.5 text-left transition-colors disabled:opacity-60',
              active ? 'border-accent bg-accent-soft/60 ring-1 ring-accent' : 'border-border hover:border-border-strong hover:bg-surface-2/50',
            )}
          >
            <div className="flex items-center gap-2">
              <m.icon className={cn('h-4 w-4', active ? 'text-accent' : 'text-subtle')} />
              <span className="text-[13.5px] font-semibold">{m.title}</span>
              {m.tag && <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-accent">{m.tag}</span>}
              <CheckCircle2 className={cn('ml-auto h-4 w-4', active ? 'text-accent' : 'text-transparent')} aria-hidden="true" />
            </div>
            <p className="mt-1 text-xs text-muted">{m.summary}</p>
            {!compact && (
              <div className="mt-3 space-y-2 text-xs">
                <ul className="space-y-1">
                  {m.pros.map((p) => (
                    <li key={p} className="flex gap-1.5 text-muted">
                      <span className="text-emerald-500">+</span>
                      {p}
                    </li>
                  ))}
                </ul>
                <ul className="space-y-1">
                  {m.cons.map((p) => (
                    <li key={p} className="flex gap-1.5 text-muted">
                      <span className="text-amber-500">−</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}

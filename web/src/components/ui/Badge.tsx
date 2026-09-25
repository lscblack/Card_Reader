import type { ReactNode } from 'react'
import { ScanLine } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { EventStatus } from '@/api/types'

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'

const tones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted ring-border-strong',
  accent: 'bg-accent-soft text-accent ring-accent/25',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-400/20',
  warning: 'bg-amber-50 text-amber-800 ring-amber-600/25 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20',
  danger: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-400/20',
  info: 'bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/20',
}

const dots: Record<Tone, string> = {
  neutral: 'bg-zinc-400',
  accent: 'bg-accent-solid',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  info: 'bg-sky-500',
}

export function Badge({
  tone = 'neutral',
  dot,
  children,
  className,
  title,
}: {
  tone?: Tone
  dot?: boolean
  children: ReactNode
  className?: string
  title?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        tones[tone],
        className,
      )}
    >
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', dots[tone])} />}
      {children}
    </span>
  )
}

const statusTone: Record<EventStatus, Tone> = {
  delivered: 'success',
  pending: 'neutral',
  retrying: 'warning',
  failed: 'danger',
}

export function EventStatusBadge({ status }: { status: EventStatus }) {
  return (
    <Badge tone={statusTone[status] ?? 'neutral'} dot>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  )
}

/**
 * Every card event today is "card detected": the UID was read, but the card was NOT
 * cryptographically authenticated. This badge makes that explicit wherever events appear.
 */
export function UidOnlyBadge({ authenticated = false }: { authenticated?: boolean }) {
  if (authenticated) return <Badge tone="success">Authenticated</Badge>
  return (
    <Badge
      tone="warning"
      className="gap-1"
      title="Card detected — UID only. The card was not cryptographically authenticated; a UID can be cloned. Do not treat it as proof of identity."
    >
      <ScanLine className="h-3 w-3" aria-hidden="true" />
      UID only
    </Badge>
  )
}

export function ActiveBadge({ active, activeLabel = 'Active', inactiveLabel = 'Inactive' }: { active: boolean; activeLabel?: string; inactiveLabel?: string }) {
  return (
    <Badge tone={active ? 'success' : 'neutral'} dot>
      {active ? activeLabel : inactiveLabel}
    </Badge>
  )
}

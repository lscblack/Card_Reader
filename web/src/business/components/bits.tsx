import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus, Nfc, Radio, Search, Smartphone, Sparkles, Tag, X, Zap, type LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Spinner'
import { cn } from '@/lib/cn'
import { safeImageUrl } from '@/lib/url'
import { num, percent } from '@/lib/format'
import type { BusinessRole, CardKind, EffectiveStatus, TapResult, TapSource } from '../api/types'
import { EFFECTIVE_STATUS, TAP_RESULT, initials } from '../lib/format'
import { ROLE_LABELS } from '../lib/permissions'
import { ACTION_ICONS } from '../lib/actionMeta'

export function Avatar({ name, src: rawSrc, size = 32, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const src = safeImageUrl(rawSrc)
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) }
  if (src) {
    return <img src={src} alt="" style={style} className={cn('shrink-0 rounded-full object-cover ring-1 ring-border', className)} />
  }
  return (
    <span
      style={style}
      aria-hidden="true"
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent', className)}
    >
      {initials(name)}
    </span>
  )
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className,
  label = 'Search',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  label?: string
}) {
  return (
    <div className={cn('relative min-w-0', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-subtle" />
      <input
        type="search"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-lg border border-border-strong bg-surface pr-8 pl-8 text-sm shadow-xs placeholder:text-subtle focus:border-accent focus:ring-3 focus:ring-accent/20 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute top-1/2 right-1.5 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-subtle hover:bg-surface-2 hover:text-fg"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

/** A compact <select> used in filter bars. */
export function FilterSelect<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  label: string
  className?: string
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={cn(
        'h-9 min-w-0 rounded-lg border border-border-strong bg-surface pr-8 pl-3 text-sm shadow-xs focus:border-accent focus:ring-3 focus:ring-accent/20 focus:outline-none',
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function CardStatusBadge({ status }: { status: EffectiveStatus }) {
  const m = EFFECTIVE_STATUS[status] ?? EFFECTIVE_STATUS.inactive
  return (
    <Badge tone={m.tone} dot title={m.hint}>
      {m.label}
    </Badge>
  )
}

export function TapResultBadge({ result }: { result: TapResult }) {
  const m = TAP_RESULT[result] ?? { label: result, tone: 'neutral' as const }
  return <Badge tone={m.tone}>{m.label}</Badge>
}

export function TapSourceBadge({ source }: { source: TapSource }) {
  return source === 'reader' ? (
    <Badge tone="accent" className="gap-1" title="Read by one of your nexTap devices">
      <Radio className="h-3 w-3" aria-hidden="true" /> Reader
    </Badge>
  ) : (
    <Badge tone="info" className="gap-1" title="A customer’s phone opened the card link">
      <Smartphone className="h-3 w-3" aria-hidden="true" /> Web
    </Badge>
  )
}

export function KindBadge({ kind }: { kind: CardKind }) {
  const Icon = kind === 'tag' ? Tag : Nfc
  return (
    <Badge className="gap-1">
      <Icon className="h-3 w-3" aria-hidden="true" /> {kind === 'tag' ? 'Tag' : 'Card'}
    </Badge>
  )
}

export function RoleBadge({ role }: { role: BusinessRole }) {
  return <Badge tone={role === 'owner' ? 'accent' : role === 'admin' ? 'info' : 'neutral'}>{ROLE_LABELS[role] ?? role}</Badge>
}

export function Delta({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value == null) return <span className="text-xs text-subtle">no prior data</span>
  const up = value > 0.0005
  const down = value < -0.0005
  const good = invert ? down : up
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-medium tabular-nums',
        !up && !down ? 'text-subtle' : good ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {percent(Math.abs(value), 0)}
      <span className="sr-only">{up ? 'increase' : down ? 'decrease' : 'no change'} vs previous period</span>
    </span>
  )
}

export function KpiCard({
  label,
  value,
  icon: Icon,
  hint,
  delta,
  loading,
  className,
}: {
  label: string
  value: ReactNode
  icon?: LucideIcon
  hint?: ReactNode
  delta?: number | null
  loading?: boolean
  className?: string
}) {
  return (
    <div className={cn('min-w-0 rounded-xl border border-border bg-surface p-4 shadow-xs', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[12.5px] font-medium text-muted">{label}</p>
        {Icon && <Icon className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />}
      </div>
      {loading ? (
        <Skeleton className="mt-2.5 h-7 w-20" />
      ) : (
        <p className="mt-1.5 truncate text-2xl font-semibold tracking-tight tabular-nums">{typeof value === 'number' ? num(value) : value}</p>
      )}
      <div className="mt-1 flex min-h-4 items-center gap-2">
        {delta !== undefined && !loading && <Delta value={delta} />}
        {hint && <p className="truncate text-xs text-subtle">{hint}</p>}
      </div>
    </div>
  )
}

export function DetailRow({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-center sm:gap-4', className)}>
      <dt className="shrink-0 text-[12.5px] text-subtle sm:w-36">{label}</dt>
      <dd className="min-w-0 text-[13.5px]">{children}</dd>
    </div>
  )
}

export function PageSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <div className="grid gap-3 pt-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-72 w-full" />
    </div>
  )
}

/** Filter bar container: wraps on small screens, never causes horizontal page scroll. */
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:px-5', className)}>{children}</div>
}

/** Icon for an action type (`null` = business default). */
export function ActionIcon({ type, className }: { type: string | null | undefined; className?: string }) {
  const Icon = type == null ? Sparkles : (ACTION_ICONS[type] ?? Zap)
  return <Icon className={className} aria-hidden="true" />
}

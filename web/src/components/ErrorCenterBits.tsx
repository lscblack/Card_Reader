import { TrendingDown, TrendingUp } from 'lucide-react'
import type { AdminErrorEntry } from '@/api/types'
import { cn } from '@/lib/cn'
import { Badge, type Tone } from './ui/Badge'

const sourceTone: Record<AdminErrorEntry['source'], Tone> = { api: 'accent', delivery: 'warning', mobile: 'info' }

export function SourceBadge({ source }: { source: AdminErrorEntry['source'] }) {
  return <Badge tone={sourceTone[source] ?? 'neutral'}>{source}</Badge>
}

/** Change vs the previous period (red = more errors). */
export function Delta({ now, prev }: { now: number; prev: number }) {
  if (!now && !prev) return null
  if (!prev) return <span className="text-xs text-red-600 dark:text-red-400">new</span>
  const pct = Math.round(((now - prev) / prev) * 100)
  if (pct === 0) return <span className="text-xs text-subtle">±0%</span>
  const up = pct > 0
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs', up ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')}>
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? '+' : ''}
      {pct}%
    </span>
  )
}

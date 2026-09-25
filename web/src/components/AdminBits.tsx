import { Pause, Play } from 'lucide-react'
import type { AdminRange } from '@/api/types'
import { cn } from '@/lib/cn'
import { Button } from './ui/Button'

export function LiveToggle({ live, onChange, label = 'Auto-refresh' }: { live: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <Button
      variant={live ? 'primary' : 'secondary'}
      leftIcon={live ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      onClick={() => onChange(!live)}
      aria-pressed={live}
    >
      {live ? 'Live' : label}
    </Button>
  )
}

const RANGES: { value: AdminRange; label: string }[] = [
  { value: '1h', label: '1h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
]

export function RangePicker({ value, onChange }: { value: AdminRange; onChange: (r: AdminRange) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5" role="radiogroup" aria-label="Time range">
      {RANGES.map((r) => (
        <button
          key={r.value}
          role="radio"
          aria-checked={value === r.value}
          onClick={() => onChange(r.value)}
          className={cn(
            'h-8 rounded-md px-3 text-[13px] font-medium transition-colors',
            value === r.value ? 'bg-surface text-fg shadow-xs ring-1 ring-border' : 'text-muted hover:text-fg',
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}

/** Horizontal two-part meter (e.g. online vs offline, succeeded vs failed). */
export function SplitMeter({
  a,
  b,
  aLabel,
  bLabel,
  aColor = 'var(--chart-2)',
  bColor = 'var(--chart-1)',
}: {
  a: number
  b: number
  aLabel: string
  bLabel: string
  aColor?: string
  bColor?: string
}) {
  const total = a + b
  const pa = total ? (a / total) * 100 : 0
  return (
    <div>
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-surface-3" role="img" aria-label={`${aLabel} ${a}, ${bLabel} ${b}`}>
        {total > 0 && a > 0 && <div className="h-full rounded-full" style={{ width: `${pa}%`, background: aColor }} />}
        {total > 0 && b > 0 && <div className="h-full flex-1 rounded-full" style={{ background: bColor }} />}
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: aColor }} /> {aLabel}{' '}
          <span className="font-medium text-fg tabular-nums">{a.toLocaleString()}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: bColor }} /> {bLabel}{' '}
          <span className="font-medium text-fg tabular-nums">{b.toLocaleString()}</span>
        </span>
      </div>
    </div>
  )
}

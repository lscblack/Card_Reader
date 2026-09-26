import { useState } from 'react'
import { Check, Sparkles } from 'lucide-react'
import { Skeleton } from '@/components/ui/Spinner'
import { cn } from '@/lib/cn'
import { isV2, type CardTemplate, type RenderableCard } from '../api/types'
import { useTemplates } from '../hooks/queries'
import { CardThumb } from './DigitalCardRender'
import { BizErrorState } from '@/business/components/BizError'
import { SAMPLE_FIELDS } from '../lib/sample'


type Cat = 'business' | 'badge' | 'minimal' | 'classic'
const CATS: { value: Cat; label: string }[] = [
  { value: 'business', label: 'Business' },
  { value: 'badge', label: 'ID badge' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'classic', label: 'Classic' },
]
const catOf = (t: CardTemplate): Cat => (isV2(t) ? t.category : 'classic')

/**
 * Template gallery with category tabs and live thumbnails rendered with the user's own details (or a sample) and each
 * template's default design.
 */
export function TemplateGallery({
  value,
  onPick,
  sample,
  disabled,
  columns = 'grid-cols-2 sm:grid-cols-3',
  only,
  qrValue = 'https://nexventures.net',
}: {
  value?: string | null
  onPick: (t: CardTemplate) => void
  sample?: Pick<RenderableCard, 'fields' | 'photo_url' | 'cover_url' | 'logo_url' | 'business'>
  disabled?: boolean
  columns?: string
  /** Restrict to these categories (e.g. ['badge'] for business-issued badges). */
  only?: Cat[]
  qrValue?: string
}) {
  const { data, error, isLoading, refetch } = useTemplates()
  const cats = CATS.filter((c) => !only || only.includes(c.value)).filter((c) => (data ?? []).some((t) => catOf(t) === c.value))
  const current = value ? data?.find((t) => t.id === value) : null
  const [cat, setCat] = useState<Cat | null>(null)
  const active: Cat = cat ?? (current ? catOf(current) : (cats[0]?.value ?? 'business'))
  if (error) return <BizErrorState error={error} onRetry={() => refetch()} />
  if (isLoading) {
    return (
      <div className={cn('grid gap-3', columns)}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-40 rounded-xl" />
        ))}
      </div>
    )
  }
  const fields = sample?.fields?.full_name ? { ...SAMPLE_FIELDS, ...stripEmpty(sample.fields) } : SAMPLE_FIELDS
  const list = (data ?? []).filter((t) => catOf(t) === active)
  return (
    <div className="space-y-3">
      {cats.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Template category">
          {cats.map((c) => (
            <button
              key={c.value}
              type="button"
              role="tab"
              aria-selected={active === c.value}
              onClick={() => setCat(c.value)}
              className={cn('h-8 rounded-full border px-3 text-[13px] font-medium transition-colors', active === c.value ? 'border-accent bg-accent-soft text-accent' : 'border-border text-muted hover:text-fg')}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      <div className={cn('grid gap-3', columns)} role="radiogroup" aria-label="Card template">
        {list.map((t) => {
          const selected = value === t.id
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onPick(t)}
              className={cn(
                'group relative flex flex-col overflow-hidden rounded-xl border bg-surface-2/40 p-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                selected ? 'border-accent ring-2 ring-accent/30' : 'border-border hover:border-border-strong',
              )}
            >
              <div className="pointer-events-none flex min-h-[120px] items-center justify-center overflow-hidden rounded-lg p-1">
                <CardThumb
                  template={t}
                  maxHeight={isV2(t) && t.format === 'portrait' ? 210 : 190}
                  card={{ design: t.default_design, fields, photo_url: sample?.photo_url, cover_url: sample?.cover_url, logo_url: sample?.logo_url, business: sample?.business }}
                  audience="all"
                  qrValue={qrValue}
                  className="w-full"
                />
              </div>
              <span className="mt-2 flex min-w-0 items-center gap-1.5 px-0.5">
                <span className="min-w-0 truncate text-[13px] font-medium">{t.name}</span>
                {isV2(t) && t.sides.includes('back') && <span className="shrink-0 rounded bg-surface-3 px-1 text-[10.5px] font-medium whitespace-nowrap text-muted">2-sided</span>}
                {t.premium && (
                  <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1 text-[10.5px] font-semibold text-amber-700 dark:text-amber-400">
                    <Sparkles className="h-2.5 w-2.5" /> Pro
                  </span>
                )}
              </span>
              <span className="line-clamp-2 px-0.5 text-[11.5px] text-subtle">{t.description}</span>
              {selected && (
                <span className="absolute top-3 right-3 flex h-6 w-6 items-center justify-center rounded-full bg-accent-solid text-accent-fg shadow">
                  <Check className="h-3.5 w-3.5" />
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function stripEmpty<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0))) as Partial<T>
}

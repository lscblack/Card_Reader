import { Check, Sparkles } from 'lucide-react'
import { Skeleton } from '@/components/ui/Spinner'
import { cn } from '@/lib/cn'
import type { CardTemplate, RenderableCard } from '../api/types'
import { useTemplates } from '../hooks/queries'
import { CardThumb } from './DigitalCardRender'
import { BizErrorState } from '@/business/components/BizError'

const SAMPLE: RenderableCard['fields'] = {
  full_name: 'Alex Morgan',
  headline: 'Design lead',
  job_title: 'Design Lead',
  company: 'Northwind',
  phones: [{ label: 'Mobile', value: '+14155550123' }],
  emails: [{ label: 'Work', value: 'alex@northwind.example' }],
  websites: [{ label: 'Website', url: 'https://northwind.example' }],
  socials: [{ platform: 'linkedin', url: 'https://linkedin.com/in/alex' }],
  custom_links: [],
}

/** Live template thumbnails, rendered with the user's own details (or a sample) and each template's default design. */
export function TemplateGallery({
  value,
  onPick,
  sample,
  disabled,
  columns = 'grid-cols-2 sm:grid-cols-3',
}: {
  value?: string | null
  onPick: (t: CardTemplate) => void
  sample?: Pick<RenderableCard, 'fields' | 'photo_url' | 'cover_url' | 'logo_url'>
  disabled?: boolean
  columns?: string
}) {
  const { data, error, isLoading, refetch } = useTemplates()
  if (error) return <BizErrorState error={error} onRetry={() => refetch()} />
  if (isLoading) {
    return (
      <div className={cn('grid gap-3', columns)}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-48 rounded-xl" />
        ))}
      </div>
    )
  }
  return (
    <div className={cn('grid gap-3', columns)} role="radiogroup" aria-label="Card template">
      {data?.map((t) => {
        const active = value === t.id
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onPick(t)}
            className={cn(
              'group relative flex flex-col overflow-hidden rounded-xl border bg-surface-2/40 p-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
              active ? 'border-accent ring-2 ring-accent/30' : 'border-border hover:border-border-strong',
            )}
          >
            <div className="pointer-events-none overflow-hidden rounded-lg">
              <CardThumb
                layout={t.layout}
                maxHeight={190}
                card={{ design: t.default_design, fields: sample?.fields?.full_name ? sample.fields : SAMPLE, photo_url: sample?.photo_url, cover_url: sample?.cover_url, logo_url: sample?.logo_url }}
                audience="all"
                qrValue="https://nexventures.net"
              />
            </div>
            <span className="mt-2 flex items-center gap-1.5 px-0.5">
              <span className="text-[13px] font-medium">{t.name}</span>
              {t.premium && (
                <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1 text-[10.5px] font-semibold text-amber-700 dark:text-amber-400">
                  <Sparkles className="h-2.5 w-2.5" /> Pro
                </span>
              )}
            </span>
            <span className="line-clamp-2 px-0.5 text-[11.5px] text-subtle">{t.description}</span>
            {active && (
              <span className="absolute top-3 right-3 flex h-6 w-6 items-center justify-center rounded-full bg-accent-solid text-accent-fg shadow">
                <Check className="h-3.5 w-3.5" />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

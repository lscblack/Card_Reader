import { useMemo, useState, type ReactNode } from 'react'
import { Check, Plus } from 'lucide-react'
import { Tabs } from '@/components/ui/Tabs'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Spinner'
import { cn } from '@/lib/cn'
import { PageView } from '@/public/page/PageView'
import type { PageTemplate, ProfileType } from '../../api/types'
import { useBusiness } from '../../hooks/context'
import { useCategories, usePageTemplates } from '../../hooks/queries'
import { PAGE_TYPE_META, PAGE_TYPES, previewBusiness, templateFor, type CreatablePageType } from '../../lib/pages'
import { BizErrorState } from '../BizError'

const THUMB_W = 188
const RENDER_W = 390
const SCALE = THUMB_W / RENDER_W

/** A live, scaled-down render of a template with the business's name, logo and details applied. */
export function TemplateThumb({ template, height = 250, dark }: { template: PageTemplate; height?: number; dark?: boolean }) {
  const { business } = useBusiness()
  const categories = useCategories()
  const cat = categories.data?.find((c) => c.code === business.category)?.label ?? null
  const filled = useMemo(() => templateFor(template, business), [template, business])
  return (
    <div className="relative overflow-hidden rounded-lg bg-surface-2 ring-1 ring-border" style={{ width: THUMB_W, height }} aria-hidden="true">
      <div className="pointer-events-none absolute top-0 left-0 origin-top-left select-none" style={{ width: RENDER_W, height: height / SCALE, transform: `scale(${SCALE})` }} inert>
        <PageView preview business={previewBusiness(business, cat)} profile={{ type: template.page_type, title: template.name, theme: filled.theme, sections: filled.sections }} scheme={dark ? 'dark' : 'light'} profileSlug={`tpl-${template.id}`} />
      </div>
    </div>
  )
}

function Card({ selected, onClick, children, label }: { selected: boolean; onClick: () => void; children: ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={label}
      className={cn(
        'group relative flex w-[204px] shrink-0 flex-col gap-2 rounded-xl border p-2 text-left transition-[border-color,box-shadow]',
        selected ? 'border-accent shadow-[0_0_0_3px_var(--color-accent-soft)]' : 'border-border hover:border-border-strong hover:shadow-sm',
      )}
    >
      {children}
      {selected && (
        <span className="absolute top-3.5 right-3.5 flex h-6 w-6 items-center justify-center rounded-full bg-accent-solid text-accent-fg shadow">
          <Check className="h-3.5 w-3.5" />
        </span>
      )}
    </button>
  )
}

type Tab = 'all' | 'mine' | CreatablePageType

/**
 * Page template picker (Part 6 §2): system + "My templates", filtered by page type, with live thumbnails.
 * `pageType` locks the type (e.g. when creating a page for an action). `onBlank` adds a "Blank page" card.
 */
export function TemplateGallery({
  pageType,
  selectedId,
  onPick,
  onBlank,
  blankSelected,
}: {
  pageType?: ProfileType | null
  selectedId?: string | null
  onPick: (t: PageTemplate) => void
  onBlank?: () => void
  blankSelected?: boolean
}) {
  const { business } = useBusiness()
  const q = usePageTemplates(business.id, pageType ?? undefined)
  const [tab, setTab] = useState<Tab>('all')
  const [dark, setDark] = useState(false)
  const all = q.data ?? []
  const mine = all.filter((t) => t.scope === 'business')
  const types = PAGE_TYPES.filter((t) => all.some((x) => x.page_type === t))
  const list = tab === 'all' ? all : tab === 'mine' ? mine : all.filter((t) => t.page_type === tab)
  const sorted = [...list].sort((a, b) => (a.scope === b.scope ? 0 : a.scope === 'business' ? -1 : 1))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'all', label: 'All', count: all.length },
            ...(pageType ? [] : types.map((t) => ({ value: t as Tab, label: PAGE_TYPE_META[t].plural }))),
            { value: 'mine', label: 'My templates', count: mine.length },
          ]}
        />
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} className="accent-[var(--color-accent-solid)]" /> Dark previews
        </label>
      </div>
      {q.error ? (
        <BizErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <div className="flex flex-wrap gap-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[300px] w-[204px] rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap justify-center gap-3 sm:justify-start">
          {onBlank && tab !== 'mine' && (
            <Card selected={!!blankSelected} onClick={onBlank} label="Blank page">
              <div className="flex h-[250px] w-[188px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong text-muted">
                <Plus className="h-6 w-6" />
                <span className="text-[13px] font-medium">Blank page</span>
              </div>
              <span className="px-1 text-[13px] font-semibold">Start from scratch</span>
            </Card>
          )}
          {sorted.map((t) => (
            <Card key={t.id} selected={selectedId === t.id} onClick={() => onPick(t)} label={`Template ${t.name}`}>
              <TemplateThumb template={t} dark={dark} />
              <span className="flex min-w-0 items-center gap-1.5 px-1">
                <span className="truncate text-[13px] font-semibold">{t.name}</span>
                {t.scope === 'business' && <Badge tone="accent">Mine</Badge>}
              </span>
              <span className="line-clamp-2 min-h-[2.4em] px-1 text-xs text-subtle">{t.description || PAGE_TYPE_META[t.page_type as CreatablePageType]?.hint}</span>
            </Card>
          ))}
          {!sorted.length && (
            <EmptyState
              className="w-full"
              title={tab === 'mine' ? 'No templates of your own yet' : 'No templates'}
              description={tab === 'mine' ? 'Open any page and choose “Save as template” to reuse its layout, theme and content — e.g. for every branch.' : 'Try another page type.'}
            />
          )}
        </div>
      )}
    </div>
  )
}

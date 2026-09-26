import type { CardTemplateV2 } from '../api/types'
import { useV2Templates } from '../hooks/queries'
import { SAMPLE_FIELDS } from '../lib/sample'
import { CardThumb } from './DigitalCardRender'

export function TemplateSlide({ t }: { t: CardTemplateV2 }) {
  return (
    <CardThumb
      template={t}
      card={{ design: t.default_design, fields: SAMPLE_FIELDS, arrangement: t.default_arrangement, sides_enabled: ['front'] }}
      audience="all"
      qrValue="https://nexventures.net"
    />
  )
}

/** Grid of v2 templates (docs). */
export function TemplateShowcaseGrid({ limit = 8 }: { limit?: number }) {
  const list = useV2Templates().slice(0, limit)
  if (!list.length) return null
  return (
    <div className="my-6 grid grid-cols-2 items-end gap-5 sm:grid-cols-4">
      {list.map((t) => (
        <figure key={t.id} className="min-w-0">
          <div className={t.format === 'portrait' ? 'mx-auto w-[62%]' : undefined}>
            <TemplateSlide t={t} />
          </div>
          <figcaption className="mt-2 text-center text-[12.5px] text-subtle">
            {t.name} · <span className="capitalize">{t.category === 'badge' ? 'ID badge' : t.category}</span>
          </figcaption>
        </figure>
      ))}
    </div>
  )
}

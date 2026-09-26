import { useSearchParams } from 'react-router'
import { isV2 } from '../api/types'
import { useTemplates } from '../hooks/queries'
import { SAMPLE_FIELDS } from '../lib/sample'
import { DigitalCardRender } from '../components/DigitalCardRender'

/** DEV-only review sheet for v2 templates (front + back, light + dark page). `?id=` filters, `?size=` sets width. */
export default function DevTemplatesPage() {
  const [params] = useSearchParams()
  const { data } = useTemplates()
  const id = params.get('id')
  const size = Number(params.get('size')) || 520
  const dark = params.get('dark') === '1'
  const list = (data ?? []).filter(isV2).filter((t) => !id || t.id === id)
  return (
    <div className={dark ? 'dark' : ''}>
      <main className="min-h-screen space-y-10 bg-bg p-8 text-fg">
        {list.map((t) => (
          <section key={t.id} data-template={t.id}>
            <h2 className="mb-3 font-mono text-sm">
              {t.id} · {t.category} · {t.format}
            </h2>
            <div className="flex flex-wrap items-start gap-8">
              {t.sides.map((side) => (
                <div key={side} style={{ width: t.format === 'portrait' ? size * 0.62 : size }}>
                  <DigitalCardRender template={t} side={side} card={{ design: t.default_design, fields: SAMPLE_FIELDS, arrangement: t.default_arrangement, sides_enabled: t.sides }} audience="all" qrValue="https://nexventures.net/p/alex-morgan" />
                  <p className="mt-1 text-xs text-subtle">{side}</p>
                </div>
              ))}
              <div style={{ width: t.format === 'portrait' ? 120 : 200 }}>
                <DigitalCardRender template={t} card={{ design: t.default_design, fields: SAMPLE_FIELDS, arrangement: t.default_arrangement }} audience="all" qrValue="https://nexventures.net/p/alex-morgan" />
                <p className="mt-1 text-xs text-subtle">thumb</p>
              </div>
            </div>
          </section>
        ))}
      </main>
    </div>
  )
}

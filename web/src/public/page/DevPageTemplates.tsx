import { useSearchParams } from 'react-router'
import type { PageTemplate } from '@/business/api/types'
import raw from '@/business/data/page_templates.json?raw'
import { fillPlaceholders } from './format'
import { PageView } from './PageView'

const TEMPLATES = (JSON.parse(raw) as { templates: PageTemplate[] }).templates
const SAMPLE = { name: 'Acme Café', phone: '+250 788 123 456', email: 'hello@acme-cafe.example', website: 'https://acme-cafe.example', address: 'KN 4 Ave 12, Kigali' }

/** Dev-only: `/dev/page-templates?id=…&dark=1` renders one system page template (screenshots / visual QA). */
export default function DevPageTemplates() {
  const [p] = useSearchParams()
  const t = TEMPLATES.find((x) => x.id === p.get('id'))
  if (!t)
    return (
      <ul style={{ padding: 24 }}>
        {TEMPLATES.map((x) => (
          <li key={x.id}>
            <a href={`?id=${x.id}`}>{x.name}</a>
          </li>
        ))}
      </ul>
    )
  const filled = fillPlaceholders({ theme: t.theme, sections: t.sections }, SAMPLE)
  return (
    <PageView
      business={{ name: SAMPLE.name, slug: 'acme-cafe', logo_url: null, verified: true, category: 'Café', accent: '#b91c1c' }}
      profile={{ type: t.page_type, title: p.get('title') ?? t.name, theme: filled.theme, sections: filled.sections }}
      profileSlug={t.id}
      preview={p.get('preview') === '1'}
      scheme={p.get('dark') === '1' ? 'dark' : p.get('dark') === '0' ? 'light' : undefined}
    />
  )
}

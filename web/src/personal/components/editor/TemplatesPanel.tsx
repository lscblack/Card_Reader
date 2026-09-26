import { Alert } from '@/components/ui/Alert'
import { isV2 } from '../../api/types'
import { mapArrangement } from '../../lib/v2'
import { renderableOf } from '../../lib/card'
import { TemplateGallery } from '../TemplateGallery'
import type { PanelProps } from './doc'

export function TemplatesPanel({ doc, set, card }: PanelProps) {
  const lockedTpl = !!card.business_link?.template_locked
  const r = renderableOf(card)
  return (
    <div className="space-y-3">
      {lockedTpl && <Alert tone="info">Your company sets the template for this card.</Alert>}
      <p className="text-xs text-subtle">Previews use your own details. Switching keeps everything you’ve entered and moves blocks to matching places.</p>
      <TemplateGallery
        value={doc.template_id}
        disabled={lockedTpl}
        columns="grid-cols-2"
        qrValue={card.public_url}
        sample={{ fields: doc.fields, photo_url: r.photo_url, cover_url: r.cover_url, logo_url: r.logo_url, business: r.business }}
        onPick={(t) =>
          set((d) => ({
            ...d,
            template_id: t.id,
            design: { ...t.default_design, decor_style: null },
            arrangement: isV2(t) ? mapArrangement(d.arrangement, t) : null,
            sides_enabled: isV2(t) ? [...t.sides] : ['front'],
          }))
        }
      />
    </div>
  )
}

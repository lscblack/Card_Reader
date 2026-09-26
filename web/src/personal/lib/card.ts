import type { CardLayout, CardTemplate, DigitalCard, RenderableCard } from '../api/types'

export function templateFor(templateId: string | null | undefined, templates: CardTemplate[] | undefined): CardTemplate | null {
  return templates?.find((t) => t.id === templateId) ?? null
}

export function layoutFor(templateId: string | null | undefined, templates: CardTemplate[] | undefined, fallback: CardLayout = 'centered'): CardLayout {
  const t = templateFor(templateId, templates)
  return (t && 'layout' in t ? t.layout : undefined) ?? fallback
}

export function renderableOf(c: DigitalCard): RenderableCard {
  return {
    design: c.design,
    fields: c.fields,
    photo_url: c.photo_url,
    cover_url: c.cover_url,
    logo_url: c.logo_url,
    public_url: c.public_url,
    visibility: c.visibility,
    arrangement: c.arrangement ?? null,
    sides_enabled: c.sides_enabled ?? null,
    business: c.business_link ? { name: c.business_link.business_name, logo_url: c.business_link.business_logo_url ?? null, verified: true } : null,
  }
}

export const SOURCE_LABELS: Record<string, string> = {
  nfc_exchange: 'NFC exchange',
  qr_exchange: 'QR exchange',
  web_lead: 'Web lead',
  manual: 'Added manually',
  nfc: 'NFC tap',
  qr: 'QR code',
  link: 'Link',
}

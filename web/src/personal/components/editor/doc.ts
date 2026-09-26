import type { Arrangement, CardDesign, CardFields, CardInput, CardTemplate, CardTemplateV2, DigitalCard, ShareSettings, SideId, Visibility, VisibilityKey } from '../../api/types'
import { DEFAULT_VISIBILITY } from '../../lib/design'

/** The editable part of a card (what autosave diffs and PATCHes). */
export interface EditorDoc {
  label: string
  slug: string
  template_id: string
  design: CardDesign
  fields: CardFields
  visibility: Partial<Record<VisibilityKey, Visibility>>
  share_settings: ShareSettings
  arrangement: Arrangement | null
  sides_enabled: SideId[]
}

export function docFromCard(c: DigitalCard): EditorDoc {
  return {
    label: c.label,
    slug: c.slug,
    template_id: c.template_id,
    design: { ...c.design },
    fields: structuredClone(c.fields),
    visibility: { ...DEFAULT_VISIBILITY, ...c.visibility },
    share_settings: { ...c.share_settings },
    arrangement: c.arrangement ? structuredClone(c.arrangement) : null,
    sides_enabled: c.sides_enabled ?? ['front'],
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Minimal PATCH body: only changed parts. Locked fields are never sent, and design/template only when they changed
 * (business template-locked cards reject any design payload).
 */
export function diffPatch(doc: EditorDoc, base: EditorDoc, locked: (k: string) => boolean): CardInput | null {
  const p: CardInput = {}
  if (doc.label !== base.label) p.label = doc.label.trim() || base.label
  if (doc.slug !== base.slug) p.slug = doc.slug
  if (doc.template_id !== base.template_id) p.template_id = doc.template_id
  if (!same(doc.design, base.design) || p.template_id) p.design = doc.design
  const fields = Object.fromEntries(Object.entries(doc.fields).filter(([k, v]) => !locked(k) && !same(v, (base.fields as unknown as Record<string, unknown>)[k])))
  if (Object.keys(fields).length) p.fields = fields as Partial<CardFields>
  if (!same(doc.visibility, base.visibility)) p.visibility = doc.visibility
  if (!same(doc.share_settings, base.share_settings)) p.share_settings = doc.share_settings
  if (!same(doc.arrangement, base.arrangement) || p.template_id) p.arrangement = doc.arrangement
  if (!same(doc.sides_enabled, base.sides_enabled)) p.sides_enabled = doc.sides_enabled
  return Object.keys(p).length ? p : null
}

export interface PanelProps {
  doc: EditorDoc
  set: (fn: (d: EditorDoc) => EditorDoc, coalesceKey?: string) => void
  card: DigitalCard
  template: CardTemplate | null
  v2: CardTemplateV2 | null
  locked: (k: string) => boolean
}

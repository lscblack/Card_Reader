/** Personal accounts & digital cards — docs/PART4_CONTRACT.md §1, §2, §4, §6 (snake_case = wire format). */
import type { ISODateTime, UUID } from '@/api/types'

export type { Paginated } from '@/api/types'

export type CardLayout = 'centered' | 'left' | 'split' | 'hero_photo' | 'banner' | 'compact'
export type BackgroundStyle = 'solid' | 'gradient' | 'glass' | 'pattern'
/** v1 font keys; v2 also accepts a font-pair id from `/personal/design-presets` (unknown ids fall back to sans). */
export type CardFont = 'sans' | 'serif' | 'mono' | 'display'
export type Visibility = 'public' | 'contacts' | 'hidden'

export interface CardDesign {
  primary: string
  background: string
  text: string
  accent: string
  background_style: BackgroundStyle
  pattern: string | null
  font: CardFont
  corner_radius: number
  show_qr: boolean
  // ── Part 5 (design v2) additions ──
  secondary?: string
  photo_shape?: PhotoShape
  photo_ring?: boolean
  icon_style?: IconStyle
  decor_style?: string | null
  background_image_opacity?: number
}

export type PhotoShape = 'circle' | 'rounded' | 'square' | 'hexagon'
export type IconStyle = 'filled' | 'outline' | 'none'

export interface LabeledValue {
  label: string
  value: string
}
export interface LabeledUrl {
  label: string
  url: string
}
export interface SocialLinkP {
  platform: string
  url: string
}

export interface CardFields {
  full_name: string
  pronouns?: string | null
  headline?: string | null
  job_title?: string | null
  company?: string | null
  department?: string | null
  bio?: string | null
  phones: LabeledValue[]
  emails: LabeledValue[]
  websites: LabeledUrl[]
  address?: string | null
  socials: SocialLinkP[]
  custom_links: LabeledUrl[]
  // ── Part 5 badge fields ──
  id_number?: string | null
  valid_from?: string | null
  valid_until?: string | null
  barcode_value?: string | null
}

/** Field keys that carry a visibility setting (`photo` included). */
export type VisibilityKey = keyof CardFields | 'photo'

export interface ShareSettings {
  auto_exchange: boolean
  web_page_enabled: boolean
  lead_capture_enabled: boolean
  nfc_sharing_enabled: boolean
}

export interface BusinessLink {
  business_id: UUID
  business_name: string
  employee_id: UUID
  locked_fields: string[]
  template_locked: boolean
  status: string
  business_logo_url?: string | null
}

export interface CardStats {
  views: number
  nfc_taps: number
  exchanges: number
  leads: number
}

export interface DigitalCard {
  id: UUID
  share_id: UUID
  label: string
  is_primary: boolean
  status: 'active' | 'inactive'
  slug: string
  public_url: string
  template_id: string
  design: CardDesign
  photo_url: string | null
  cover_url: string | null
  logo_url: string | null
  fields: CardFields
  visibility: Partial<Record<VisibilityKey, Visibility>>
  share_settings: ShareSettings
  business_link: BusinessLink | null
  /** Part 5: 2 when the template is a v2 (shape) template. */
  design_version?: 1 | 2
  sides_enabled?: SideId[]
  arrangement?: Arrangement | null
  stats: CardStats
  created_at: ISODateTime
  updated_at: ISODateTime
}

export interface CardInput {
  label?: string
  template_id?: string
  design?: Partial<CardDesign>
  fields?: Partial<CardFields>
  visibility?: Partial<Record<VisibilityKey, Visibility>>
  share_settings?: Partial<ShareSettings>
  slug?: string
  status?: 'active' | 'inactive'
  sides_enabled?: SideId[]
  arrangement?: Arrangement | null
}

/** v1 (layout) template. */
export interface CardTemplateV1 {
  id: string
  engine?: 'v1'
  name: string
  description: string
  layout: CardLayout
  default_design: CardDesign
  supports: { photo: boolean; cover: boolean; logo: boolean }
  premium: boolean
  category?: string
}

// ── Part 5 v2 (shape) templates ──
export type BlockId = 'photo' | 'name' | 'logo' | 'company' | 'tagline' | 'qr' | 'contacts' | 'socials' | 'website' | 'address' | 'bio' | 'badge_meta' | 'barcode'
export type SideId = 'front' | 'back'
export type Arrangement = Partial<Record<SideId, Record<string, BlockId[]>>>

export interface TemplateLayer {
  path: string
  fill: string
  opacity?: number
}

export interface TemplateZone {
  id: string
  rect: [number, number, number, number]
  align: 'start' | 'center' | 'end'
  valign: 'start' | 'center' | 'end'
  on: string
  accepts: BlockId[]
  max_blocks: number
}

export interface TemplateSide {
  background: string
  layers: TemplateLayer[]
  zones: TemplateZone[]
}

export interface TemplateVariant {
  id: string
  name: string
  canvas: Partial<Record<SideId, { layers: TemplateLayer[] }>>
}

export interface CardTemplateV2 {
  id: string
  engine: 'v2'
  name: string
  category: 'business' | 'badge' | 'minimal'
  description: string
  premium: boolean
  format: 'landscape' | 'portrait'
  sides: SideId[]
  default_design: CardDesign
  canvas: Partial<Record<SideId, TemplateSide>>
  default_arrangement: Arrangement
  variants?: TemplateVariant[]
}

export type CardTemplate = CardTemplateV1 | CardTemplateV2

export const isV2 = (t: CardTemplate | null | undefined): t is CardTemplateV2 => !!t && t.engine === 'v2'

export interface DesignPresets {
  palettes: { id: string; name: string; primary: string; secondary: string; background: string; text: string; accent: string }[]
  font_pairs: { id: string; heading: string; body: string; style: string; name?: string }[]
}

/** What a renderer needs (a full card, a public card or a contact snapshot). */
export interface RenderableCard {
  design: CardDesign
  fields: Partial<CardFields> & { full_name: string }
  photo_url?: string | null
  cover_url?: string | null
  logo_url?: string | null
  public_url?: string | null
  business?: { name: string; logo_url: string | null; verified: boolean } | null
  visibility?: Partial<Record<VisibilityKey, Visibility>>
  arrangement?: Arrangement | null
  sides_enabled?: SideId[] | null
}

export interface PublicCardResponse {
  card: {
    design: CardDesign
    template: { id: string; layout?: CardLayout; name?: string; engine?: string } | string
    arrangement?: Arrangement | null
    sides_enabled?: SideId[] | null
    fields: Partial<CardFields> & { full_name: string }
    photo_url: string | null
    cover_url: string | null
    logo_url: string | null
    public_url?: string | null
    business: { name: string; logo_url: string | null; verified: boolean } | null
  }
  lead_capture_enabled: boolean
  vcard_url: string
}

export interface LeadInput {
  full_name: string
  email?: string
  phone?: string
  company?: string
  message?: string
  /** Honeypot — must stay empty. */
  website: string
}

export type ContactSource = 'nfc_exchange' | 'qr_exchange' | 'web_lead' | 'manual'

export interface Contact {
  id: UUID
  source: ContactSource
  counterpart_user_id: UUID | null
  counterpart_card_id: UUID | null
  /** Exchanged cards carry the full snapshot; manual and web-lead contacts only have `{ fields }` (no design/template). */
  card: Omit<RenderableCard, 'design'> & { design?: CardDesign | null; template_id?: string | null; layout?: CardLayout | null }
  live: boolean
  notes: string | null
  tags: string[]
  favorite: boolean
  met_at: ISODateTime | null
  created_at: ISODateTime
  updated_at: ISODateTime
}

export interface ContactFilters {
  q?: string
  tag?: string
  source?: ContactSource | ''
  favorite?: boolean
  page?: number
  page_size?: number
}

export interface ActivityItem {
  id: UUID
  type: 'view' | 'nfc_tap' | 'exchange' | 'lead' | 'terminal_read' | string
  card_id: UUID | null
  card_label?: string | null
  source?: string | null
  /** Human-readable sentence from the server (e.g. "Jean received your card", "Read by a terminal of Acme"). */
  detail?: string | null
  counterpart_name?: string | null
  created_at: ISODateTime
}

export interface PersonalStats {
  totals: CardStats
  previous_totals?: CardStats | null
  timeline: { date: string; views: number; nfc_taps: number; exchanges: number; leads: number }[]
  by_source: { source: string; count: number }[]
}

export interface PersonalSession {
  id: UUID
  device_name: string
  platform: string
  model: string | null
  app_version: string | null
  created_at: ISODateTime
  last_seen_at: ISODateTime | null
  revoked_at: ISODateTime | null
  current?: boolean
}

export interface LoginCode {
  id: UUID
  code: string
  expires_at: ISODateTime
  qr_payload: string
}

export interface LoginCodeState {
  status: 'pending' | 'used' | 'expired'
  session: PersonalSession | null
}

export interface ExchangeQr {
  qr_payload: string
  expires_at: ISODateTime
}

/** `GET /personal/business-invites` item (backend `invite_out`). */
export interface BusinessInvite {
  id: UUID
  business: { id: UUID; name: string; logo_url: string | null; verified: boolean }
  email: string
  status: 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked'
  expires_at: ISODateTime | null
  created_at: ISODateTime
  /** The business-linked card once accepted. */
  card_id: UUID | null
}

/** A physical NFC card registered by the person: tapping it opens one of their digital cards. */
export interface PhysicalCard {
  id: string
  uid: string
  label: string | null
  digital_card_id: string
  digital_card_label: string | null
  taps: number
  last_tap_at: string | null
  created_at: string
}

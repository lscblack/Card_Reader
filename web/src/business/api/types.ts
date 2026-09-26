/**
 * Business-domain types mirroring docs/PART2_CONTRACT.md (section B). Snake_case = wire format.
 * Where the contract leaves a shape open, the chosen shape is documented inline.
 */
import type { Application, Device, ISODateTime, Plan, UUID } from '@/api/types'

export type { Paginated } from '@/api/types'

// ---------- Roles & permissions (B1) ----------

export type BusinessRole = 'owner' | 'admin' | 'manager' | 'staff'

export type Permission =
  | 'business.view'
  | 'cards.manage'
  | 'people.manage'
  | 'profiles.manage'
  | 'devices.manage'
  | 'analytics.view'
  | 'api.view'
  | 'api.manage'
  | 'team.manage'
  | 'settings.manage'
  | 'billing.manage'
  | 'business.delete'
  | 'ownership.transfer'

export interface BusinessMe {
  role: BusinessRole
  permissions: Permission[]
}

export interface Membership {
  business_id: UUID
  business_name: string
  business_slug: string
  role: BusinessRole
}

// ---------- Business (B2) ----------

export interface BusinessSettings {
  devices_can_register_cards: boolean
  default_card_action: Action | null
  timezone: string
}

/** `plan` is not fully specified by the contract: accept a plan code or a plan object. */
export type BusinessPlanRef = string | { code: string; name?: string; price_monthly_cents?: number; currency?: string } | null

export interface Business {
  id: UUID
  name: string
  slug: string
  email: string | null
  phone: string | null
  country: string | null
  category: string | null
  description: string | null
  website: string | null
  address: string | null
  logo_url: string | null
  status: 'active' | 'suspended'
  verified: boolean
  settings: BusinessSettings
  plan: BusinessPlanRef
  created_at: ISODateTime
  public_url?: string
  /** The caller's role (included by `GET /businesses` and `GET /businesses/{id}`). */
  role?: BusinessRole | null
}

export interface UpdateBusinessRequest {
  name?: string
  slug?: string
  email?: string
  phone?: string
  country?: string
  category?: string
  description?: string
  website?: string | null
  address?: string | null
  settings?: Partial<BusinessSettings>
}

export interface BusinessCategory {
  code: string
  label: string
}

// ---------- Cards (B4) ----------

export type CardKind = 'card' | 'tag'
export type CardStatus = 'active' | 'inactive'
export type EffectiveStatus = 'active' | 'inactive' | 'inactive_owner' | 'unassigned' | 'business_suspended'
export type AssigneeType = 'employee' | 'customer'

export interface Assignee {
  type: AssigneeType
  id: UUID
  name: string
  photo_url?: string | null
}

export interface CardSummary {
  id: UUID
  name: string
  kind: CardKind
  status: CardStatus
  effective_status: EffectiveStatus
  public_code?: string
  /** Not sent by the backend `CardSummary` today (kept optional for forward compatibility). */
  uid_masked?: string | null
  total_taps?: number
  last_tap_at?: ISODateTime | null
}

export interface Card {
  id: UUID
  business_id: UUID
  kind: CardKind
  name: string
  uid: string | null
  uid_masked: string | null
  public_code: string
  tap_url: string
  status: CardStatus
  effective_status: EffectiveStatus
  assignee: Assignee | null
  profile_id: UUID | null
  action: Action | null
  programmed: boolean
  programmed_at: ISODateTime | null
  total_taps: number
  unique_visitors: number
  last_tap_at: ISODateTime | null
  created_at: ISODateTime
}

export interface CardFilters {
  kind?: CardKind
  status?: CardStatus | ''
  assignee_type?: AssigneeType | 'none' | ''
  q?: string
  page?: number
  page_size?: number
}

export interface CreateCardRequest {
  kind: CardKind
  name: string
  uid?: string
  action?: Action | null
  profile_id?: UUID | null
}

export interface UpdateCardRequest {
  name?: string
  uid?: string | null
  action?: Action | null
  profile_id?: UUID | null
}

export interface BulkCreateCardsRequest {
  count: number
  kind: CardKind
  name_prefix: string
}

/** `GET …/cards/{cid}/history` (backend: `{ id, type, data, actor, created_at }`). */
export interface CardHistoryEntry {
  id: UUID
  /** created, assigned, unassigned, activated, deactivated, programmed, action_changed, uid_changed, deleted… */
  type: string
  data?: Record<string, unknown> | null
  /** Optional ready-made text (mock); otherwise derived from `type` + `data`. */
  description?: string
  actor: { type: 'user' | 'device' | 'system'; id: UUID | null; name: string | null } | null
  created_at: ISODateTime
}

export interface NamedCount {
  taps: number
}

export interface TimelinePoint {
  date: string
  taps: number
  unique_visitors: number
}

export interface CardStats {
  total_taps: number
  unique_visitors: number
  timeline: TimelinePoint[]
  by_source: ({ source: TapSource } & NamedCount)[]
  by_device_type: ({ device_type: DeviceType } & NamedCount)[]
  by_country: ({ country: string } & NamedCount)[]
}

// ---------- Actions (B5) ----------

export type ActionTypeCode =
  | 'website'
  | 'custom_url'
  | 'business_profile'
  | 'employee_profile'
  | 'profile'
  | 'share_contact'
  | 'whatsapp'
  | 'phone_call'
  | 'email'
  | 'maps'
  | 'social'
  | 'digital_menu'
  | 'product_info'
  | 'wifi'
  | 'developer_webhook'

export interface Action {
  type: ActionTypeCode | string
  config: Record<string, unknown>
  label?: string | null
}

export type ActionFieldType =
  | 'url'
  | 'phone'
  | 'email'
  | 'text'
  | 'textarea'
  | 'select'
  | 'number'
  | 'boolean'
  | 'password'
  | 'lat'
  | 'lng'
  | 'profile'
  | 'employee'
  | 'application'
  | 'action'
  | string

export interface ActionField {
  name: string
  type: ActionFieldType
  required: boolean
  label?: string
  help?: string | null
  placeholder?: string | null
  options?: (string | { value: string; label: string })[]
  default?: unknown
  /** Fields sharing a group: exactly one of them is required (e.g. maps query vs lat/lng). */
  one_of?: string | null
  /** For `profile` fields: restrict to these profile types. */
  profile_types?: ProfileType[] | null
}

export interface ActionTypeDef {
  type: ActionTypeCode | string
  label: string
  description: string
  fields: ActionField[]
}

export interface ActionPreview {
  resolved_url: string | null
  kind: 'redirect' | 'page' | 'vcard' | 'webhook'
  /** Optional human explanation, if the backend provides one. */
  description?: string | null
}

// ---------- People (B3) ----------

export interface SocialLink {
  platform: string
  url: string
}

export type PersonStatus = 'active' | 'inactive'

export interface Employee {
  id: UUID
  business_id: UUID
  first_name: string
  last_name: string
  full_name: string
  photo_url: string | null
  position: string | null
  department: string | null
  phone: string | null
  email: string | null
  social_links: SocialLink[]
  slug: string
  status: PersonStatus
  profile_published: boolean
  cards: CardSummary[]
  total_taps: number
  last_tap_at: ISODateTime | null
  created_at: ISODateTime
  profile_id?: UUID | null
  public_url?: string | null
  /** Part 4 §6 — business-issued personal digital card. */
  digital_card?: EmployeeDigitalCard | null
  /** Part 5 §4 — optional, unique per business; default ID number / barcode for badges. */
  employee_number?: string | null
}

export interface EmployeeDigitalCard {
  status: 'invited' | 'active' | 'inactive' | 'declined' | string
  user_email: string | null
  accepted_at: ISODateTime | null
}

export interface IssueDigitalCardRequest {
  email: string
  template_id?: string
  design?: Record<string, unknown>
  arrangement?: Record<string, Record<string, string[]>> | null
  /** Part 5 §4 — ID badge fields. */
  badge?: { id_number?: string; valid_from?: string; valid_until?: string; barcode_value?: string }
  locked_fields?: string[]
}

export interface EmployeeInput {
  first_name: string
  last_name: string
  position?: string | null
  department?: string | null
  phone?: string | null
  email?: string | null
  social_links?: SocialLink[]
  employee_number?: string | null
}

export interface Customer {
  id: UUID
  business_id: UUID
  full_name: string
  email: string | null
  phone: string | null
  company: string | null
  notes: string | null
  tags: string[]
  status: PersonStatus
  cards: CardSummary[]
  total_taps: number
  last_tap_at: ISODateTime | null
  created_at: ISODateTime
}

export interface CustomerInput {
  full_name: string
  email?: string | null
  phone?: string | null
  company?: string | null
  notes?: string | null
  tags?: string[]
}

export interface PeopleFilters {
  q?: string
  status?: PersonStatus | ''
  department?: string
  page?: number
  page_size?: number
}

// ---------- Profiles (B6) ----------

export type ProfileType = 'business' | 'employee' | 'custom' | 'menu' | 'product'

export interface HoursRow {
  day: string
  open: string
  close: string
  closed: boolean
}

export interface SectionDataMap {
  about: { text: string }
  contact: { phone?: string; email?: string; website?: string; address?: string }
  hours: { rows: HoursRow[] }
  social: { links: SocialLink[] }
  services: { items: { title: string; description: string; price?: string }[] }
  products: { items: { title: string; description: string; price?: string; image_url?: string; url?: string }[] }
  menu: { categories: { name: string; items: { name: string; description: string; price: string; tags: string[] }[] }[] }
  buttons: { items: { label: string; action: Action }[] }
  gallery: { images: string[] }
  text: { markdown: string }
}

export type SectionType = keyof SectionDataMap

/**
 * A profile section, flat on the wire: `{ type: "about", text: "…" }`. The renderer also tolerates a
 * nested `{ type, data: {…} }` form (see `sectionData()` in public/sectionUtils).
 */
export type Section = { [K in SectionType]: { id?: string; type: K } & SectionDataMap[K] }[SectionType]

export interface ProfileTheme {
  accent: string
  cover_image_url?: string | null
}

export interface Profile {
  id: UUID
  business_id: UUID
  type: ProfileType
  slug: string
  title: string
  employee_id: UUID | null
  published: boolean
  theme: ProfileTheme
  sections: Section[]
  public_url: string
  updated_at: ISODateTime
}

export interface ProfileInput {
  type?: ProfileType
  slug?: string
  title?: string
  employee_id?: UUID | null
  theme?: ProfileTheme
  sections?: Section[]
}

export interface PublicBusinessInfo {
  name: string
  slug: string
  logo_url: string | null
  verified: boolean
  category: string | null
}

export interface PublicEmployee {
  id: UUID
  full_name: string
  position: string | null
  department: string | null
  photo_url: string | null
  phone: string | null
  email: string | null
  social_links: SocialLink[]
}

export interface PublicProfileResponse {
  business: PublicBusinessInfo
  profile: Profile
  /** Live employee data for employee profiles (null otherwise). */
  employee?: PublicEmployee | null
  vcard_url: string
}

/** `GET /public/w/{public_code}` (contract §E). */
export interface PublicWifiResponse {
  business: PublicBusinessInfo | null
  ssid: string
  password: string | null
  security: 'WPA' | 'WEP' | 'nopass'
  hidden: boolean
  /** Ready-made `WIFI:` QR payload. */
  wifi_qr?: string | null
}

// ---------- Taps & analytics (B7) ----------

export type TapSource = 'web' | 'reader'
export type TapResult = 'redirected' | 'page' | 'vcard' | 'webhook' | 'inactive' | 'unknown_card'
export type DeviceType = 'ios' | 'android' | 'desktop' | 'other'

export interface CardTap {
  id: UUID
  business_id: UUID
  card_id: UUID | null
  card_name: string | null
  card_kind: CardKind | null
  assignee: { type: AssigneeType; id: UUID; name: string } | null
  source: TapSource
  action_type: string | null
  result: TapResult
  device_id: UUID | null
  device_name: string | null
  nfc_event_id: UUID | null
  visitor_hash: string | null
  device_type: DeviceType | null
  browser: string | null
  country: string | null
  /** Link-preview bots are recorded but excluded from analytics. */
  is_bot?: boolean
  created_at: ISODateTime
}

export interface TapFilters {
  source?: TapSource | ''
  card_id?: string
  employee_id?: string
  customer_id?: string
  device_id?: string
  result?: TapResult | ''
  date_from?: string
  date_to?: string
  page?: number
  page_size?: number
}

export type AnalyticsRange = '7d' | '30d' | '90d' | '365d'

export interface AnalyticsTotals {
  taps: number
  unique_visitors: number
  web_taps: number
  reader_taps: number
  active_cards: number
  active_employees: number
}

export interface Analytics {
  totals: AnalyticsTotals
  previous_period_totals: AnalyticsTotals | null
  timeline: TimelinePoint[]
  by_card: { card_id: UUID; name: string; taps: number }[]
  by_employee: { employee_id: UUID; name: string; taps: number }[]
  by_action: { action_type: string; taps: number }[]
  by_device_type: { device_type: DeviceType; taps: number }[]
  by_country: { country: string; taps: number }[]
  by_hour: { hour: number; taps: number }[]
  last_activity: CardTap | null
}

/** `GET /businesses/{id}/overview` (contract §E). */
export interface BusinessOverview {
  cards: { total: number; active: number }
  tags: { total: number; active: number }
  employees: { total: number; active: number }
  customers: number
  devices: { total: number; online: number }
  taps_today: number
  taps_7d: number
  recent_taps: CardTap[]
  checklist: {
    email_verified: boolean
    logo_uploaded: boolean
    profile_published: boolean
    first_employee: boolean
    first_card: boolean
    card_programmed: boolean
    device_paired: boolean
    team_invited: boolean
  }
}

// ---------- Devices & integrations (B8) ----------

export interface BusinessDevice extends Device {
  assigned_employee: { id: UUID; name: string } | null
  last_scan_at: ISODateTime | null
  online: boolean
}

export interface RequestLog {
  id: UUID
  created_at: ISODateTime
  request_id: string
  method: string
  route: string
  path: string
  status_code: number
  outcome: 'success' | 'client_error' | 'server_error'
  latency_ms: number
  error_code: string | null
  error_ref: string | null
  actor_type: string
  device_id: UUID | null
}

export interface DeviceActivity {
  device?: BusinessDevice
  taps: CardTap[]
  request_logs: RequestLog[]
}

export interface BusinessApplication extends Application {
  business_id?: UUID | null
}

export type ApiUsageRange = '1h' | '24h' | '7d' | '30d'

/** `GET /businesses/{id}/api-usage?range=1h|24h|7d|30d` (from request logs). */
export interface ApiUsage {
  range?: ApiUsageRange
  totals: { requests: number; errors: number; error_rate: number | null }
  by_route: { route: string; count: number; error_rate: number | null; p95_ms?: number | null }[]
  by_device: { device_id: UUID | null; name: string | null; count: number; errors?: number }[]
  by_api_key: { api_key_id: UUID | null; name?: string | null; count: number; errors?: number }[]
}

// ---------- Billing (B8) ----------

export interface BusinessPlan extends Plan {
  audience?: 'developer' | 'business'
  max_cards?: number | null
  max_members?: number | null
  taps_per_month?: number | null
}

export interface BusinessBilling {
  plan: BusinessPlan
  usage: { cards: number; devices: number; members: number; taps_this_month: number }
  limits: { cards: number | null; devices: number | null; members: number | null; taps_per_month: number | null }
  status: string
}

// ---------- Team (B9) ----------

export interface Member {
  id: UUID
  user_id: UUID
  full_name: string
  email: string
  role: BusinessRole
  extra_permissions: Permission[]
  /** Effective permissions (role + extras). */
  permissions?: Permission[]
  status: 'active' | 'suspended'
  joined_at: ISODateTime
  last_active_at: ISODateTime | null
}

export interface Invitation {
  id: UUID
  email: string
  role: BusinessRole
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  invited_by: string | { id: UUID; name: string } | null
  expires_at: ISODateTime
  created_at: ISODateTime
  /** Development only. */
  dev_invite_url?: string | null
}

export interface PublicInvitation {
  business_name: string
  role: BusinessRole
  email: string
  expires_at: ISODateTime
  status: Invitation['status']
}

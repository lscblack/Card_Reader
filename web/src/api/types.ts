/**
 * Types mirroring docs/API_CONTRACT.md exactly. Field names are snake_case on purpose:
 * they are the wire format. Timestamps are ISO-8601 UTC strings; IDs are UUIDv4 strings.
 */

export type ISODateTime = string
export type UUID = string

// ---------- Common ----------

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export interface ValidationErrorDetail {
  field: string
  message: string
}

export interface ErrorEnvelope {
  error: {
    code: string
    message: string
    details: unknown
  }
}

export interface Health {
  status: string
  database: string
  redis: string
  version: string
}

export interface ServerMeta {
  /** URL to enter as "Server URL" in the NFC Terminal app. */
  device_server_url: string
  environment: string
  version: string
}

// ---------- Auth / users ----------

export type UserRole = 'developer' | 'admin'
export type AccountType = 'developer' | 'business' | 'personal'
export type MemberRole = 'owner' | 'admin' | 'manager' | 'staff'

export interface Membership {
  business_id: UUID
  business_name: string
  business_slug: string
  role: MemberRole
}

export interface User {
  id: UUID
  email: string
  full_name: string
  role: UserRole
  is_active: boolean
  created_at: ISODateTime
  plan: string
  /** Part 2 §A3 (optional for backward compatibility with older servers). */
  account_type?: AccountType
  email_verified?: boolean
  email_verified_at?: ISODateTime | null
  memberships?: Membership[]
  /** Part 3 §4 */
  avatar_url?: string | null
  phone?: string | null
  company?: string | null
  country?: string | null
  job_title?: string | null
  last_login_at?: ISODateTime | null
  login_count?: number
  /** Part 3 §7 (free-form JSON ≤ 8 KB). */
  preferences?: UserPreferences
}

export interface UserPreferences {
  tours_completed?: string[]
  tours_dismissed?: boolean
  [key: string]: unknown
}

export interface TokenResponse {
  access_token: string
  token_type: 'bearer' | string
  expires_in: number
  user: User
  /** Development only (email disabled): link to verify the address. */
  dev_verification_url?: string | null
}

export interface RegisterBusinessInfo {
  name: string
  email: string
  phone: string
  /** ISO-3166 alpha-2 */
  country: string
  category: string
  description: string
  website?: string
  address?: string
}

export interface RegisterRequest {
  email: string
  password: string
  full_name: string
  account_type?: AccountType
  business?: RegisterBusinessInfo
  invite_token?: string
  /** Part 4 §1 — personal accounts */
  phone?: string
  /** Part 4 §6 — accept a business-issued digital card while registering (`/register?card_invite=`). */
  card_invite_token?: string
}

export interface BusinessCategory {
  code: string
  label: string
}

export interface ResendVerificationResponse {
  dev_verification_url?: string | null
}

export interface LoginRequest {
  email: string
  password: string
}

export interface UpdateMeRequest {
  full_name?: string
  phone?: string | null
  company?: string | null
  country?: string | null
  job_title?: string | null
}

export interface ChangePasswordRequest {
  current_password: string
  new_password: string
}

export interface ResetPasswordRequest {
  token: string
  new_password: string
}

// ---------- Applications ----------

export type DeliveryMode = 'relay' | 'direct'

export interface EndpointConfig {
  url: string | null
  enabled: boolean
  timeout_seconds: number
  custom_headers: Record<string, string>
  last_tested_at: ISODateTime | null
  last_test_success: boolean | null
}

export interface WebhookSecretStatus {
  configured: boolean
  last4: string | null
  rotated_at: ISODateTime | null
}

export interface Application {
  id: UUID
  name: string
  description: string | null
  is_active: boolean
  delivery_mode: DeliveryMode
  endpoint: EndpointConfig
  webhook_secret: WebhookSecretStatus
  /** Contract §7.1 — empty = no restriction beyond §5. Exact host, `*.example.com` or IP literal. */
  allowed_domains: string[]
  device_count: number
  created_at: ISODateTime
  updated_at: ISODateTime
  /** Admin account detail lists soft-deleted applications too. */
  deleted?: boolean
}

export interface CreateApplicationRequest {
  name: string
  description?: string
  delivery_mode?: DeliveryMode
  endpoint_url?: string
  webhook_secret?: string
}

export interface CreateApplicationResponse {
  application: Application
  api_key: ApiKey
  api_key_plaintext: string
  webhook_secret_plaintext: string
}

export interface UpdateApplicationRequest {
  name?: string
  description?: string
  is_active?: boolean
}

export interface UpdateEndpointRequest {
  url: string | null
  enabled: boolean
  timeout_seconds?: number
  custom_headers?: Record<string, string>
  delivery_mode?: DeliveryMode
}

export interface EndpointTestResult {
  success: boolean
  status_code: number | null
  latency_ms: number | null
  error: string | null
  response_excerpt: string | null
}

export interface RotateSecretRequest {
  webhook_secret?: string
}

export interface RotateSecretResponse {
  webhook_secret_plaintext: string
  last4: string
  rotated_at: ISODateTime
}

// ---------- API keys ----------

export interface ApiKey {
  id: UUID
  application_id: UUID
  application_name: string
  name: string
  prefix: string
  last4: string
  created_at: ISODateTime
  last_used_at: ISODateTime | null
  revoked_at: ISODateTime | null
  is_active: boolean
}

export interface CreateApiKeyRequest {
  application_id: UUID
  name: string
}

export interface CreateApiKeyResponse {
  api_key: ApiKey
  plaintext: string
}

// ---------- Devices ----------

export type DeviceStatus = 'active' | 'revoked'

export interface Device {
  id: UUID
  application_id: UUID
  application_name: string
  name: string
  platform: string
  model: string | null
  os_version: string | null
  app_version: string | null
  status: DeviceStatus
  last_seen_at: ISODateTime | null
  last_ip: string | null
  events_count: number
  created_at: ISODateTime
}

// ---------- Events & deliveries ----------

/** `logged`: recorded without a delivery (e.g. a business terminal with no endpoint configured) — not an error. */
export type EventStatus = 'pending' | 'delivered' | 'retrying' | 'failed' | 'logged'

export interface NfcEvent {
  id: UUID
  application_id: UUID
  application_name: string
  device_id: UUID
  device_name: string
  event_type: 'card.detected' | string
  card_id: string
  card_type: string | null
  card_technologies: string[]
  /** Always false today: a UID is an identifier, not proof of identity. */
  authenticated: boolean
  delivery_mode: DeliveryMode
  status: EventStatus
  attempts: number
  last_status_code: number | null
  last_error: string | null
  /** Part 2 §A1 */
  error_code?: string | null
  error_ref?: string | null
  detected_at: ISODateTime
  received_at: ISODateTime
  delivered_at: ISODateTime | null
}

export interface Delivery {
  id: UUID
  event_id: UUID
  application_id: UUID
  attempt: number
  mode: DeliveryMode
  url: string
  success: boolean
  status_code: number | null
  latency_ms: number | null
  error: string | null
  /** Part 2 §A1 */
  error_code?: string | null
  error_ref?: string | null
  response_excerpt: string | null
  created_at: ISODateTime
}

export interface NfcEventDetail extends NfcEvent {
  deliveries: Delivery[]
}

export interface EventFilters {
  application_id?: string
  device_id?: string
  card_id?: string
  status?: EventStatus | ''
  date_from?: string
  date_to?: string
  page?: number
  page_size?: number
}

export interface DeliveryFilters {
  application_id?: string
  success?: boolean
  page?: number
  page_size?: number
}

// ---------- Overview ----------

export interface Overview {
  applications: number
  active_devices: number
  active_api_keys: number
  events_today: number
  events_this_month: number
  delivery_success_rate: number | null
  recent_events: NfcEvent[]
}

// ---------- Usage & billing ----------

export interface Plan {
  code: string
  name: string
  price_monthly_cents: number
  currency: string
  events_per_month: number | null
  max_applications: number | null
  max_devices: number | null
  features: string[]
  /** Part 2 §A3 (+ Part 4 "personal") */
  audience?: 'developer' | 'business' | 'personal'
  /** Personal plan limit (Part 4 §1). */
  max_contacts?: number | null
  /** Business plan limits (Part 2 §B8). */
  max_cards?: number | null
  max_members?: number | null
  /** Part 3 §2 */
  price_yearly_cents?: number | null
  is_active?: boolean
  is_featured?: boolean
  sort_order?: number
  badge?: string | null
  description?: string | null
  promotion?: AppliedPromotion | null
}

export interface AppliedPromotion {
  id: UUID
  name: string
  banner_text: string | null
  discount_type: 'percent' | 'amount'
  discount_value: number
  discounted_price_monthly_cents: number
  ends_at: ISODateTime | null
  code: string | null
}

export interface UsageDaily {
  date: string
  events: number
  delivered: number
  failed: number
}

export interface Usage {
  plan: Plan
  period_start: ISODateTime
  period_end: ISODateTime
  totals: { events: number; delivered: number; failed: number; applications: number; devices: number }
  limits: { events_per_month: number | null; applications: number | null; devices: number | null }
  daily: UsageDaily[]
}

export interface Subscription {
  plan: Plan
  status: string
  current_period_start: ISODateTime
  current_period_end: ISODateTime
}

// ---------- Audit ----------

export interface AuditLog {
  id: UUID
  action: string
  resource_type: string | null
  resource_id: string | null
  ip_address: string | null
  user_agent: string | null
  metadata: Record<string, unknown> | null
  created_at: ISODateTime
}

// ---------- Admin ----------

export interface AdminStats {
  users: number
  applications: number
  devices: number
  events_total: number
}

// ---------- Allowed origins (contract §7.2) ----------

export interface AllowedOrigin {
  id: UUID
  origin: string
  note: string | null
  created_by: string | null
  created_by_email?: string | null
  created_at: ISODateTime
}

export interface AllowedOriginsResponse {
  env: string[]
  items: AllowedOrigin[]
}

export interface CreateAllowedOriginRequest {
  origin: string
  note?: string
}

// ---------- QR pairing (contract §7.3) ----------

export interface CreatePairingCodeRequest {
  device_name?: string
}

export interface PairingCodeCreated {
  id: UUID
  /** Plaintext `nfcp_…` code — shown once, kept in component state only. */
  code: string
  expires_at: ISODateTime
  server_url: string
  qr_payload: string
}

export type PairingStatus = 'pending' | 'used' | 'expired'

export interface PairingCodeState {
  id: UUID
  application_id: UUID
  status: PairingStatus
  expires_at: ISODateTime
  used_at: ISODateTime | null
  device: Device | null
}

// =====================================================================================
// Part 2 (docs/PART2_CONTRACT.md)
// =====================================================================================

// ---------- A1 Error catalog ----------

export interface ErrorCatalogEntry {
  code: string
  ref: string
  http_status: number | null
  source: 'api' | 'delivery' | 'mobile'
  title: string
  description: string
  fix: string
}

// ---------- A2 Request logs ----------

export type RequestOutcome = 'success' | 'client_error' | 'server_error'
export type ActorType = 'user' | 'api_key' | 'device' | 'pairing_code' | 'public' | 'anonymous'

export interface RequestLog {
  id: UUID
  created_at: ISODateTime
  request_id: string
  method: string
  route: string
  path: string
  status_code: number
  outcome: RequestOutcome
  latency_ms: number
  error_code: string | null
  error_ref: string | null
  actor_type: ActorType
  actor_id: string | null
  user_id: UUID | null
  business_id: UUID | null
  application_id: UUID | null
  device_id: UUID | null
  ip_hash: string | null
  user_agent: string | null
  country: string | null
}

export interface RequestLogFilters {
  status?: number | string
  outcome?: RequestOutcome | ''
  route?: string
  error_code?: string
  application_id?: string
  device_id?: string
  date_from?: string
  date_to?: string
  request_id?: string
  page?: number
  page_size?: number
  // admin-only
  user_id?: string
  business_id?: string
  actor_type?: ActorType | ''
  min_latency_ms?: number | string
}

// ---------- A4 Sandbox ----------

export interface SandboxEndpoint {
  id: UUID
  name: string
  url: string
  token: string
  application_id: UUID | null
  response_status: number
  response_delay_ms: number
  response_body: string
  response_headers: Record<string, string>
  request_count: number
  last_request_at: ISODateTime | null
  created_at: ISODateTime
}

export interface SandboxEndpointInput {
  name?: string
  application_id?: UUID | null
  response_status?: number
  response_delay_ms?: number
  response_body?: string
  response_headers?: Record<string, string>
}

export type SignatureStatus = 'valid' | 'invalid' | 'missing' | 'unverifiable'

export interface SandboxCheck {
  name: string
  passed: boolean
  detail: string | null
}

export interface SandboxRequest {
  id: UUID
  endpoint_id: UUID
  received_at: ISODateTime
  method: string
  path: string
  query: string | Record<string, string> | null
  headers: Record<string, string>
  body: string
  body_json: unknown
  size_bytes: number
  source_ip_hash: string | null
  signature: { status: SignatureStatus; mode: DeliveryMode | null; reason: string | null; error_ref: string | null }
  checks: SandboxCheck[]
  response_status: number
  response_delay_ms: number
  event_id: UUID | null
  device_id: UUID | null
}

// ---------- A5 Admin console ----------

export type AdminRange = '1h' | '24h' | '7d' | '30d'

export interface AdminOverview {
  users: { total: number; developers: number; businesses: number; active_24h: number; new_in_range: number }
  businesses: number
  applications: number
  devices: { total: number; online: number; offline: number; revoked: number }
  events_in_range: number
  taps_in_range: number
  requests: {
    total: number
    success: number
    client_error: number
    server_error: number
    error_rate: number
    p50_ms: number | null
    p95_ms: number | null
    p99_ms: number | null
    rpm_now: number
  }
  deliveries: { total: number; succeeded: number; failed: number; success_rate: number | null; queue_depth: number }
  top_errors: { error_code: string; error_ref: string | null; count: number }[]
  top_routes: { route: string; count: number; error_rate: number; p95_ms: number | null }[]
  timeline: { bucket: ISODateTime; requests: number; errors: number; p95_ms: number | null; events: number }[]
}

export interface AdminAccountStats {
  requests_24h: number
  error_rate_24h: number | null
  events_30d: number
  devices: number
  applications: number
  last_active_at: ISODateTime | null
}

export interface AdminAccount extends User {
  business: { id: UUID; name: string; status: 'active' | 'suspended' } | null
  stats: AdminAccountStats
}

export interface AdminAccountDetail extends AdminAccount {
  applications?: Application[]
  devices?: Device[]
  /** The account's latest request logs (backend key `recent_request_logs`). */
  recent_request_logs?: RequestLog[]
  audit_logs?: AuditLog[]
  /** Part 3 §4 */
  email_logs?: EmailLog[]
  recent_logins?: { at: ISODateTime; ip_address: string | null; user_agent: string | null }[]
}

export interface AdminAccountPatch {
  full_name?: string
  phone?: string | null
  company?: string | null
  country?: string | null
  job_title?: string | null
  is_active?: boolean
  role?: UserRole
  plan_code?: string
  email_verified?: boolean
}

export interface AdminBusiness {
  id: UUID
  name: string
  slug: string
  email: string | null
  country: string | null
  category: string | null
  status: 'active' | 'suspended'
  verified: boolean
  plan: Plan | string | null
  created_at: ISODateTime
  /** Business owner's account email. */
  owner_email?: string | null
  deleted?: boolean
  stats?: { members: number; cards: number; devices: number; taps_30d: number }
}

export interface AdminDevice extends Device {
  online: boolean
  owner?: { id: UUID; email: string; full_name?: string | null } | null
  business?: { id: UUID; name: string } | null
}

export interface AdminSystem {
  database: string
  redis: string
  worker: { alive: boolean; last_heartbeat_at: ISODateTime | null }
  delivery_queue_depth: number
  request_log_buffer_depth: number
  version: string
  environment: string
}

export interface PlatformSettings {
  /** `personal` missing = enabled. */
  signups_enabled: { developer: boolean; business: boolean; personal?: boolean }
  request_log_retention_days: number
  default_rate_limit: { requests: number; window_seconds: number }
  maintenance_message: string | null
}

/** Part 2 §E — `GET /meta/status` (public). */
export interface MetaStatus {
  maintenance_message: string | null
  public_api_url?: string | null
  public_web_url?: string | null
  version?: string
}

/** Part 2 §E — `POST /sandbox/endpoints/{id}/send-test`. */
export interface SandboxSendTestResult {
  success: boolean
  status_code: number | null
  latency_ms: number | null
  error: string | null
  error_code: string | null
  error_ref: string | null
  response_excerpt: string | null
}

// =====================================================================================
// Part 3 (docs/PART3_CONTRACT.md)
// =====================================================================================

export type ThemeMode = 'dark' | 'light' | 'system'

export interface Branding {
  product_name: string
  tagline: string | null
  logo_url: string | null
  logo_dark_url: string | null
  favicon_url: string | null
  fonts: { heading: string; body: string; mono: string }
  theme: { accent_light: string; accent_dark: string; default_mode: ThemeMode }
  support_email: string | null
  company_address: string | null
  social_links: { platform: string; url: string }[]
  updated_at: ISODateTime | null
}

export type BrandingAssetVariant = 'logo' | 'logo_dark' | 'favicon'

export interface FontOption {
  family: string
  category: 'sans' | 'serif' | 'mono' | 'display'
  google: boolean
  weights: number[]
}

export type PromotionStatus = 'scheduled' | 'active' | 'expired' | 'inactive' | 'exhausted'

export interface Promotion {
  id: UUID
  name: string
  code: string | null
  description: string | null
  discount_type: 'percent' | 'amount'
  discount_value: number
  currency: string | null
  audience: 'developer' | 'business' | 'personal' | 'all'
  plan_codes: string[]
  starts_at: ISODateTime | null
  ends_at: ISODateTime | null
  is_active: boolean
  show_on_landing: boolean
  banner_text: string | null
  max_redemptions: number | null
  redemptions: number
  created_at: ISODateTime
  status: PromotionStatus
}

export type PromotionInput = Partial<Omit<Promotion, 'id' | 'redemptions' | 'created_at' | 'status'>>

export type PlanInput = Partial<Omit<Plan, 'promotion'>>

export type EmailStatus = 'queued' | 'sent' | 'failed' | 'logged'

export interface EmailLog {
  id: UUID
  campaign_id: UUID | null
  to_email: string
  user_id: UUID | null
  template: string
  subject: string
  status: EmailStatus
  error: string | null
  sent_by: string | null
  created_at: ISODateTime
  sent_at: ISODateTime | null
}

export interface EmailLogDetail extends EmailLog {
  html: string
}

export interface EmailFilter {
  account_type?: AccountType
  status?: 'active' | 'inactive'
  email_verified?: boolean
  plan_code?: string
}

export interface EmailCta {
  label: string
  url: string
}

export interface SendEmailRequest {
  user_ids?: UUID[]
  filter?: EmailFilter
  subject: string
  body_markdown: string
  cta?: EmailCta
}

export interface EmailCampaign {
  id: UUID
  subject: string
  recipients: number
  sent: number
  failed: number
  logged: number
  created_by: string | null
  created_at: ISODateTime
}

export interface EmailTemplate {
  name: string
  description: string
}

export interface RenderedEmail {
  html: string
  text: string
}

export interface ErrorStats {
  count: number
  previous_count: number
  last_seen_at: ISODateTime | null
  affected_users: number
  affected_devices: number
  trend: { bucket: ISODateTime; count: number }[]
}

export interface AdminErrorEntry extends ErrorCatalogEntry {
  stats: ErrorStats | null
}

export interface AdminErrorDetail extends AdminErrorEntry {
  top_routes: { route: string; count: number }[]
  top_users: { id: UUID; email: string; count?: number }[]
  recent: RequestLog[]
  recent_deliveries: Delivery[]
}

// ---------- Part 3 §8 Live run mode ----------

export interface LiveEventReceived {
  event_id: UUID
  card_id: string
  card_type: string | null
  card_technologies: string[]
  device_id: UUID
  device_name: string
  detected_at: ISODateTime
  delivery_mode: DeliveryMode
}

export interface LiveDeliveryAttempt {
  event_id: UUID
  attempt: number
  mode: DeliveryMode
  url: string
  success: boolean
  status_code: number | null
  latency_ms: number | null
  error_code: string | null
  error_ref: string | null
  response_excerpt: string | null
  response_headers: { 'content-type'?: string; 'content-length'?: string } | null
  request_payload: unknown
}

export interface LiveSandboxRequest {
  endpoint_id: UUID
  request_id: UUID
  event_id: UUID | null
  signature_status: SignatureStatus
  checks_failed: number
  response_status: number
}

export interface LiveBusinessTap {
  card_id: string
  card_name: string
  assignee_name: string | null
  result: string
  action_type: string | null
}

export type LiveMessage =
  | { type: 'event.received'; data: LiveEventReceived }
  | { type: 'delivery.attempt'; data: LiveDeliveryAttempt }
  | { type: 'sandbox.request'; data: LiveSandboxRequest }
  | { type: 'business.tap'; data: LiveBusinessTap }

// ---------- Part 3 §9 App releases ----------

export interface PublicAppRelease {
  version_name: string
  build_number: number
  file_size: number
  sha256: string
  published_at: ISODateTime
  download_url: string
  min_android: string
}

export type AppReleaseStatus = 'queued' | 'building' | 'succeeded' | 'failed' | 'cancelled'

export interface AppRelease {
  id: UUID
  version_name: string
  build_number: number
  channel: 'stable' | 'beta'
  build_type: 'release' | 'debug'
  api_base_url: string
  file_size: number | null
  sha256: string | null
  status: AppReleaseStatus
  is_published: boolean
  notes: string | null
  log_excerpt: string | null
  log?: string | null
  started_at: ISODateTime | null
  finished_at: ISODateTime | null
  created_by: string | null
  created_at: ISODateTime
  download_url: string | null
  downloads?: number
}

export interface CreateAppReleaseRequest {
  version_name?: string
  build_number?: number
  build_type: 'release' | 'debug'
  channel: 'stable' | 'beta'
  api_base_url?: string
  notes?: string
  publish_on_success: boolean
}

// ---------- Part 3 §10 Notifications ----------

export interface AppNotification {
  id: UUID
  type: string
  title: string
  body: string
  link: string | null
  severity: 'info' | 'success' | 'warning' | 'error'
  read_at: ISODateTime | null
  created_at: ISODateTime
}

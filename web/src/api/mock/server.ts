/**
 * DEV-ONLY in-memory mock of the API contract. Loaded exclusively via a dynamic import guarded by
 * `VITE_USE_MOCKS === 'true'`, so it is not part of normal builds. State resets on page reload.
 */
import type {
  ApiKey,
  Application,
  AuditLog,
  Delivery,
  Device,
  EndpointConfig,
  NfcEvent,
  Plan,
  User,
} from '../types'
import type { RawResponse } from '../client'
import type {
  ActorType,
  AppNotification,
  AppRelease,
  LiveDeliveryAttempt,
  LiveEventReceived,
  LiveMessage,
  Branding,
  EmailCampaign,
  EmailFilter,
  EmailLog,
  EmailTemplate,
  ErrorStats,
  FontOption,
  Promotion,
  PromotionStatus,
  RenderedEmail,
  AdminAccount,
  AdminBusiness,
  AdminDevice,
  AdminOverview,
  AllowedOrigin,
  Membership,
  PairingCodeState,
  PlatformSettings,
  RequestLog,
  SandboxEndpoint,
  SandboxRequest,
  SignatureStatus,
} from '../types'
import { endpointOutsideAllowlist, parseAllowedDomain } from '@/lib/url'
import { handleBusinessMock, setBusinessNotifier } from '@/business/mock'
import { handlePersonalMock } from '@/personal/mock'
import { mockErrorCatalog } from '@/docs/data/mockErrorCatalog'
import { mockActivePromotions, mockAppRelease, mockPlans, mockPromotions, mockPublicPlans } from '@/marketing/mockPricing'

type Query = Record<string, string | number | boolean | null | undefined> | undefined
type Body = Record<string, unknown>

// ---------- helpers ----------

const uuid = () => crypto.randomUUID()
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const ago = (ms: number) => new Date(Date.now() - ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const rand = (n: number) => Math.floor(Math.random() * n)
const pick = <T,>(xs: T[]): T => xs[rand(xs.length)]
const urlsafe = (n: number) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  const bytes = crypto.getRandomValues(new Uint8Array(n))
  return Array.from(bytes, (b) => chars[b % 64]).join('')
}
const hex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()

function ok(body: unknown, status = 200): RawResponse {
  return { status, headers: new Headers(), body }
}
function refFor(code: string): string | null {
  return mockErrorCatalog.find((e) => e.code === code)?.ref ?? null
}
function fail(status: number, code: string, message: string, details: unknown = null): RawResponse {
  const headers = new Headers()
  if (status === 429) headers.set('Retry-After', '30')
  const ref = refFor(code)
  const request_id = crypto.randomUUID().replace(/-/g, '')
  headers.set('X-Request-Id', request_id)
  return {
    status,
    headers,
    body: { error: { code, message, details, ref, request_id, docs_url: ref ? `/docs/errors#${ref}` : null } },
  }
}
function paginate<T>(items: T[], q: Query, maxDefault = 20) {
  const page = Math.max(1, Number(q?.page) || 1)
  const page_size = Math.min(100, Math.max(1, Number(q?.page_size) || maxDefault))
  return { items: items.slice((page - 1) * page_size, page * page_size), total: items.length, page, page_size }
}

// ---------- seed ----------

const plans: Plan[] = [
  { code: 'free', name: 'Free', price_monthly_cents: 0, currency: 'usd', events_per_month: 10_000, max_applications: 3, max_devices: 5, features: ['Relay & direct delivery', 'HMAC-signed webhooks', 'Community support'] },
  { code: 'pro', name: 'Pro', price_monthly_cents: 2900, currency: 'usd', events_per_month: 250_000, max_applications: 20, max_devices: 100, features: ['Everything in Free', '90-day event history', 'Email support'] },
  { code: 'business', name: 'Business', price_monthly_cents: 19900, currency: 'usd', events_per_month: 5_000_000, max_applications: null, max_devices: null, features: ['Everything in Pro', 'SSO (coming soon)', 'Priority support & SLA'] },
]

const user: User = {
  id: uuid(),
  email: 'dev@example.com',
  full_name: 'Ada Developer',
  role: 'developer',
  is_active: true,
  created_at: ago(40 * DAY),
  plan: 'free',
  account_type: 'developer',
  email_verified: false,
  email_verified_at: null,
  memberships: [],
  avatar_url: null,
  phone: '+250 788 123 456',
  company: 'Analytical Engines Ltd',
  country: 'RW',
  job_title: 'Lead developer',
  last_login_at: ago(2 * HOUR),
  login_count: 37,
}
// Mock state resets on reload; remember which persona signed in (dev-only, no secrets).
const PERSONA_KEY = 'nfc.mock.persona'
try {
  const saved = JSON.parse(sessionStorage.getItem(PERSONA_KEY) ?? 'null') as Partial<User> | null
  if (saved) Object.assign(user, saved)
} catch {
  /* ignore */
}
function savePersona() {
  try {
    const { email, full_name, role, account_type, email_verified, phone, company, country, job_title } = user
    // Avatars are blob: URLs that die with the page, so they're not persisted.
    sessionStorage.setItem(PERSONA_KEY, JSON.stringify({ email, full_name, role, account_type, email_verified, phone, company, country, job_title }))
  } catch {
    /* ignore */
  }
}
const otherUsers: User[] = Array.from({ length: 7 }, (_, i) => ({
  id: uuid(),
  email: `user${i + 1}@example.org`,
  full_name: ['Grace H.', 'Linus T.', 'Margaret H.', 'Ken T.', 'Barbara L.', 'Dennis R.', 'Radia P.'][i],
  role: 'developer',
  is_active: i !== 3,
  created_at: ago((i + 2) * 3 * DAY),
  plan: 'free',
  phone: i % 2 ? `+1 555 010 ${10 + i}` : null,
  company: ['Compiler Co', 'Kernel Labs', 'Apollo Systems', 'Unix Ltd', 'Clu Inc', 'Bell Works', 'Net Routing'][i],
  country: ['US', 'FI', 'US', 'US', 'US', 'US', 'US'][i],
  job_title: i % 3 ? 'Engineer' : null,
  last_login_at: ago((i + 1) * 9 * HOUR),
  login_count: 3 + i * 4,
}))

const endpoint = (url: string | null, enabled = true): EndpointConfig => ({
  url,
  enabled,
  timeout_seconds: 10,
  custom_headers: url ? { 'X-Api-Token': 'demo-token' } : {},
  last_tested_at: url ? ago(2 * DAY) : null,
  last_test_success: url ? true : null,
})

const apps: Application[] = [
  {
    id: uuid(),
    name: 'Front desk check-in',
    description: 'Visitor badges at the HQ reception.',
    is_active: true,
    delivery_mode: 'relay',
    endpoint: endpoint('https://api.example.com/nfc/card'),
    webhook_secret: { configured: true, last4: 'q7Zk', rotated_at: null },
    allowed_domains: ['api.example.com', '*.example.com'],
    device_count: 0,
    created_at: ago(30 * DAY),
    updated_at: ago(2 * DAY),
  },
  {
    id: uuid(),
    name: 'Warehouse scanners',
    description: 'Pallet tags on the loading dock.',
    is_active: true,
    delivery_mode: 'direct',
    endpoint: endpoint('https://192.168.1.20:8443/tags', true),
    webhook_secret: { configured: true, last4: 'P0xa', rotated_at: ago(5 * DAY) },
    allowed_domains: [],
    device_count: 0,
    created_at: ago(12 * DAY),
    updated_at: ago(5 * DAY),
  },
]

const keys: ApiKey[] = apps.flatMap((a, i) => [
  {
    id: uuid(),
    application_id: a.id,
    application_name: a.name,
    name: 'Default key',
    prefix: `nfc_${urlsafe(8)}`,
    last4: urlsafe(4),
    created_at: a.created_at,
    last_used_at: ago((i + 1) * 3 * HOUR),
    revoked_at: null,
    is_active: true,
  },
  ...(i === 0
    ? [
        {
          id: uuid(),
          application_id: a.id,
          application_name: a.name,
          name: 'Old tablet key',
          prefix: `nfc_${urlsafe(8)}`,
          last4: urlsafe(4),
          created_at: ago(25 * DAY),
          last_used_at: ago(20 * DAY),
          revoked_at: ago(10 * DAY),
          is_active: false,
        },
      ]
    : []),
])

const devices: Device[] = [
  ['Front desk Pixel', 0, 'Pixel 8', 'Android 15', 2 * MIN, 'active'],
  ['Lobby Galaxy', 0, 'Galaxy S23', 'Android 14', 3 * HOUR, 'active'],
  ['Dock 3 handheld', 1, 'Zebra TC58', 'Android 13', 40 * MIN, 'active'],
  ['Retired Moto', 1, 'Moto G54', 'Android 14', 9 * DAY, 'revoked'],
].map(([name, ai, model, os, seen, status]) => ({
  id: uuid(),
  application_id: apps[ai as number].id,
  application_name: apps[ai as number].name,
  name: name as string,
  platform: 'android',
  model: model as string,
  os_version: os as string,
  app_version: '1.0.0',
  status: status as Device['status'],
  last_seen_at: ago(seen as number),
  last_ip: `203.0.113.${10 + rand(200)}`,
  events_count: 0,
  created_at: ago(20 * DAY),
}))
apps.forEach((a) => (a.device_count = devices.filter((d) => d.application_id === a.id && d.status === 'active').length))

const cards = Array.from({ length: 14 }, () => '04' + hex(6))
const events: NfcEvent[] = []
const deliveries: Delivery[] = []

function addEvent(detectedMsAgo: number) {
  const dev = pick(devices.filter((d) => d.status === 'active'))
  const app = apps.find((a) => a.id === dev.application_id)!
  const r = Math.random()
  const status: NfcEvent['status'] = detectedMsAgo < 2 * MIN && r < 0.2 ? 'retrying' : r < 0.06 ? 'failed' : 'delivered'
  const detected = ago(detectedMsAgo)
  const e: NfcEvent = {
    id: uuid(),
    application_id: app.id,
    application_name: app.name,
    device_id: dev.id,
    device_name: dev.name,
    event_type: 'card.detected',
    card_id: pick(cards),
    card_type: pick(['mifare_classic', 'mifare_ultralight', 'ntag215', null]),
    card_technologies: pick([['NfcA', 'MifareClassic'], ['NfcA', 'MifareUltralight'], ['NfcA'], ['IsoDep', 'NfcA']]),
    authenticated: false,
    delivery_mode: app.delivery_mode,
    status,
    attempts: status === 'delivered' ? 1 : status === 'failed' ? 4 : 2,
    last_status_code: status === 'delivered' ? 200 : pick([500, 502, 503, null]),
    last_error: status === 'delivered' ? null : pick(['Endpoint returned 502 Bad Gateway', 'Timed out after 10s', 'Connection refused']),
    detected_at: detected,
    received_at: detected,
    delivered_at: status === 'delivered' ? detected : null,
  }
  events.unshift(e)
  dev.events_count++
  for (let i = 1; i <= e.attempts; i++) {
    const success = status === 'delivered' && i === e.attempts
    deliveries.unshift({
      id: uuid(),
      event_id: e.id,
      application_id: app.id,
      attempt: i,
      mode: app.delivery_mode,
      url: app.endpoint.url ?? '',
      success,
      status_code: success ? 200 : e.last_status_code,
      latency_ms: 60 + rand(400),
      error: success ? null : e.last_error,
      response_excerpt: success ? '{"ok":true}' : '<html><body>502 Bad Gateway</body></html>',
      created_at: detected,
    })
  }
}
for (let i = 0; i < 220; i++) addEvent(Math.floor(Math.pow(Math.random(), 1.6) * 29 * DAY) + 30_000)
events.sort((a, b) => b.detected_at.localeCompare(a.detected_at))
deliveries.sort((a, b) => b.created_at.localeCompare(a.created_at))

const audit: AuditLog[] = []
function log(action: string, resource_type: string | null = null, resource_id: string | null = null) {
  audit.unshift({ id: uuid(), action, resource_type, resource_id, ip_address: '198.51.100.7', user_agent: navigator.userAgent, metadata: null, created_at: now() })
}
;[
  ['user.register', 'user', user.id],
  ['application.create', 'application', apps[0].id],
  ['endpoint.update', 'application', apps[0].id],
  ['device.register', 'device', devices[0].id],
  ['application.create', 'application', apps[1].id],
  ['webhook_secret.rotate', 'application', apps[1].id],
  ['api_key.revoke', 'api_key', keys[1].id],
  ['user.login', 'user', user.id],
].forEach(([a, t, id]) => log(a, t, id))

let loggedIn = true
const pairings = new Map<string, PairingCodeState>()
const origins: AllowedOrigin[] = [
  { id: uuid(), origin: 'https://staging-dashboard.example.com', note: 'Staging dashboard', created_by: uuid(), created_by_email: 'dev@example.com', created_at: ago(3 * DAY) },
]

// Demo an allowlist block in the delivery log.
deliveries.unshift({
  id: uuid(),
  event_id: events[5]?.id ?? uuid(),
  application_id: apps[0].id,
  attempt: 1,
  mode: 'relay',
  url: 'https://old-host.example.net/nfc',
  success: false,
  status_code: null,
  latency_ms: null,
  error: 'domain_not_allowed',
  response_excerpt: null,
  created_at: ago(4 * HOUR),
})


// =====================================================================================
// Part 2 mock state (web-core): request logs, sandbox, admin console
// =====================================================================================

const DELIVERY_CODES: Record<string, string> = {
  'Endpoint returned 502 Bad Gateway': 'delivery_http_5xx',
  'Timed out after 10s': 'delivery_timeout',
  'Connection refused': 'delivery_connection_refused',
  'Endpoint returned 500': 'delivery_http_5xx',
  domain_not_allowed: 'domain_not_allowed',
}
for (const d of deliveries) {
  if (!d.success && d.error) {
    d.error_code = DELIVERY_CODES[d.error] ?? 'delivery_http_5xx'
    d.error_ref = refFor(d.error_code)
  }
}
for (const e of events) {
  if (e.last_error) {
    e.error_code = DELIVERY_CODES[e.last_error] ?? 'delivery_http_5xx'
    e.error_ref = refFor(e.error_code)
  }
}

function withMemberships(token: string | null): User {
  if (user.account_type !== 'business') return { ...user, memberships: [] }
  const res = handleBusinessMock('GET', '/businesses', undefined, {}, token ?? 'mock')
  const list = (res && Array.isArray(res.body) ? res.body : []) as { id: string; name: string; slug: string; role?: string }[]
  return {
    ...user,
    memberships: list.map((b) => ({ business_id: b.id, business_name: b.name, business_slug: b.slug, role: (b.role as Membership['role']) ?? 'owner' })),
  }
}

// ---- request logs ----
const ROUTES: { method: string; route: string; actor: ActorType }[] = [
  { method: 'POST', route: '/api/v1/device/events', actor: 'device' },
  { method: 'POST', route: '/api/v1/device/heartbeat', actor: 'device' },
  { method: 'GET', route: '/api/v1/device/config', actor: 'device' },
  { method: 'POST', route: '/api/v1/device/register', actor: 'api_key' },
  { method: 'GET', route: '/api/v1/applications', actor: 'user' },
  { method: 'GET', route: '/api/v1/events', actor: 'user' },
  { method: 'PUT', route: '/api/v1/applications/{id}/endpoint', actor: 'user' },
  { method: 'GET', route: '/t/{public_code}', actor: 'public' },
  { method: 'POST', route: '/api/v1/auth/login', actor: 'anonymous' },
]
const FAILS: { status: number; code: string }[] = [
  { status: 401, code: 'invalid_device_token' },
  { status: 401, code: 'invalid_api_key' },
  { status: 422, code: 'validation_error' },
  { status: 422, code: 'invalid_card_id' },
  { status: 429, code: 'rate_limited' },
  { status: 404, code: 'not_found' },
  { status: 409, code: 'event_id_conflict' },
  { status: 500, code: 'internal_error' },
  { status: 401, code: 'invalid_credentials' },
]
function makeLog(at: number, uid: string): RequestLog {
  const r = pick(ROUTES)
  const roll = Math.random()
  const f = roll < 0.1 ? pick(FAILS) : null
  const status = f ? f.status : r.method === 'POST' && r.route.endsWith('register') ? 201 : r.route.startsWith('/t/') ? 302 : 200
  const dev = pick(devices)
  const path = r.route.replace('{id}', apps[0].id).replace('{public_code}', 'aZ3kq9Lm2P')
  return {
    id: uuid(),
    created_at: new Date(at).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    request_id: uuid().replace(/-/g, ''),
    method: r.method,
    route: r.route,
    path,
    status_code: status,
    outcome: status >= 500 ? 'server_error' : status >= 400 ? 'client_error' : 'success',
    latency_ms: Math.round(8 + Math.pow(Math.random(), 3) * (r.route.endsWith('events') ? 1400 : 300)),
    error_code: f?.code ?? null,
    error_ref: f ? refFor(f.code) : null,
    actor_type: r.actor,
    actor_id: r.actor === 'device' ? dev.id : r.actor === 'user' ? uid : null,
    user_id: r.actor === 'anonymous' || r.actor === 'public' ? null : uid,
    business_id: null,
    application_id: r.actor === 'device' || r.actor === 'api_key' ? dev.application_id : null,
    device_id: r.actor === 'device' ? dev.id : null,
    ip_hash: hex(16).toLowerCase(),
    user_agent: r.actor === 'device' ? 'NFCTerminal/1.1.0 (Android 15; Pixel 8)' : 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140',
    country: pick(['RW', 'KE', 'US', null]),
  }
}
const requestLogs: RequestLog[] = []
for (let i = 0; i < 700; i++) {
  const uid = Math.random() < 0.7 ? user.id : pick(otherUsers).id
  requestLogs.push(makeLog(Date.now() - Math.pow(Math.random(), 1.8) * 7 * DAY, uid))
}
requestLogs.sort((a, b) => b.created_at.localeCompare(a.created_at))
setInterval(() => {
  for (let i = 0; i < 1 + rand(3); i++) requestLogs.unshift(makeLog(Date.now(), Math.random() < 0.7 ? user.id : pick(otherUsers).id))
  requestLogs.length = Math.min(requestLogs.length, 2000)
}, 4000)

function filterLogs(list: RequestLog[], q: Query): RequestLog[] {
  const g = (k: string) => (q?.[k] == null || q[k] === '' ? null : String(q[k]))
  return list.filter(
    (l) =>
      (!g('outcome') || l.outcome === g('outcome')) &&
      (!g('status') || String(l.status_code) === g('status')) &&
      (!g('route') || l.route.includes(g('route')!) || l.path.includes(g('route')!)) &&
      (!g('error_code') || (l.error_code ?? '').includes(g('error_code')!)) &&
      (!g('request_id') || l.request_id.includes(g('request_id')!)) &&
      (!g('date_from') || l.created_at >= g('date_from')!) &&
      (!g('date_to') || l.created_at <= g('date_to')!) &&
      (!g('actor_type') || l.actor_type === g('actor_type')) &&
      (!g('user_id') || l.user_id === g('user_id')) &&
      (!g('business_id') || l.business_id === g('business_id')) &&
      (!g('application_id') || l.application_id === g('application_id')) &&
      (!g('device_id') || l.device_id === g('device_id')) &&
      (!g('min_latency_ms') || l.latency_ms >= Number(g('min_latency_ms'))),
  )
}

// ---- sandbox ----
const SANDBOX_BASE = 'http://192.168.1.10:8000/sandbox/'
function newSandbox(name: string, application_id: string | null): SandboxEndpoint {
  const token = urlsafe(24).replace(/[-_]/g, 'x')
  return {
    id: uuid(),
    name,
    url: SANDBOX_BASE + token,
    token,
    application_id,
    response_status: 200,
    response_delay_ms: 0,
    response_body: '{"ok":true}',
    response_headers: {},
    request_count: 0,
    last_request_at: null,
    created_at: now(),
  }
}
const sandboxes: SandboxEndpoint[] = [newSandbox('Default sandbox', apps[0].id)]
const sandboxRequests: SandboxRequest[] = []

function sandboxHit(ep: SandboxEndpoint, opts: { test?: boolean; bad?: 'signature' | 'unsigned' | 'stale' } = {}): SandboxRequest {
  const eventId = uuid()
  const dev = pick(devices)
  const ts = Math.floor(Date.now() / 1000) - (opts.bad === 'stale' ? 900 : 0)
  const nonce = hex(16).toLowerCase()
  const card = '04' + hex(6)
  const payload = {
    event_id: eventId,
    event: opts.test ? 'endpoint.test' : 'card.detected',
    card_id: opts.test ? 'TEST0000' : card,
    card: { uid: opts.test ? 'TEST0000' : card, uid_length: 6, technologies: ['NfcA', 'MifareUltralight'], type: 'mifare_ultralight' },
    security: { authenticated: false, level: 'uid_only' },
    device_id: opts.test ? '00000000-0000-0000-0000-000000000000' : dev.id,
    application_id: ep.application_id ?? apps[0].id,
    delivery_mode: 'relay',
    test: !!opts.test,
    timestamp: now(),
  }
  const raw = JSON.stringify(payload)
  const unsigned = opts.bad === 'unsigned'
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': unsigned ? 'curl/8.5.0' : 'nexTap-Webhook/1.0',
    'content-length': String(raw.length),
  }
  if (!unsigned) {
    Object.assign(headers, {
      'x-nfc-event-id': eventId,
      'x-nfc-timestamp': String(ts),
      'x-nfc-nonce': nonce,
      'x-nfc-device-id': payload.device_id,
      'x-nfc-delivery-mode': 'relay',
      'x-nfc-signature': 'v1=' + hex(32).toLowerCase(),
    })
  }
  const sigStatus: SignatureStatus = unsigned ? 'missing' : !ep.application_id ? 'unverifiable' : opts.bad === 'signature' ? 'invalid' : 'valid'
  const r: SandboxRequest = {
    id: uuid(),
    endpoint_id: ep.id,
    received_at: now(),
    method: 'POST',
    path: `/sandbox/${ep.token}`,
    query: '',
    headers,
    body: raw,
    body_json: payload,
    size_bytes: raw.length,
    source_ip_hash: hex(16).toLowerCase(),
    signature: {
      status: sigStatus,
      mode: unsigned ? null : 'relay',
      reason:
        sigStatus === 'invalid'
          ? 'HMAC mismatch — the body was modified or signed with a different secret (did you rotate it?).'
          : sigStatus === 'unverifiable'
            ? 'No application linked, so there is no secret to verify with.'
            : sigStatus === 'missing'
              ? 'No X-NFC-Signature header.'
              : null,
      error_ref: sigStatus === 'invalid' ? 'NFC-8002' : null,
    },
    checks: unsigned
      ? [{ name: 'Signature headers present', passed: false, detail: 'X-NFC-Signature, X-NFC-Timestamp and X-NFC-Nonce are missing.' }]
      : [
          { name: 'Timestamp skew ≤ 5 min', passed: opts.bad !== 'stale', detail: opts.bad === 'stale' ? 'Timestamp is 15 minutes old — receivers must reject it.' : 'Skew 0.2 s' },
          { name: 'Nonce not reused', passed: true, detail: nonce },
          { name: 'event_id is a UUID', passed: true, detail: eventId },
          { name: 'Payload matches schema', passed: true, detail: null },
          { name: 'Device known', passed: !!opts.test || true, detail: opts.test ? 'Test event (all-zero device id)' : dev.name },
          { name: 'card_id format', passed: true, detail: '^[0-9A-F]{4,64}$' },
        ],
    response_status: ep.response_status,
    response_delay_ms: ep.response_delay_ms,
    event_id: eventId,
    device_id: unsigned ? null : payload.device_id,
  }
  sandboxRequests.unshift(r)
  ep.request_count++
  ep.last_request_at = r.received_at
  if (sandboxRequests.length > 1500) sandboxRequests.length = 1500
  return r
}
for (let i = 0; i < 8; i++) sandboxHit(sandboxes[0], { bad: i === 2 ? 'signature' : i === 5 ? 'unsigned' : i === 6 ? 'stale' : undefined })
setInterval(() => {
  const ep = sandboxes[0]
  if (ep && Math.random() < 0.5) sandboxHit(ep, { bad: Math.random() < 0.15 ? 'signature' : undefined })
}, 5000)

// ---- admin console ----
const platformSettings: PlatformSettings = {
  signups_enabled: { developer: true, business: true },
  request_log_retention_days: 90,
  default_rate_limit: { requests: 120, window_seconds: 60 },
  maintenance_message: null,
}

const adminBusinesses: AdminBusiness[] = [
  ['Acme Café', 'acme-cafe', 'biz_growth', 'active', true],
  ['Kigali Co-working', 'kigali-cowork', 'biz_starter', 'active', false],
  ['Nile Motors', 'nile-motors', 'biz_enterprise', 'active', true],
  ['Blue Door Bakery', 'blue-door', 'biz_starter', 'suspended', true],
].map(([name, slug, plan, status, verified], i) => ({
  id: uuid(),
  name: name as string,
  slug: slug as string,
  email: `hello@${slug}.example`,
  country: 'RW',
  category: 'hospitality',
  status: status as AdminBusiness['status'],
  verified: verified as boolean,
  plan: plan as string,
  created_at: ago((i + 3) * 5 * DAY),
  owner_email: `owner@${slug}.example`,
  stats: { members: 1 + rand(9), devices: rand(8), cards: rand(200), taps_30d: rand(900) },
}))

const fleet: Device[] = Array.from({ length: 14 }, (_, i) => ({
  id: uuid(),
  application_id: uuid(),
  application_name: 'Business Terminal',
  name: `${['Front desk', 'Door', 'Checkout', 'Lobby'][i % 4]} ${i + 1}`,
  platform: 'android',
  model: pick(['Pixel 8', 'Galaxy A54', 'Zebra TC58', 'Redmi Note 13']),
  os_version: 'Android 14',
  app_version: '1.1.0',
  status: i === 13 ? 'revoked' : 'active',
  last_seen_at: ago(i < 6 ? rand(90) * 1000 : (5 + rand(600)) * MIN),
  last_ip: null,
  events_count: rand(900),
  created_at: ago(20 * DAY),
}))

function adminDevices(): AdminDevice[] {
  const online = (d: Device) => d.status === 'active' && !!d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < 2 * MIN
  return [
    ...devices.map((d) => ({ ...d, online: online(d), owner: { id: user.id, email: user.email, full_name: user.full_name }, business: null })),
    ...fleet.map((d, i) => {
      const b = adminBusinesses[i % adminBusinesses.length]
      return { ...d, online: online(d), owner: b.owner_email ? { id: b.id, email: b.owner_email } : null, business: { id: b.id, name: b.name } }
    }),
  ]
}

function allAccounts(): AdminAccount[] {
  return [user, ...otherUsers].map((u, i) => {
    const logs = requestLogs.filter((l) => l.user_id === u.id && Date.now() - new Date(l.created_at).getTime() < DAY)
    const errors = logs.filter((l) => l.outcome !== 'success').length
    const isBiz = u.account_type === 'business' || i % 3 === 2
    return {
      ...u,
      account_type: u.account_type ?? (isBiz ? 'business' : 'developer'),
      email_verified: u.email_verified ?? i % 4 !== 1,
      business: isBiz && u !== user ? { id: adminBusinesses[i % adminBusinesses.length].id, name: adminBusinesses[i % adminBusinesses.length].name, status: adminBusinesses[i % adminBusinesses.length].status } : null,
      stats: {
        requests_24h: logs.length,
        error_rate_24h: logs.length ? errors / logs.length : null,
        events_30d: u === user ? events.length : rand(400),
        devices: u === user ? devices.length : rand(6),
        applications: u === user ? apps.length : rand(4),
        last_active_at: logs[0]?.created_at ?? u.created_at,
      },
    }
  })
}

function adminOverview(range: string): AdminOverview {
  const span = range === '1h' ? HOUR : range === '7d' ? 7 * DAY : range === '30d' ? 30 * DAY : DAY
  const buckets = range === '1h' ? 12 : range === '24h' ? 24 : range === '7d' ? 28 : 30
  const since = Date.now() - span
  const logs = requestLogs.filter((l) => new Date(l.created_at).getTime() >= since)
  const scale = range === '30d' ? 40 : range === '7d' ? 12 : 3
  const lat = logs.map((l) => l.latency_ms).sort((a, b) => a - b)
  const pct = (p: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] : null)
  const byRoute = new Map<string, RequestLog[]>()
  for (const l of logs) byRoute.set(l.route, [...(byRoute.get(l.route) ?? []), l])
  const byErr = new Map<string, number>()
  for (const l of logs) if (l.error_code) byErr.set(l.error_code, (byErr.get(l.error_code) ?? 0) + 1)
  const devs = adminDevices()
  const ok2 = deliveries.filter((d) => d.success).length
  return {
    users: { total: otherUsers.length + 1 + 240, developers: 180, businesses: 61, active_24h: 57, new_in_range: range === '1h' ? 1 : range === '24h' ? 6 : 38 },
    businesses: adminBusinesses.length + 57,
    applications: apps.length + 212,
    devices: {
      total: devs.length,
      online: devs.filter((d) => d.online).length,
      offline: devs.filter((d) => !d.online && d.status === 'active').length,
      revoked: devs.filter((d) => d.status === 'revoked').length,
    },
    events_in_range: events.filter((e) => new Date(e.detected_at).getTime() >= since).length * scale,
    taps_in_range: 320 * scale,
    requests: {
      total: logs.length * scale,
      success: logs.filter((l) => l.outcome === 'success').length * scale,
      client_error: logs.filter((l) => l.outcome === 'client_error').length * scale,
      server_error: logs.filter((l) => l.outcome === 'server_error').length * scale,
      error_rate: logs.length ? logs.filter((l) => l.outcome !== 'success').length / logs.length : 0,
      p50_ms: pct(0.5),
      p95_ms: pct(0.95),
      p99_ms: pct(0.99),
      rpm_now: 18 + rand(30),
    },
    deliveries: { total: deliveries.length, succeeded: ok2, failed: deliveries.length - ok2, success_rate: deliveries.length ? ok2 / deliveries.length : null, queue_depth: rand(12) },
    top_errors: [...byErr.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([error_code, count]) => ({ error_code, error_ref: refFor(error_code), count: count * scale })),
    top_routes: [...byRoute.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 7)
      .map(([route, ls]) => {
        const l2 = ls.map((x) => x.latency_ms).sort((a, b) => a - b)
        return { route, count: ls.length * scale, error_rate: ls.filter((x) => x.outcome !== 'success').length / ls.length, p95_ms: l2[Math.floor(0.95 * (l2.length - 1))] ?? null }
      }),
    timeline: Array.from({ length: buckets }, (_, i) => {
      const start = since + (i * span) / buckets
      const end = since + ((i + 1) * span) / buckets
      const inB = logs.filter((l) => {
        const t = new Date(l.created_at).getTime()
        return t >= start && t < end
      })
      const lb = inB.map((l) => l.latency_ms).sort((a, b) => a - b)
      return {
        bucket: new Date(start).toISOString(),
        requests: inB.length * scale + rand(5),
        errors: inB.filter((l) => l.outcome !== 'success').length * scale,
        p95_ms: lb.length ? lb[Math.floor(0.95 * (lb.length - 1))] : null,
        events: rand(20) * scale,
      }
    }),
  }
}


// =====================================================================================
// Part 3 mock state (web-core): branding, fonts, admin plans & promotions, emails, error center, profiles
// =====================================================================================

const FONTS: FontOption[] = [
  ['Inter', 'sans'], ['Manrope', 'sans'], ['Plus Jakarta Sans', 'sans'], ['DM Sans', 'sans'], ['Outfit', 'sans'], ['Sora', 'sans'],
  ['Space Grotesk', 'sans'], ['IBM Plex Sans', 'sans'], ['Poppins', 'sans'], ['Figtree', 'sans'], ['Lexend', 'sans'], ['Urbanist', 'sans'],
  ['Playfair Display', 'serif'], ['Fraunces', 'serif'], ['JetBrains Mono', 'mono'], ['IBM Plex Mono', 'mono'], ['Fira Code', 'mono'],
].map(([family, category]) => ({ family, category: category as FontOption['category'], google: true, weights: [400, 500, 600, 700] }))

const branding: Branding = {
  product_name: 'nexTap',
  tagline: 'NFC detection → Card ID → Secure delivery',
  logo_url: null,
  logo_dark_url: null,
  favicon_url: null,
  fonts: { heading: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
  theme: { accent_light: '#B91C1C', accent_dark: '#E5484D', default_mode: 'dark' },
  support_email: 'support@example.com',
  company_address: 'KN 4 Ave, Kigali, Rwanda',
  social_links: [{ platform: 'x', url: 'https://x.com/example' }],
  updated_at: now(),
}

function lum(hex: string) {
  const h = hex.replace('#', '')
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrastRatio = (a: string, b: string) => {
  const x = lum(a)
  const y = lum(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

type AdminPromotion = Omit<Promotion, 'status'>
function promoStatus(p: AdminPromotion): PromotionStatus {
  const t = Date.now()
  if (!p.is_active) return 'inactive'
  if (p.max_redemptions != null && p.redemptions >= p.max_redemptions) return 'exhausted'
  if (p.starts_at && Date.parse(p.starts_at) > t) return 'scheduled'
  if (p.ends_at && Date.parse(p.ends_at) <= t) return 'expired'
  return 'active'
}
// Share the landing mock's arrays so admin edits show up on the public pricing page.
for (const p of mockPromotions as unknown as AdminPromotion[]) {
  p.redemptions ??= 42
  p.max_redemptions ??= 500
  p.created_at ??= ago(5 * DAY)
}
;(mockPromotions as unknown as AdminPromotion[]).push(
  {
    id: 'promo-summer', name: 'Summer business deal', code: 'SUMMER20', description: '20% off Growth.', discount_type: 'percent', discount_value: 20,
    currency: null, audience: 'business', plan_codes: ['biz_growth'], starts_at: new Date(Date.now() + 20 * DAY).toISOString(), ends_at: new Date(Date.now() + 50 * DAY).toISOString(),
    is_active: true, show_on_landing: false, banner_text: 'Summer: 20% off Growth', max_redemptions: null, redemptions: 0, created_at: ago(DAY),
  },
  {
    id: 'promo-old', name: 'Beta testers', code: 'BETA', description: '$10 off Pro.', discount_type: 'amount', discount_value: 1000,
    currency: 'usd', audience: 'developer', plan_codes: ['pro'], starts_at: ago(90 * DAY), ends_at: ago(30 * DAY),
    is_active: true, show_on_landing: false, banner_text: null, max_redemptions: 100, redemptions: 61, created_at: ago(95 * DAY),
  },
)
for (const p of mockPlans as unknown as Plan[]) {
  p.is_active ??= true
}
const withPromoStatus = (p: AdminPromotion): Promotion => ({ ...p, status: promoStatus(p) })

// ---- emails ----
const TEMPLATES: EmailTemplate[] = [
  { name: 'verify_email', description: 'Confirms a new account’s email address.' },
  { name: 'password_reset', description: 'One-time link to choose a new password.' },
  { name: 'invitation', description: 'Invites a person to join a business workspace.' },
  { name: 'welcome', description: 'Sent after the email is verified.' },
  { name: 'admin_message', description: 'Messages composed by admins in the console.' },
  { name: 'password_changed', description: 'Security notice after a password change.' },
]
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
function mdToHtml(md: string): string {
  const inline = (t: string) =>
    esc(t)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code style="background:#f3f0f0;padding:1px 4px;border-radius:4px">$1</code>')
      .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, `<a href="$2" style="color:${branding.theme.accent_light}">$1</a>`)
  return md
    .split(/\n{2,}/)
    .map((block) => {
      if (/^#{1,3} /.test(block)) return `<h2 style="font-size:18px;margin:16px 0 8px">${inline(block.replace(/^#{1,3} /, ''))}</h2>`
      if (/^[-*] /m.test(block)) return `<ul style="padding-left:20px;margin:8px 0">${block.split('\n').map((l) => `<li>${inline(l.replace(/^[-*] /, ''))}</li>`).join('')}</ul>`
      return `<p style="margin:0 0 12px;line-height:1.6">${inline(block).replace(/\n/g, '<br>')}</p>`
    })
    .join('')
}
function renderEmail(subject: string, bodyHtml: string, cta?: { label: string; url: string } | null): RenderedEmail {
  const a = branding.theme.accent_light
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><title>${esc(subject)}</title>
<style>@media (prefers-color-scheme: dark){body,.bg{background:#0c0a0a!important}.card{background:#141112!important;color:#f5f1f1!important;border-color:#2a2324!important}.muted{color:#b3acac!important}}</style></head>
<body style="margin:0;background:#f7f5f5;font-family:Inter,Segoe UI,Arial,sans-serif;color:#1c1717">
<table role="presentation" width="100%" class="bg" style="background:#f7f5f5;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="600" style="max-width:600px;width:100%">
<tr><td style="padding:0 4px 16px"><table role="presentation"><tr><td style="background:${a};width:28px;height:28px;border-radius:7px"></td><td style="padding-left:10px;font-weight:600;font-size:15px">${esc(branding.product_name)}</td></tr></table></td></tr>
<tr><td class="card" style="background:#fff;border:1px solid #e7e2e2;border-radius:14px;padding:32px">
<h1 style="font-size:22px;margin:0 0 16px">${esc(subject)}</h1>${bodyHtml}
${cta && cta.label ? `<p style="margin:24px 0 8px"><a href="${esc(cta.url)}" style="display:inline-block;background:${a};color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:9px">${esc(cta.label)}</a></p>` : ''}
</td></tr>
<tr><td class="muted" style="padding:20px 8px;font-size:12px;color:#6f6a6a;line-height:1.6">${esc(branding.product_name)} · ${esc(branding.company_address ?? '')}<br>Questions? ${esc(branding.support_email ?? '')}<br>You received this email because you have an account with ${esc(branding.product_name)}.</td></tr>
</table></td></tr></table></body></html>`
  const text = `${subject}\n\n${bodyHtml.replace(/<[^>]+>/g, '').trim()}${cta?.label ? `\n\n${cta.label}: ${cta.url}` : ''}\n\n— ${branding.product_name}`
  return { html, text }
}
const SAMPLE_BODIES: Record<string, [string, string, { label: string; url: string } | null]> = {
  verify_email: ['Confirm your email', 'Hi Ada,\n\nPlease confirm this is your email address so we can keep your account secure.', { label: 'Verify email', url: '[link removed]' }],
  password_reset: ['Reset your password', 'Someone (hopefully you) asked to reset your password. The link expires in 1 hour.', { label: 'Choose a new password', url: '[link removed]' }],
  invitation: ['You’re invited to Acme Café', '**Bea Owner** invited you to join **Acme Café** as a *manager*.', { label: 'Accept invitation', url: '[link removed]' }],
  welcome: ['Welcome aboard', 'Your account is ready. Here’s how to get your first tap:\n\n- Create an application\n- Pair a phone\n- Tap a card', { label: 'Open dashboard', url: 'https://example.com/dashboard' }],
  admin_message: ['A message from the team', 'This is how messages composed in the admin console look.', { label: 'Learn more', url: 'https://example.com' }],
  password_changed: ['Your password was changed', 'If this wasn’t you, reset your password immediately and contact support.', null],
}

interface MockEmail extends EmailLog {
  html: string
}
const emailLogs: MockEmail[] = []
const campaigns: EmailCampaign[] = []
function logEmail(to: User | { id: string | null; email: string }, template: string, subject: string, rendered: RenderedEmail, campaign_id: string | null) {
  const failed = Math.random() < 0.05
  emailLogs.unshift({
    id: uuid(),
    campaign_id,
    to_email: to.email,
    user_id: to.id,
    template,
    subject,
    status: failed ? 'failed' : 'logged',
    error: failed ? 'SMTP 550: mailbox unavailable' : null,
    sent_by: user.email,
    created_at: now(),
    sent_at: failed ? null : now(),
    html: rendered.html,
  })
  return !failed
}
;(() => {
  for (const [tpl, uIdx] of [['verify_email', 0], ['welcome', 1], ['password_reset', 2], ['invitation', 3]] as const) {
    const [subj, body, cta] = SAMPLE_BODIES[tpl]
    const u = [user, ...otherUsers][uIdx]
    logEmail(u, tpl, subj, renderEmail(subj, mdToHtml(body), cta), null)
  }
})()

// ---- error center ----
function errorStats(code: string, source: string, range: string): ErrorStats | null {
  if (source === 'mobile') return null
  const span = range === '7d' ? 7 * DAY : range === '30d' ? 30 * DAY : DAY
  const since = Date.now() - span
  const buckets = range === '24h' ? 24 : range === '7d' ? 14 : 30
  const matches =
    source === 'delivery'
      ? deliveries.filter((d) => d.error_code === code).map((d) => ({ t: new Date(d.created_at).getTime(), user: user.id, device: null as string | null }))
      : requestLogs.filter((l) => l.error_code === code).map((l) => ({ t: new Date(l.created_at).getTime(), user: l.user_id, device: l.device_id }))
  const inRange = matches.filter((m) => m.t >= since)
  const prev = matches.filter((m) => m.t >= since - span && m.t < since)
  return {
    count: inRange.length,
    previous_count: prev.length,
    last_seen_at: matches.length ? new Date(Math.max(...matches.map((m) => m.t))).toISOString() : null,
    affected_users: new Set(inRange.map((m) => m.user).filter(Boolean)).size,
    affected_devices: new Set(inRange.map((m) => m.device).filter(Boolean)).size,
    trend: Array.from({ length: buckets }, (_, i) => {
      const a = since + (i * span) / buckets
      const b = since + ((i + 1) * span) / buckets
      return { bucket: new Date(a).toISOString(), count: inRange.filter((m) => m.t >= a && m.t < b).length }
    }),
  }
}

function handleCore3(method: string, path: string, q: Query, body: Body, token: string | null): RawResponse | null {
  const seg = path.split('/').filter(Boolean)
  const is = (m: string, pattern: string) => {
    if (m !== method) return false
    const p = pattern.split('/').filter(Boolean)
    return p.length === seg.length && p.every((x, i) => x.startsWith(':') || x === seg[i])
  }
  if (is('GET', '/meta/branding')) return ok(branding)
  if (is('GET', '/meta/fonts')) return ok(FONTS)

  const owned =
    path === '/auth/me/avatar' ||
    path === '/billing/promotions/validate' ||
    /^\/admin\/(branding|plans|promotions|emails|email-campaigns|email-templates|errors)(\/|$)/.test(path) ||
    /^\/admin\/accounts\/([^/]+\/)?(send-verification|avatar)$/.test(path)
  if (!owned) return null
  if (!token || !loggedIn) return fail(401, 'not_authenticated', 'Not authenticated')

  if (is('POST', '/auth/me/avatar')) {
    if (typeof body.file_size === 'number' && body.file_size > 2 * 1024 * 1024) return fail(413, 'file_too_large', 'Avatar must be 2 MB or smaller.')
    user.avatar_url = String(body.file_url ?? '')
    savePersona()
    return ok(withMemberships(token))
  }
  if (is('DELETE', '/auth/me/avatar')) {
    user.avatar_url = null
    savePersona()
    return ok(withMemberships(token))
  }
  if (is('POST', '/billing/promotions/validate')) {
    const code = String(body.code ?? '').toUpperCase()
    const plan = mockPublicPlans().find((p) => p.code === body.plan_code)
    const promo = (mockPromotions as unknown as AdminPromotion[]).find((p) => p.code === code && promoStatus(p) === 'active')
    if (!promo || !plan) return ok({ valid: false, promotion: null, discounted_price_monthly_cents: null })
    const monthly = plan.price_monthly_cents ?? 0
    const off = promo.discount_type === 'percent' ? Math.round((monthly * promo.discount_value) / 100) : promo.discount_value
    return ok({ valid: true, promotion: promo, discounted_price_monthly_cents: Math.max(0, monthly - off) })
  }

  if (user.role !== 'admin') return fail(403, 'forbidden', 'Admin only')

  // branding
  if (is('PATCH', '/admin/branding')) {
    const t = (body.theme ?? {}) as Partial<Branding['theme']>
    for (const [k, bg] of [['accent_light', '#ffffff'], ['accent_dark', '#141112']] as const) {
      const v = t[k]
      if (v === undefined) continue
      if (!/^#[0-9a-f]{6}$/i.test(v)) return fail(422, 'validation_error', 'Validation failed', [{ field: `body.theme.${k}`, message: 'Use a 6-digit hex colour' }])
      if (contrastRatio(v, bg) < 3) return fail(422, 'branding_low_contrast', `${k} has ${contrastRatio(v, bg).toFixed(2)}:1 contrast against the ${k === 'accent_light' ? 'light' : 'dark'} background (min 3:1).`, { field: k })
    }
    const f = (body.fonts ?? {}) as Partial<Branding['fonts']>
    for (const fam of Object.values(f)) if (fam && !FONTS.some((x) => x.family === fam)) return fail(422, 'validation_error', 'Validation failed', [{ field: 'body.fonts', message: `${fam} is not in the curated list` }])
    Object.assign(branding, { ...body, fonts: { ...branding.fonts, ...f }, theme: { ...branding.theme, ...t }, updated_at: now() })
    log('admin.branding_update', 'branding', null)
    return ok(branding)
  }
  if (is('POST', '/admin/branding/assets') || is('DELETE', '/admin/branding/assets')) {
    const variant = String(q?.variant ?? '')
    const key = variant === 'logo' ? 'logo_url' : variant === 'logo_dark' ? 'logo_dark_url' : variant === 'favicon' ? 'favicon_url' : null
    if (!key) return fail(422, 'validation_error', 'Validation failed', [{ field: 'query.variant', message: 'logo | logo_dark | favicon' }])
    if (method === 'POST' && typeof body.file_size === 'number' && body.file_size > 1024 * 1024) return fail(413, 'file_too_large', 'Branding assets must be 1 MB or smaller.')
    branding[key] = method === 'POST' ? String(body.file_url ?? '') : null
    branding.updated_at = now()
    return ok(branding)
  }

  // plans
  const plans3 = mockPlans as unknown as Plan[]
  if (is('GET', '/admin/plans')) return ok([...plans3].sort((a, b) => (a.audience === b.audience ? (a.sort_order ?? 0) - (b.sort_order ?? 0) : a.audience === 'developer' ? -1 : 1)))
  if (is('POST', '/admin/plans')) {
    const code = String(body.code ?? '').trim()
    if (!/^[a-z0-9_]{2,32}$/.test(code)) return fail(422, 'validation_error', 'Validation failed', [{ field: 'body.code', message: 'Lowercase letters, digits and _ (2–32)' }])
    if (plans3.some((p) => p.code === code)) return fail(409, 'plan_exists', 'A plan with this code already exists.')
    const p = { features: [], currency: 'usd', is_active: true, is_featured: false, sort_order: plans3.length + 1, ...body, code } as unknown as Plan
    plans3.push(p)
    return ok(p, 201)
  }
  if (seg[0] === 'admin' && seg[1] === 'plans' && seg[2]) {
    const p = plans3.find((x) => x.code === decodeURIComponent(seg[2]))
    if (!p) return fail(404, 'not_found', 'Plan not found')
    if (is('PATCH', '/admin/plans/:code')) {
      const { code: _c, ...rest } = body
      Object.assign(p, rest)
      return ok(p)
    }
    if (is('POST', '/admin/plans/:code/activate')) return ok(Object.assign(p, { is_active: true }))
    if (is('POST', '/admin/plans/:code/deactivate')) return ok(Object.assign(p, { is_active: false }))
  }

  // promotions
  const promos = mockPromotions as unknown as AdminPromotion[]
  if (is('GET', '/admin/promotions')) return ok(promos.map(withPromoStatus))
  if (is('POST', '/admin/promotions')) {
    if (!String(body.name ?? '').trim()) return fail(422, 'validation_error', 'Validation failed', [{ field: 'body.name', message: 'Field required' }])
    const code = body.code ? String(body.code).toUpperCase() : null
    if (code && promos.some((p) => p.code === code)) return fail(409, 'promotion_code_exists', 'Another promotion already uses this code.')
    const p = {
      description: null, discount_type: 'percent', discount_value: 10, currency: null, audience: 'all', plan_codes: [], starts_at: null, ends_at: null,
      is_active: true, show_on_landing: false, banner_text: null, max_redemptions: null, ...body, code, id: uuid(), redemptions: 0, created_at: now(),
    } as unknown as AdminPromotion
    promos.push(p)
    return ok(withPromoStatus(p), 201)
  }
  if (seg[0] === 'admin' && seg[1] === 'promotions' && seg[2]) {
    const p = promos.find((x) => x.id === seg[2])
    if (!p) return fail(404, 'not_found', 'Promotion not found')
    if (is('GET', '/admin/promotions/:id')) return ok(withPromoStatus(p))
    if (is('PATCH', '/admin/promotions/:id')) {
      Object.assign(p, body, body.code ? { code: String(body.code).toUpperCase() } : {})
      return ok(withPromoStatus(p))
    }
    if (is('DELETE', '/admin/promotions/:id')) {
      promos.splice(promos.indexOf(p), 1)
      return ok(null, 204)
    }
    if (is('POST', '/admin/promotions/:id/activate')) return ok(withPromoStatus(Object.assign(p, { is_active: true })))
    if (is('POST', '/admin/promotions/:id/deactivate')) return ok(withPromoStatus(Object.assign(p, { is_active: false })))
  }

  // emails
  const recipientsFor = (b: Body): User[] => {
    const all = [user, ...otherUsers]
    if (Array.isArray(b.user_ids)) return all.filter((u) => (b.user_ids as string[]).includes(u.id))
    const f = (b.filter ?? {}) as EmailFilter
    return allAccounts().filter(
      (u) =>
        (!f.account_type || u.account_type === f.account_type) &&
        (!f.status || (f.status === 'active' ? u.is_active : !u.is_active)) &&
        (f.email_verified == null || u.email_verified === f.email_verified) &&
        (!f.plan_code || u.plan === f.plan_code),
    )
  }
  if (is('POST', '/admin/emails/preview')) {
    const cta = body.cta as { label: string; url: string } | undefined
    return ok(renderEmail(String(body.subject ?? ''), mdToHtml(String(body.body_markdown ?? '')), cta))
  }
  if (is('POST', '/admin/emails')) {
    if (!!body.user_ids === !!body.filter) return fail(422, 'validation_error', 'Validation failed', [{ field: 'body', message: 'Provide exactly one of user_ids or filter' }])
    if (!String(body.subject ?? '').trim() || !String(body.body_markdown ?? '').trim())
      return fail(422, 'validation_error', 'Validation failed', [{ field: 'body.subject', message: 'Subject and body are required' }])
    const rcpt = recipientsFor(body)
    if (!rcpt.length) return fail(422, 'no_recipients', 'No users match these recipients.')
    const id = uuid()
    const subj = String(body.subject)
    const rendered = renderEmail(subj, mdToHtml(String(body.body_markdown)), body.cta as { label: string; url: string } | undefined)
    let okN = 0
    for (const u of rcpt) if (logEmail(u, 'admin_message', subj, rendered, id)) okN++
    campaigns.unshift({ id, subject: subj, recipients: rcpt.length, sent: 0, failed: rcpt.length - okN, logged: okN, created_by: user.email, created_at: now() })
    log('admin.email_send', 'email_campaign', id)
    return ok({ campaign_id: id, recipients: rcpt.length }, 202)
  }
  if (is('GET', '/admin/emails')) {
    const qq = String(q?.q ?? '').toLowerCase()
    const list = emailLogs.filter(
      (e) => (!q?.campaign_id || e.campaign_id === q.campaign_id) && (!q?.status || e.status === q.status) && (!qq || e.to_email.includes(qq) || e.subject.toLowerCase().includes(qq)),
    )
    return ok(paginate(list.map(({ html: _h, ...rest }) => rest), q))
  }
  if (is('GET', '/admin/emails/:id')) {
    const e = emailLogs.find((x) => x.id === seg[2])
    return e ? ok(e) : fail(404, 'not_found', 'Email not found')
  }
  if (is('GET', '/admin/email-campaigns')) return ok(paginate(campaigns, q))
  if (is('GET', '/admin/email-templates')) return ok(TEMPLATES)
  if (is('GET', '/admin/email-templates/:name/preview')) {
    const s3 = SAMPLE_BODIES[seg[2]]
    if (!s3) return fail(404, 'not_found', 'Template not found')
    return ok(renderEmail(s3[0], mdToHtml(s3[1]), s3[2]))
  }

  // accounts: verification + avatar
  if (is('POST', '/admin/accounts/send-verification')) {
    const ids = (body.user_ids as string[]) ?? []
    const targets = [user, ...otherUsers].filter((u) => ids.includes(u.id))
    const unverified = targets.filter((u) => !u.email_verified)
    for (const u of unverified) logEmail(u, 'verify_email', 'Confirm your email', renderEmail('Confirm your email', mdToHtml(SAMPLE_BODIES.verify_email[1]), SAMPLE_BODIES.verify_email[2]), null)
    return ok({ sent: unverified.length, skipped_already_verified: targets.length - unverified.length }, 202)
  }
  if (is('POST', '/admin/accounts/:id/send-verification')) {
    const u = [user, ...otherUsers].find((x) => x.id === seg[2])
    if (!u) return fail(404, 'not_found', 'Account not found')
    if (u.email_verified) return fail(409, 'email_already_verified', 'This email address is already verified.')
    logEmail(u, 'verify_email', 'Confirm your email', renderEmail('Confirm your email', mdToHtml(SAMPLE_BODIES.verify_email[1]), SAMPLE_BODIES.verify_email[2]), null)
    return ok({ dev_verification_url: `${location.origin}/verify-email?token=mock-${urlsafe(12)}` }, 202)
  }
  if (is('DELETE', '/admin/accounts/:id/avatar')) {
    const u = [user, ...otherUsers].find((x) => x.id === seg[2])
    if (!u) return fail(404, 'not_found', 'Account not found')
    u.avatar_url = null
    return ok(null, 204)
  }

  // error center
  if (is('GET', '/admin/errors')) {
    const range = String(q?.range ?? '24h')
    const qq = String(q?.q ?? '').toLowerCase()
    const list = mockErrorCatalog
      .filter((e) => (!q?.source || e.source === q.source) && (!qq || `${e.code} ${e.ref} ${e.title} ${e.description}`.toLowerCase().includes(qq)))
      .map((e) => ({ ...e, stats: errorStats(e.code, e.source, range) }))
      .filter((e) => String(q?.only_occurring) !== 'true' || (e.stats?.count ?? 0) > 0)
    return ok(list)
  }
  if (is('GET', '/admin/errors/:ref')) {
    const e = mockErrorCatalog.find((x) => x.ref === decodeURIComponent(seg[2]))
    if (!e) return fail(404, 'not_found', 'Unknown error reference')
    const range = String(q?.range ?? '7d')
    const logs = requestLogs.filter((l) => l.error_code === e.code)
    const byRoute = new Map<string, number>()
    for (const l of logs) byRoute.set(l.route, (byRoute.get(l.route) ?? 0) + 1)
    const byUser = new Map<string, number>()
    for (const l of logs) if (l.user_id) byUser.set(l.user_id, (byUser.get(l.user_id) ?? 0) + 1)
    const emails = new Map([user, ...otherUsers].map((u) => [u.id, u.email]))
    return ok({
      ...e,
      stats: errorStats(e.code, e.source, range),
      top_routes: [...byRoute.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([route, count]) => ({ route, count })),
      top_users: [...byUser.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, count]) => ({ id, email: emails.get(id) ?? id, count })),
      recent: logs.slice(0, 20),
      recent_deliveries: deliveries.filter((d) => d.error_code === e.code).slice(0, 20),
    })
  }
  return null
}


// =====================================================================================
// Part 3 §7–10 mocks (web-core): preferences, live stream, app releases, notifications
// =====================================================================================

// ---- notifications ----
const notifications: AppNotification[] = [
  { id: uuid(), type: 'app_build.succeeded', title: 'APK 1.3.0 is ready', body: 'Build #14 finished in 6 min and was published.', link: '/admin/releases', severity: 'success', read_at: null, created_at: ago(3 * HOUR) },
  { id: uuid(), type: 'system', title: 'Welcome to notifications', body: 'Builds, failures and other events show up here.', link: null, severity: 'info', read_at: ago(DAY), created_at: ago(2 * DAY) },
]
function notify(n: Omit<AppNotification, 'id' | 'read_at' | 'created_at'>) {
  notifications.unshift({ ...n, id: uuid(), read_at: null, created_at: now() })
}
setBusinessNotifier((n) => notify(n as Omit<AppNotification, 'id' | 'read_at' | 'created_at'>))

// ---- app releases ----
const releases: AppRelease[] = [
  {
    id: uuid(), version_name: '1.3.0', build_number: 14, channel: 'stable', build_type: 'release', api_base_url: 'http://192.168.1.10:8000',
    file_size: mockAppRelease.file_size, sha256: mockAppRelease.sha256, status: 'succeeded', is_published: true, notes: 'QR pairing, dark-red theme, error refs.',
    log_excerpt: 'Running Gradle task \'assembleRelease\'...\n✓ Built build/app/outputs/flutter-apk/app-release.apk (21.5MB).', started_at: ago(3 * HOUR + 6 * MIN),
    finished_at: ago(3 * HOUR), created_by: 'admin@example.com', created_at: ago(3 * HOUR + 7 * MIN), download_url: '/downloads/android/latest', downloads: 128,
  },
  {
    id: uuid(), version_name: '1.2.1', build_number: 13, channel: 'beta', build_type: 'debug', api_base_url: 'http://192.168.1.10:8000',
    file_size: null, sha256: null, status: 'failed', is_published: false, notes: null,
    log_excerpt: 'FAILURE: Build failed with an exception.\n* What went wrong:\nExecution failed for task \':app:compileFlutterBuildDebug\'.', started_at: ago(2 * DAY),
    finished_at: ago(2 * DAY - 4 * MIN), created_by: 'admin@example.com', created_at: ago(2 * DAY), download_url: null, downloads: 0,
  },
]
const BUILD_STEPS = [
  '$ flutter build apk --release --build-name={v} --build-number={n} --dart-define=API_BASE_URL={u}',
  'Resolving dependencies...',
  'Got dependencies!',
  "Running Gradle task 'assembleRelease'...",
  'Font asset "MaterialIcons-Regular.otf" was tree-shaken, reducing it from 1645184 to 3464 bytes (99.8% reduction).',
  "Running Gradle task 'assembleRelease'... 62.4s",
  '✓ Built build/app/outputs/flutter-apk/app-release.apk (21.7MB).',
]
function runBuild(r: AppRelease, publish: boolean) {
  let i = 0
  const lines: string[] = []
  const tick = setInterval(() => {
    if (r.status === 'cancelled') return clearInterval(tick)
    if (i === 0) {
      r.status = 'building'
      r.started_at = now()
    }
    if (i < BUILD_STEPS.length) {
      lines.push(BUILD_STEPS[i].replace('{v}', r.version_name).replace('{n}', String(r.build_number)).replace('{u}', r.api_base_url))
      r.log_excerpt = lines.join('\n')
      i++
      return
    }
    clearInterval(tick)
    r.status = 'succeeded'
    r.finished_at = now()
    r.file_size = 22_700_000 + rand(300_000)
    r.sha256 = hex(32).toLowerCase()
    r.download_url = `/downloads/android/${r.id}`
    if (publish && r.channel === 'stable') publishRelease(r)
    notify({ type: 'app_build.succeeded', title: `APK ${r.version_name} build finished`, body: `Build #${r.build_number} succeeded${publish ? ' and was published' : ''}.`, link: '/admin/releases', severity: 'success' })
  }, 1500)
}
function publishRelease(r: AppRelease) {
  for (const x of releases) if (x.channel === r.channel) x.is_published = false
  r.is_published = true
  if (r.channel === 'stable') {
    Object.assign(mockAppRelease, {
      version_name: r.version_name,
      build_number: r.build_number,
      file_size: r.file_size ?? mockAppRelease.file_size,
      sha256: r.sha256 ?? mockAppRelease.sha256,
      published_at: now(),
    })
  }
}

// ---- live stream ----
/** Simulated `GET /live/applications/{id}` stream: emits a tap + delivery every few seconds while open. */
export async function mockLiveStream(
  appId: string,
  opts: { signal: AbortSignal; onOpen?: () => void; onMessage: (m: LiveMessage) => void },
): Promise<void> {
  const app = apps.find((a) => a.id === appId) ?? apps[0]
  await new Promise((r) => setTimeout(r, 300))
  if (opts.signal.aborted) return
  opts.onOpen?.()
  const sandbox = sandboxes.find((sb) => sb.url === app.endpoint.url)
  const emit = () => {
    const dev = pick(devices.filter((d) => d.application_id === app.id && d.status === 'active')) ?? devices[0]
    const eventId = uuid()
    const card = '04' + hex(6)
    const received: LiveEventReceived = {
      event_id: eventId, card_id: card, card_type: pick(['mifare_ultralight', 'ntag215', 'mifare_classic', null]),
      card_technologies: ['NfcA', 'MifareUltralight'], device_id: dev.id, device_name: dev.name, detected_at: now(), delivery_mode: app.delivery_mode,
    }
    opts.onMessage({ type: 'event.received', data: received })
    const payload = {
      event_id: eventId, event: 'card.detected', card_id: card,
      card: { uid: card, uid_length: 7, technologies: received.card_technologies, type: received.card_type },
      security: { authenticated: false, level: 'uid_only' }, device_id: dev.id, application_id: app.id,
      delivery_mode: app.delivery_mode, test: false, timestamp: received.detected_at,
    }
    setTimeout(() => {
      if (opts.signal.aborted) return
      const status = sandbox ? sandbox.response_status : Math.random() < 0.8 ? 200 : pick([500, 502, 404])
      const timeout = !sandbox && Math.random() < 0.08
      const success = !timeout && status >= 200 && status < 300
      const code = timeout ? 'delivery_timeout' : success ? null : status >= 500 ? 'delivery_http_5xx' : 'delivery_http_4xx'
      const attempt: LiveDeliveryAttempt = {
        event_id: eventId, attempt: 1, mode: app.delivery_mode, url: app.endpoint.url ?? '(no endpoint)', success,
        status_code: timeout ? null : status, latency_ms: timeout ? 10_000 : 60 + rand(250), error_code: code, error_ref: code ? refFor(code) : null,
        response_excerpt: timeout ? null : sandbox ? sandbox.response_body : success ? '{"received":true}' : '<html><body>Bad Gateway</body></html>',
        response_headers: timeout ? null : { 'content-type': success || sandbox ? 'application/json' : 'text/html', 'content-length': '17' },
        request_payload: payload,
      }
      opts.onMessage({ type: 'delivery.attempt', data: attempt })
      if (sandbox) {
        const req = sandboxHit(sandbox, {})
        opts.onMessage({
          type: 'sandbox.request',
          data: { endpoint_id: sandbox.id, request_id: req.id, event_id: eventId, signature_status: req.signature.status, checks_failed: req.checks.filter((c) => !c.passed).length, response_status: req.response_status },
        })
      }
    }, 450 + rand(500))
  }
  await new Promise<void>((resolve) => {
    const first = setTimeout(emit, 1800)
    const t = setInterval(emit, 5000 + rand(2500))
    opts.signal.addEventListener('abort', () => {
      clearTimeout(first)
      clearInterval(t)
      resolve()
    })
  })
}

function handleCore4(method: string, path: string, q: Query, body: Body, token: string | null): RawResponse | null {
  const seg = path.split('/').filter(Boolean)
  const is = (m: string, pattern: string) => {
    if (m !== method) return false
    const p = pattern.split('/').filter(Boolean)
    return p.length === seg.length && p.every((x, i) => x.startsWith(':') || x === seg[i])
  }
  const owned = path === '/auth/me/preferences' || path.startsWith('/notifications') || path.startsWith('/admin/app-releases')
  if (!owned) return null
  if (!token || !loggedIn) return fail(401, 'not_authenticated', 'Not authenticated')

  if (is('PATCH', '/auth/me/preferences')) {
    user.preferences = { ...(user.preferences ?? {}), ...body }
    return ok(withMemberships(token))
  }
  if (is('GET', '/notifications')) {
    const list = notifications.filter((n) => String(q?.unread) !== 'true' || !n.read_at)
    return ok(paginate(list, q))
  }
  if (is('GET', '/notifications/unread-count')) return ok({ count: notifications.filter((n) => !n.read_at).length })
  if (is('POST', '/notifications/read-all')) {
    for (const n of notifications) n.read_at ??= now()
    return ok(null, 204)
  }
  if (is('POST', '/notifications/:id/read')) {
    const n = notifications.find((x) => x.id === seg[1])
    if (!n) return fail(404, 'not_found', 'Notification not found')
    n.read_at ??= now()
    return ok(n)
  }

  if (user.role !== 'admin') return fail(403, 'forbidden', 'Admin only')
  if (is('GET', '/admin/app-releases')) return ok(paginate(releases, q))
  if (is('POST', '/admin/app-releases')) {
    if (releases.some((r) => r.status === 'queued' || r.status === 'building')) return fail(409, 'build_in_progress', 'Another build is already running.')
    const url = String(body.api_base_url ?? 'http://192.168.1.10:8000')
    if (!/^https?:\/\/[^\s]+$/.test(url)) return fail(422, 'validation_error', 'Validation failed', [{ field: 'body.api_base_url', message: 'Must be an http(s) URL' }])
    const top = Math.max(0, ...releases.map((r) => r.build_number))
    const r: AppRelease = {
      id: uuid(), version_name: String(body.version_name || '1.3.1'), build_number: Number(body.build_number) || top + 1,
      channel: body.channel === 'beta' ? 'beta' : 'stable', build_type: body.build_type === 'debug' ? 'debug' : 'release', api_base_url: url,
      file_size: null, sha256: null, status: 'queued', is_published: false, notes: (body.notes as string) || null, log_excerpt: 'Queued — waiting for the worker…',
      started_at: null, finished_at: null, created_by: user.email, created_at: now(), download_url: null, downloads: 0,
    }
    releases.unshift(r)
    runBuild(r, !!body.publish_on_success)
    return ok(r, 202)
  }
  if (seg[0] === 'admin' && seg[1] === 'app-releases' && seg[2]) {
    const r = releases.find((x) => x.id === seg[2])
    if (!r) return fail(404, 'not_found', 'Release not found')
    if (is('GET', '/admin/app-releases/:id')) return ok(q?.log === 'full' ? { ...r, log: `${r.log_excerpt ?? ''}\n\n[full log — ${BUILD_STEPS.length * 40} lines in the real build]` } : r)
    if (is('POST', '/admin/app-releases/:id/cancel')) {
      if (r.status !== 'queued' && r.status !== 'building') return fail(409, 'build_not_running', 'This build is not running.')
      r.status = 'cancelled'
      r.finished_at = now()
      return ok(r)
    }
    if (is('POST', '/admin/app-releases/:id/publish')) {
      if (r.status !== 'succeeded') return fail(409, 'release_not_ready', 'Only successful builds can be published.')
      publishRelease(r)
      return ok(r)
    }
    if (is('POST', '/admin/app-releases/:id/unpublish')) {
      r.is_published = false
      return ok(r)
    }
    if (is('DELETE', '/admin/app-releases/:id')) {
      if (r.is_published) return fail(409, 'release_published', 'Unpublish the release before deleting it.')
      releases.splice(releases.indexOf(r), 1)
      return ok(null, 204)
    }
  }
  return null
}

// ---------- routing ----------

function appOr404(id: string) {
  return apps.find((a) => a.id === id)
}

function handle(method: string, path: string, q: Query, body: Body, token: string | null): RawResponse {
  const seg = path.split('/').filter(Boolean)
  // Public pricing with Part 3 plan fields + promotions (landing page); before the business delegate.
  if (method === 'GET' && path === '/billing/plans') return ok(mockPublicPlans(q?.audience))
  if (method === 'GET' && path === '/billing/promotions/active') return ok(mockActivePromotions())
  if (method === 'GET' && path === '/meta/app-release') return ok(mockAppRelease)
  // Part 3 core (branding, pricing admin, emails, error center, avatars).
  const c3 = handleCore3(method, path, q, body, token)
  if (c3) return c3
  const c4 = handleCore4(method, path, q, body, token)
  if (c4) return c4
  // Business domain (Part 2) — delegated; returns null for routes it doesn't own.
  // Personal accounts & digital cards (Part 4) — delegated; returns null for routes it doesn't own.
  const personal = handlePersonalMock(method, path, q, body, token && loggedIn ? token : null)
  if (personal) return personal
  const biz = handleBusinessMock(method, path, q, body, token && loggedIn ? token : null)
  if (biz) return biz
  const is = (m: string, pattern: string) => {
    if (m !== method) return false
    const p = pattern.split('/').filter(Boolean)
    return p.length === seg.length && p.every((x, i) => x.startsWith(':') || x === seg[i])
  }

  // --- auth (public) ---
  if (is('POST', '/auth/login') || is('POST', '/auth/register')) {
    const email = String(body.email ?? '')
    const password = String(body.password ?? '')
    if (!email.includes('@')) return fail(422, 'validation_error', 'Validation failed', [{ field: 'body.email', message: 'value is not a valid email address' }])
    if (password.length < 10) {
      return path.endsWith('login')
        ? fail(401, 'invalid_credentials', 'Invalid email or password')
        : fail(422, 'validation_error', 'Validation failed', [{ field: 'body.password', message: 'String should have at least 10 characters' }])
    }
    const registering = path.endsWith('register')
    user.email = email
    if (body.full_name) user.full_name = String(body.full_name)
    // Mock personas: "admin…" → admin console, "business…" / business sign-up → business, else developer.
    const business = registering ? body.account_type === 'business' : /business/i.test(email)
    const personal = registering ? body.account_type === 'personal' : /personal/i.test(email)
    user.role = /admin/i.test(email) ? 'admin' : 'developer'
    user.account_type = business ? 'business' : personal ? 'personal' : 'developer'
    if (personal && typeof body.phone === 'string' && body.phone) user.phone = body.phone
    if (registering && typeof body.country === 'string' && body.country) user.country = body.country
    user.email_verified = registering ? false : !/unverified/i.test(email)
    loggedIn = true
    savePersona()
    log(registering ? 'user.register' : 'user.login', 'user', user.id)
    return ok(
      {
        status: 'ok',
        access_token: 'mock.' + urlsafe(24),
        token_type: 'bearer',
        expires_in: 3600,
        user: withMemberships(token),
        dev_verification_url: registering ? `${location.origin}/verify-email?token=mock-${urlsafe(16)}` : null,
      },
      registering ? 201 : 200,
    )
  }
  if (is('POST', '/auth/verify-email')) {
    const t = String(body.token ?? '')
    if (!t || t === 'expired') return fail(400, 'invalid_token', 'This verification link is invalid or has expired.')
    user.email_verified = true
    user.email_verified_at = now()
    savePersona()
    return ok(null, 204)
  }
  if (is('GET', '/meta/status')) {
    return ok({ maintenance_message: platformSettings.maintenance_message, public_api_url: 'http://192.168.1.10:8000', public_web_url: location.origin, version: '1.1.0' })
  }
  // Public error catalog (docs) — Part 2 §A1.
  if (is('GET', '/errors')) return ok(mockErrorCatalog)
  if (is('POST', '/auth/forgot-password')) return ok(null, 202)
  if (is('POST', '/auth/reset-password')) {
    if (String(body.token) === 'expired') return fail(400, 'invalid_token', 'This reset link is invalid or has expired.')
    return ok(null, 204)
  }

  if (!token || !loggedIn) return fail(401, 'not_authenticated', 'Not authenticated')

  if (is('GET', '/auth/me')) return ok(withMemberships(token))
  if (is('POST', '/auth/resend-verification')) {
    if (user.email_verified) return ok(null, 202)
    return ok({ dev_verification_url: `${location.origin}/verify-email?token=mock-${urlsafe(16)}` }, 202)
  }
  if (is('PATCH', '/auth/me')) {
    if (typeof body.full_name === 'string') user.full_name = body.full_name
    for (const k of ['phone', 'company', 'country', 'job_title'] as const) if (k in body) user[k] = (body[k] as string | null) || null
    savePersona()
    return ok(withMemberships(token))
  }
  if (is('POST', '/auth/logout')) return ok(null, 204)
  if (is('GET', '/auth/sessions')) {
    return ok({ web: { id: 'mock-web', kind: 'web', device_name: 'This browser', via: 'password', created_at: now(), last_seen_at: now(), current: true }, mobile: null })
  }
  if (is('DELETE', '/auth/sessions/mobile')) return ok(null, 204)
  if (is('GET', '/auth/passkeys')) return ok([])
  if (path.startsWith('/auth/passkeys')) return fail(400, 'passkey_invalid', 'Passkeys are not available in mock mode')
  if (is('GET', '/admin/demographics')) {
    const by_country = [
      { country: 'RW', users: 42, developer: 12, business: 10, personal: 20, active_30d: 30, new_30d: 6 },
      { country: 'KE', users: 18, developer: 6, business: 4, personal: 8, active_30d: 11, new_30d: 3 },
      { country: 'US', users: 9, developer: 7, business: 1, personal: 1, active_30d: 5, new_30d: 1 },
      { country: null, users: 4, developer: 3, business: 1, personal: 0, active_30d: 1, new_30d: 0 },
    ]
    const sum = (k: 'users' | 'developer' | 'business' | 'personal' | 'active_30d' | 'new_30d') => by_country.reduce((s, r) => s + r[k], 0)
    const d = new Date()
    return ok({
      total_users: sum('users'),
      countries: 3,
      without_country: 4,
      active_30d: sum('active_30d'),
      new_30d: sum('new_30d'),
      by_account_type: { developer: sum('developer'), business: sum('business'), personal: sum('personal') },
      by_country,
      signups_by_month: Array.from({ length: 12 }, (_, i) => {
        const m = new Date(d.getFullYear(), d.getMonth() - 11 + i, 1)
        return { month: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`, users: (i * 7) % 11 }
      }),
    })
  }
  if (is('POST', '/auth/change-password')) {
    if (String(body.current_password ?? '').length < 10) return fail(401, 'invalid_credentials', 'Current password is incorrect')
    log('user.password_change', 'user', user.id)
    return ok(null, 204)
  }

  if (is('GET', '/meta')) {
    return ok({ device_server_url: 'http://192.168.1.10:8000', environment: 'development', version: '1.0.0' })
  }

  // --- overview ---
  if (is('GET', '/overview')) {
    const today = new Date().toISOString().slice(0, 10)
    const month = today.slice(0, 7)
    const monthEvents = events.filter((e) => e.detected_at.startsWith(month))
    const done = monthEvents.filter((e) => e.status === 'delivered' || e.status === 'failed')
    return ok({
      applications: apps.length,
      active_devices: devices.filter((d) => d.status === 'active').length,
      active_api_keys: keys.filter((k) => k.is_active).length,
      events_today: events.filter((e) => e.detected_at.startsWith(today)).length,
      events_this_month: monthEvents.length,
      delivery_success_rate: done.length ? done.filter((e) => e.status === 'delivered').length / done.length : null,
      recent_events: events.slice(0, 10),
    })
  }

  // --- applications ---
  if (is('GET', '/applications')) return ok(apps)
  if (is('POST', '/applications')) {
    if (apps.length >= 3) return fail(402, 'plan_limit_reached', 'Your Free plan allows 3 applications.')
    const name = String(body.name ?? '').trim()
    if (!name) return fail(422, 'validation_error', 'Validation failed', [{ field: 'body.name', message: 'Field required' }])
    const secret = (body.webhook_secret as string) || `whsec_${urlsafe(43)}`
    const app: Application = {
      id: uuid(),
      name,
      description: (body.description as string) ?? null,
      is_active: true,
      delivery_mode: (body.delivery_mode as Application['delivery_mode']) ?? 'relay',
      endpoint: { ...endpoint((body.endpoint_url as string) || null), custom_headers: {}, last_tested_at: null, last_test_success: null },
      webhook_secret: { configured: true, last4: secret.slice(-4), rotated_at: null },
      allowed_domains: [],
      device_count: 0,
      created_at: now(),
      updated_at: now(),
    }
    apps.push(app)
    const plaintext = `nfc_${urlsafe(48)}`
    const key: ApiKey = { id: uuid(), application_id: app.id, application_name: app.name, name: 'Default key', prefix: plaintext.slice(0, 12), last4: plaintext.slice(-4), created_at: now(), last_used_at: null, revoked_at: null, is_active: true }
    keys.unshift(key)
    log('application.create', 'application', app.id)
    return ok({ application: app, api_key: key, api_key_plaintext: plaintext, webhook_secret_plaintext: secret }, 201)
  }
  if (seg[0] === 'applications' && seg[1]) {
    const app = appOr404(seg[1])
    if (!app) return fail(404, 'not_found', 'Application not found')
    if (is('GET', '/applications/:id')) return ok(app)
    if (is('PATCH', '/applications/:id')) {
      if (typeof body.name === 'string') app.name = body.name
      if (typeof body.description === 'string') app.description = body.description
      if (typeof body.is_active === 'boolean') app.is_active = body.is_active
      app.updated_at = now()
      log('application.update', 'application', app.id)
      return ok(app)
    }
    if (is('DELETE', '/applications/:id')) {
      apps.splice(apps.indexOf(app), 1)
      keys.forEach((k) => k.application_id === app.id && ((k.is_active = false), (k.revoked_at = now())))
      devices.forEach((d) => d.application_id === app.id && (d.status = 'revoked'))
      log('application.delete', 'application', app.id)
      return ok(null, 204)
    }
    if (is('PUT', '/applications/:id/endpoint')) {
      const url = body.url as string | null
      if (url && !/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)/.test(url)) {
        return fail(422, 'validation_error', 'Validation failed', [{ field: 'body.url', message: 'Endpoint must use https://' }])
      }
      if (endpointOutsideAllowlist(url, app.allowed_domains)) {
        return fail(422, 'domain_not_allowed', 'The endpoint host is not in this application\'s allowed domains.')
      }
      app.endpoint = {
        ...app.endpoint,
        url: url ?? null,
        enabled: Boolean(body.enabled),
        timeout_seconds: Number(body.timeout_seconds ?? app.endpoint.timeout_seconds),
        custom_headers: (body.custom_headers as Record<string, string>) ?? app.endpoint.custom_headers,
      }
      if (body.delivery_mode) app.delivery_mode = body.delivery_mode as Application['delivery_mode']
      app.updated_at = now()
      log('endpoint.update', 'application', app.id)
      return ok(app)
    }
    if (is('PUT', '/applications/:id/allowed-domains')) {
      const raw = Array.isArray(body.domains) ? (body.domains as unknown[]).map(String) : []
      if (raw.length > 20) return fail(422, 'validation_error', 'Validation failed', [{ field: 'body.domains', message: 'At most 20 entries' }])
      const domains: string[] = []
      for (const d of raw) {
        const r = parseAllowedDomain(d)
        if (r.error) return fail(422, 'validation_error', 'Validation failed', [{ field: 'body.domains', message: `${d}: ${r.error}` }])
        if (!domains.includes(r.value!)) domains.push(r.value!)
      }
      if (endpointOutsideAllowlist(app.endpoint.url, domains)) {
        return fail(409, 'endpoint_outside_allowlist', 'The current endpoint URL would not match the new allowlist.')
      }
      app.allowed_domains = domains
      app.updated_at = now()
      log('application.allowed_domains_update', 'application', app.id)
      return ok(app)
    }
    if (is('POST', '/applications/:id/pairing-codes')) {
      const code = `nfcp_${urlsafe(32)}`
      const id = uuid()
      const serverUrl = 'http://192.168.1.10:8000'
      const name = typeof body.device_name === 'string' && body.device_name.trim() ? body.device_name.trim() : null
      const expires_at = new Date(Date.now() + 10 * MIN).toISOString().replace(/\.\d{3}Z$/, 'Z')
      pairings.set(id, { id, application_id: app.id, status: 'pending', expires_at, used_at: null, device: null })
      // Demo: a "phone" redeems the code ~8 s later.
      setTimeout(() => {
        const p = pairings.get(id)
        if (!p || p.status !== 'pending') return
        const d: Device = {
          id: uuid(),
          application_id: app.id,
          application_name: app.name,
          name: name ?? 'Pixel 9 (paired)',
          platform: 'android',
          model: 'Pixel 9',
          os_version: 'Android 16',
          app_version: '1.1.0',
          status: 'active',
          last_seen_at: now(),
          last_ip: '192.168.1.57',
          events_count: 0,
          created_at: now(),
        }
        devices.unshift(d)
        app.device_count = devices.filter((x) => x.application_id === app.id && x.status === 'active').length
        p.status = 'used'
        p.used_at = now()
        p.device = d
        log('device.register', 'device', d.id)
      }, 8000)
      log('pairing_code.create', 'application', app.id)
      const qs = `v=1&server=${encodeURIComponent(serverUrl)}&code=${code}${name ? `&name=${encodeURIComponent(name)}` : ''}`
      return ok({ id, code, expires_at, server_url: serverUrl, qr_payload: `nfcterminal://pair?${qs}` }, 201)
    }
    if (is('POST', '/applications/:id/endpoint/test')) {
      if (endpointOutsideAllowlist(app.endpoint.url, app.allowed_domains)) {
        deliveries.unshift({ id: uuid(), event_id: uuid(), application_id: app.id, attempt: 1, mode: 'relay', url: app.endpoint.url ?? '', success: false, status_code: null, latency_ms: null, error: 'domain_not_allowed', response_excerpt: null, created_at: now() })
        return ok({ success: false, status_code: null, latency_ms: null, error: 'domain_not_allowed', response_excerpt: null })
      }
      const success = !app.endpoint.url?.includes('fail')
      app.endpoint.last_tested_at = now()
      app.endpoint.last_test_success = success
      const latency = 80 + rand(300)
      deliveries.unshift({ id: uuid(), event_id: uuid(), application_id: app.id, attempt: 1, mode: 'relay', url: app.endpoint.url ?? '', success, status_code: success ? 200 : 500, latency_ms: latency, error: success ? null : 'Endpoint returned 500', response_excerpt: success ? '{"received":true}' : 'Internal Server Error', created_at: now() })
      log('endpoint.test', 'application', app.id)
      return ok({ success, status_code: success ? 200 : 500, latency_ms: latency, error: success ? null : 'Endpoint returned HTTP 500', response_excerpt: success ? '{"received":true}' : 'Internal Server Error' })
    }
    if (is('POST', '/applications/:id/webhook-secret/rotate')) {
      const secret = (body.webhook_secret as string) || `whsec_${urlsafe(43)}`
      app.webhook_secret = { configured: true, last4: secret.slice(-4), rotated_at: now() }
      log('webhook_secret.rotate', 'application', app.id)
      return ok({ webhook_secret_plaintext: secret, last4: secret.slice(-4), rotated_at: app.webhook_secret.rotated_at })
    }
  }

  // --- pairing codes ---
  if (seg[0] === 'pairing-codes' && seg[1]) {
    const p = pairings.get(seg[1])
    if (!p) return fail(404, 'not_found', 'Pairing code not found')
    if (p.status === 'pending' && p.expires_at < now()) p.status = 'expired'
    if (is('GET', '/pairing-codes/:id')) return ok(p)
    if (is('POST', '/pairing-codes/:id/cancel')) {
      if (p.status === 'pending') p.status = 'expired'
      return ok(null, 204)
    }
  }

  // --- api keys ---
  if (is('GET', '/api-keys')) return ok(keys.filter((k) => !q?.application_id || k.application_id === q.application_id))
  if (is('POST', '/api-keys')) {
    const app = appOr404(String(body.application_id))
    if (!app) return fail(404, 'not_found', 'Application not found')
    const plaintext = `nfc_${urlsafe(48)}`
    const key: ApiKey = { id: uuid(), application_id: app.id, application_name: app.name, name: String(body.name), prefix: plaintext.slice(0, 12), last4: plaintext.slice(-4), created_at: now(), last_used_at: null, revoked_at: null, is_active: true }
    keys.unshift(key)
    log('api_key.create', 'api_key', key.id)
    return ok({ api_key: key, plaintext }, 201)
  }
  if (is('POST', '/api-keys/:id/revoke')) {
    const k = keys.find((x) => x.id === seg[1])
    if (!k) return fail(404, 'not_found', 'API key not found')
    k.is_active = false
    k.revoked_at = now()
    log('api_key.revoke', 'api_key', k.id)
    return ok(k)
  }

  // --- devices ---
  if (is('GET', '/devices')) {
    return ok(devices.filter((d) => (!q?.application_id || d.application_id === q.application_id) && (!q?.status || d.status === q.status)))
  }
  if (seg[0] === 'devices' && seg[1]) {
    const d = devices.find((x) => x.id === seg[1])
    if (!d) return fail(404, 'not_found', 'Device not found')
    const syncCount = () => apps.forEach((a) => (a.device_count = devices.filter((x) => x.application_id === a.id && x.status === 'active').length))
    if (is('GET', '/devices/:id')) return ok(d)
    if (is('PATCH', '/devices/:id')) {
      d.name = String(body.name ?? d.name)
      log('device.rename', 'device', d.id)
      return ok(d)
    }
    if (is('POST', '/devices/:id/revoke')) {
      d.status = 'revoked'
      syncCount()
      log('device.revoke', 'device', d.id)
      return ok(d)
    }
    if (is('DELETE', '/devices/:id')) {
      devices.splice(devices.indexOf(d), 1)
      syncCount()
      log('device.delete', 'device', d.id)
      return ok(null, 204)
    }
  }

  // --- events ---
  if (is('GET', '/events')) {
    const card = String(q?.card_id ?? '').toUpperCase()
    const list = events.filter(
      (e) =>
        (!q?.application_id || e.application_id === q.application_id) &&
        (!q?.device_id || e.device_id === q.device_id) &&
        (!card || e.card_id.includes(card)) &&
        (!q?.status || e.status === q.status) &&
        (!q?.date_from || e.detected_at >= String(q.date_from)) &&
        (!q?.date_to || e.detected_at <= String(q.date_to)),
    )
    return ok(paginate(list, q))
  }
  if (is('GET', '/events/:id')) {
    const e = events.find((x) => x.id === seg[1])
    if (!e) return fail(404, 'not_found', 'Event not found')
    return ok({ ...e, deliveries: deliveries.filter((d) => d.event_id === e.id) })
  }
  if (is('POST', '/events/:id/redeliver')) {
    const e = events.find((x) => x.id === seg[1])
    if (!e) return fail(404, 'not_found', 'Event not found')
    const app = appOr404(e.application_id)
    const d: Delivery = { id: uuid(), event_id: e.id, application_id: e.application_id, attempt: e.attempts + 1, mode: 'relay', url: app?.endpoint.url ?? '', success: true, status_code: 200, latency_ms: 90 + rand(200), error: null, response_excerpt: '{"ok":true}', created_at: now() }
    deliveries.unshift(d)
    e.attempts++
    e.status = 'delivered'
    e.last_status_code = 200
    e.last_error = null
    e.delivered_at = now()
    return ok(d)
  }
  if (is('GET', '/deliveries')) {
    const list = deliveries.filter(
      (d) => (!q?.application_id || d.application_id === q.application_id) && (q?.success == null || String(d.success) === String(q.success)),
    )
    return ok(paginate(list, q))
  }

  // --- usage & billing ---
  if (is('GET', '/usage')) {
    const days = Math.min(365, Number(q?.days) || 30)
    const daily = Array.from({ length: days }, (_, i) => {
      const date = new Date(Date.now() - (days - 1 - i) * DAY).toISOString().slice(0, 10)
      const evs = events.filter((e) => e.detected_at.startsWith(date))
      return { date, events: evs.length, delivered: evs.filter((e) => e.status === 'delivered').length, failed: evs.filter((e) => e.status === 'failed').length }
    })
    const start = new Date()
    start.setUTCDate(1)
    const end = new Date(start)
    end.setUTCMonth(end.getUTCMonth() + 1)
    const month = start.toISOString().slice(0, 7)
    const me = events.filter((e) => e.detected_at.startsWith(month))
    return ok({
      plan: plans[0],
      period_start: start.toISOString().slice(0, 10) + 'T00:00:00Z',
      period_end: end.toISOString().slice(0, 10) + 'T00:00:00Z',
      totals: {
        events: me.length,
        delivered: me.filter((e) => e.status === 'delivered').length,
        failed: me.filter((e) => e.status === 'failed').length,
        applications: apps.length,
        devices: devices.filter((d) => d.status === 'active').length,
      },
      limits: { events_per_month: plans[0].events_per_month, applications: plans[0].max_applications, devices: plans[0].max_devices },
      daily,
    })
  }
  if (is('GET', '/billing/plans')) return ok(plans)
  if (is('GET', '/billing/subscription')) {
    return ok({ plan: plans[0], status: 'active', current_period_start: ago(10 * DAY), current_period_end: ago(-20 * DAY) })
  }

  // --- audit & admin ---
  if (is('GET', '/audit-logs')) return ok(paginate(audit, q))
  if (seg[0] === 'admin' && user.role !== 'admin') return fail(403, 'forbidden', 'Admin only')
  if (is('GET', '/admin/users')) return ok(paginate([user, ...otherUsers], q))
  if (is('PATCH', '/admin/users/:id')) {
    const u = otherUsers.find((x) => x.id === seg[2])
    if (!u) return fail(404, 'not_found', 'User not found')
    u.is_active = Boolean(body.is_active)
    return ok(u)
  }
  if (is('GET', '/admin/allowed-origins')) return ok({ env: ['http://localhost:5173', 'http://127.0.0.1:5173'], items: origins })
  if (is('POST', '/admin/allowed-origins')) {
    const origin = String(body.origin ?? '').trim().toLowerCase().replace(/\/$/, '')
    if (!/^https?:\/\/[^/]+$/.test(origin)) return fail(422, 'validation_error', 'Validation failed', [{ field: 'body.origin', message: 'Must be scheme://host[:port]' }])
    if (origins.some((o) => o.origin === origin)) return fail(409, 'origin_exists', 'Origin already allowed')
    const o: AllowedOrigin = { id: uuid(), origin, note: (body.note as string) ?? null, created_by: user.id, created_by_email: user.email, created_at: now() }
    origins.push(o)
    log('allowed_origin.create', 'allowed_origin', o.id)
    return ok(o, 201)
  }
  if (is('DELETE', '/admin/allowed-origins/:id')) {
    const i = origins.findIndex((o) => o.id === seg[2])
    if (i < 0) return fail(404, 'not_found', 'Origin not found')
    log('allowed_origin.delete', 'allowed_origin', origins[i].id)
    origins.splice(i, 1)
    return ok(null, 204)
  }
  if (is('GET', '/admin/stats')) {
    return ok({ users: otherUsers.length + 1, applications: apps.length + 9, devices: devices.length + 23, events_total: events.length + 18_431 })
  }


  // =================================================================================
  // Part 2 — request logs (A2), sandbox (A4), admin console (A5)
  // =================================================================================
  if (is('GET', '/request-logs')) return ok(paginate(filterLogs(requestLogs.filter((l) => l.user_id === user.id), q), q, 25))
  if (is('GET', '/request-logs/:id')) {
    const l = requestLogs.find((x) => x.id === seg[1])
    return l ? ok(l) : fail(404, 'not_found', 'Request log not found')
  }

  if (is('GET', '/sandbox/endpoints')) return ok(sandboxes)
  if (is('POST', '/sandbox/endpoints')) {
    const ep = newSandbox(String(body.name ?? 'Sandbox'), (body.application_id as string) ?? null)
    sandboxes.push(ep)
    return ok(ep, 201)
  }
  if (seg[0] === 'sandbox' && seg[1] === 'endpoints' && seg[2]) {
    const ep = sandboxes.find((x) => x.id === seg[2])
    if (!ep) return fail(404, 'not_found', 'Sandbox endpoint not found')
    if (is('GET', '/sandbox/endpoints/:id')) return ok(ep)
    if (is('PATCH', '/sandbox/endpoints/:id')) {
      for (const k of ['name', 'application_id', 'response_status', 'response_delay_ms', 'response_body', 'response_headers'] as const) {
        if (k in body) (ep as unknown as Record<string, unknown>)[k] = body[k]
      }
      return ok(ep)
    }
    if (is('DELETE', '/sandbox/endpoints/:id')) {
      sandboxes.splice(sandboxes.indexOf(ep), 1)
      return ok(null, 204)
    }
    if (is('GET', '/sandbox/endpoints/:id/requests')) {
      const list = sandboxRequests.filter((r) => r.endpoint_id === ep.id)
      return ok(paginate(list, q, 50))
    }
    if (is('DELETE', '/sandbox/endpoints/:id/requests')) {
      for (let i = sandboxRequests.length - 1; i >= 0; i--) if (sandboxRequests[i].endpoint_id === ep.id) sandboxRequests.splice(i, 1)
      ep.request_count = 0
      return ok(null, 204)
    }
    if (is('POST', '/sandbox/endpoints/:id/use-for/:appId')) {
      const app = appOr404(seg[4])
      if (!app) return fail(404, 'not_found', 'Application not found')
      app.endpoint.url = ep.url
      app.endpoint.enabled = true
      if (app.allowed_domains.length) app.allowed_domains.push(new URL(ep.url).hostname)
      ep.application_id = app.id
      return ok(app)
    }
    if (is('POST', '/sandbox/endpoints/:id/send-test')) {
      if (!ep.application_id) return fail(409, 'sandbox_no_application', 'Link this sandbox endpoint to an application first.')
      const r = sandboxHit(ep, { test: true })
      const success = r.response_status >= 200 && r.response_status < 300
      const code = success ? null : r.response_status >= 500 ? 'delivery_http_5xx' : 'delivery_http_4xx'
      return ok({
        success,
        status_code: r.response_status,
        latency_ms: r.response_delay_ms + 12,
        error: success ? null : `Endpoint returned HTTP ${r.response_status}`,
        error_code: code,
        error_ref: code ? refFor(code) : null,
        response_excerpt: ep.response_body.slice(0, 200),
      })
    }
  }
  if (is('GET', '/sandbox/requests/:id')) {
    const r = sandboxRequests.find((x) => x.id === seg[2])
    return r ? ok(r) : fail(404, 'not_found', 'Sandbox request not found')
  }

  if (seg[0] === 'admin' && user.role !== 'admin') return fail(403, 'forbidden', 'Admin only')
  if (is('GET', '/admin/overview')) return ok(adminOverview(String(q?.range ?? '24h')))
  if (is('GET', '/admin/request-logs')) return ok(paginate(filterLogs(requestLogs, q), q, 50))
  if (is('GET', '/admin/request-logs/:id')) {
    const l = requestLogs.find((x) => x.id === seg[2])
    return l ? ok(l) : fail(404, 'not_found', 'Request log not found')
  }
  if (is('GET', '/admin/accounts')) {
    const qq = String(q?.q ?? '').toLowerCase()
    const list = allAccounts().filter(
      (a) =>
        (!qq || a.email.toLowerCase().includes(qq) || a.full_name.toLowerCase().includes(qq)) &&
        (!q?.type || (q.type === 'admin' ? a.role === 'admin' : a.account_type === q.type)) &&
        (!q?.status || (q.status === 'active' ? a.is_active : q.status === 'inactive' ? !a.is_active : a.email_verified === false)),
    )
    return ok(paginate(list, q))
  }
  if (is('GET', '/admin/accounts/:id') || is('PATCH', '/admin/accounts/:id')) {
    const a = allAccounts().find((x) => x.id === seg[2])
    if (!a) return fail(404, 'not_found', 'Account not found')
    const target = a.id === user.id ? user : otherUsers.find((u) => u.id === a.id)!
    if (method === 'PATCH') {
      if (typeof body.is_active === 'boolean') target.is_active = body.is_active
      if (body.role === 'admin' || body.role === 'developer') target.role = body.role
      if (typeof body.plan_code === 'string') target.plan = body.plan_code
      if (typeof body.email_verified === 'boolean') target.email_verified = body.email_verified
      for (const k of ['full_name', 'phone', 'company', 'country', 'job_title'] as const) if (k in body) (target as unknown as Record<string, unknown>)[k] = body[k] || null
      if (typeof body.full_name === 'string') target.full_name = body.full_name
      log('admin.account_update', 'user', target.id)
      return ok(allAccounts().find((x) => x.id === a.id))
    }
    const mine = a.id === user.id
    return ok({
      ...a,
      applications: mine ? apps : [],
      devices: mine ? devices : [],
      recent_request_logs: requestLogs.filter((l) => l.user_id === a.id).slice(0, 25),
      audit_logs: mine ? audit.slice(0, 25) : [],
      email_logs: emailLogs.filter((e) => e.user_id === a.id).slice(0, 20).map(({ html: _h, ...rest }) => rest),
      recent_logins: Array.from({ length: Math.min(10, a.login_count ?? 3) }, (_, i) => ({
        ip_address: `198.51.100.${10 + i}`,
        user_agent: i % 2 ? 'Mozilla/5.0 (Macintosh) Safari/17' : 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140', at: ago(i * 1.7 * DAY + HOUR),
      })),
    })
  }
  if (is('GET', '/admin/businesses')) {
    const qq = String(q?.q ?? '').toLowerCase()
    return ok(paginate(adminBusinesses.filter((b) => (!qq || b.name.toLowerCase().includes(qq) || b.slug.includes(qq)) && (!q?.status || b.status === q.status)), q))
  }
  if (is('GET', '/admin/businesses/:id') || is('PATCH', '/admin/businesses/:id')) {
    const b = adminBusinesses.find((x) => x.id === seg[2])
    if (!b) return fail(404, 'not_found', 'Business not found')
    if (method === 'PATCH') {
      if (body.status === 'active' || body.status === 'suspended') b.status = body.status
      if (typeof body.plan_code === 'string') b.plan = body.plan_code
      log('admin.business_update', 'business', b.id)
    }
    return ok(b)
  }
  if (is('GET', '/admin/devices')) {
    const qq = String(q?.q ?? '').toLowerCase()
    const list = adminDevices().filter(
      (d) =>
        (!qq || d.name.toLowerCase().includes(qq) || (d.owner?.email ?? '').includes(qq) || (d.business?.name ?? '').toLowerCase().includes(qq)) &&
        (!q?.status || d.status === q.status) &&
        (q?.online == null || q.online === '' || String(d.online) === String(q.online)),
    )
    return ok(paginate(list, q, 25))
  }
  if (is('POST', '/admin/devices/:id/revoke')) {
    const d = devices.find((x) => x.id === seg[2]) ?? fleet.find((x) => x.id === seg[2])
    if (!d) return fail(404, 'not_found', 'Device not found')
    d.status = 'revoked'
    return ok(d)
  }
  if (is('POST', '/admin/api-keys/:id/revoke')) {
    const k = keys.find((x) => x.id === seg[2])
    if (!k) return fail(404, 'not_found', 'API key not found')
    k.is_active = false
    k.revoked_at = now()
    return ok(k)
  }
  if (is('GET', '/admin/deliveries')) {
    const list = deliveries.filter(
      (d) => (q?.success == null || String(d.success) === String(q.success)) && (!q?.error_code || (d.error_code ?? '').includes(String(q.error_code))),
    )
    return ok(paginate(list, q, 25))
  }
  if (is('GET', '/admin/system')) {
    return ok({
      database: 'ok',
      redis: 'ok',
      worker: { alive: true, last_heartbeat_at: ago(rand(20) * 1000) },
      delivery_queue_depth: rand(12),
      request_log_buffer_depth: rand(80),
      version: '1.1.0',
      environment: 'development',
    })
  }
  if (is('GET', '/admin/settings')) return ok(platformSettings)
  if (is('PATCH', '/admin/settings')) {
    Object.assign(platformSettings, body)
    log('admin.settings_update', 'platform_settings', null)
    return ok(platformSettings)
  }

  return fail(404, 'not_found', `Mock: no handler for ${method} ${path}`)
}

// Occasionally simulate a live tap so auto-refresh has something to show.
setInterval(() => {
  if (Math.random() < 0.5) addEvent(rand(3000))
}, 6000)

export async function mockRequest(method: string, path: string, query: Query, body: unknown, token: string | null): Promise<RawResponse> {
  await new Promise((r) => setTimeout(r, 150 + rand(250)))
  // Deep-copy so React Query caches never share mutable objects with the mock DB.
  const res = handle(method, path, query, (body ?? {}) as Body, token)
  return { ...res, body: res.body == null ? null : JSON.parse(JSON.stringify(res.body)) }
}

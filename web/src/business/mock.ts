/**
 * DEV-ONLY in-memory mock of the Part 2 business API (contract section B). Imported only by
 * src/api/mock/server.ts, which itself is loaded exclusively when VITE_USE_MOCKS === 'true', so none
 * of this ships in production builds. `handleBusinessMock` returns null for requests it doesn't own.
 */
import type { RawResponse } from '@/api/client'
import type { ApiKey, Delivery, NfcEvent, PairingCodeState } from '@/api/types'
import type {
  Action,
  ActionTypeDef,
  Analytics,
  AnalyticsRange,
  AnalyticsTotals,
  Assignee,
  Business,
  BusinessApplication,
  BusinessBilling,
  BusinessDevice,
  BusinessPlan,
  BusinessRole,
  Card,
  CardHistoryEntry,
  CardSummary,
  CardTap,
  Customer,
  DeviceType,
  Employee,
  Invitation,
  Member,
  Permission,
  Profile,
  Section,
  TapResult,
} from './api/types'
import { ROLE_PERMISSIONS } from './lib/permissions'

type Query = Record<string, string | number | boolean | null | undefined> | undefined
type Body = Record<string, unknown>

// ---------- helpers ----------

// Deterministic PRNG so ids survive a page reload (mock state is rebuilt on every load, and
// dashboard URLs contain ids). Runtime-created entities continue the same sequence.
let seedState = 0x2f6b1a3c
function rnd(): number {
  seedState = (seedState + 0x6d2b79f5) | 0
  let t = seedState
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const bytes = (n: number) => Array.from({ length: n }, () => Math.floor(rnd() * 256))
const uuid = () => {
  const h = bytes(16).map((b, i) => (i === 6 ? (b & 0x0f) | 0x40 : i === 8 ? (b & 0x3f) | 0x80 : b).toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z')
const now = () => iso(Date.now())
const ago = (ms: number) => iso(Date.now() - ms)
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const rand = (n: number) => Math.floor(rnd() * n)
const pick = <T,>(xs: T[]): T => xs[rand(xs.length)]
const base62 = (n: number) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  return bytes(n).map((b) => chars[b % 62]).join('')
}
const urlsafe = (n: number) => base62(n)
const hex = (n: number) => bytes(n).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
const TAP_BASE = 'http://192.168.1.10:8000/t/'
const WEB_BASE = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173'
const REFS: Record<string, string> = {
  not_found: 'NFC-2004',
  validation_error: 'NFC-2001',
  insufficient_permissions: 'NFC-6003',
  profile_unavailable: 'NFC-6020',
  card_uid_exists: 'NFC-6011',
  invalid_action_config: 'NFC-6010',
  last_owner: 'NFC-6030',
  plan_limit_reached: 'NFC-7001',
  slug_taken: 'NFC-6002',
  invitation_email_mismatch: 'NFC-6032',
  not_authenticated: 'NFC-1001',
}

function ok(body: unknown, status = 200): RawResponse {
  return { status, headers: new Headers(), body }
}
function fail(status: number, code: string, message: string, details: unknown = null): RawResponse {
  return {
    status,
    headers: new Headers(),
    body: { error: { code, message, details, ref: REFS[code] ?? 'NFC-9000', request_id: hex(8).toLowerCase(), docs_url: `${WEB_BASE}/docs/errors#${REFS[code] ?? 'NFC-9000'}` } },
  }
}
function paginate<T>(items: T[], q: Query, def = 20) {
  const page = Math.max(1, Number(q?.page) || 1)
  const page_size = Math.min(100, Math.max(1, Number(q?.page_size) || def))
  return { items: items.slice((page - 1) * page_size, page * page_size), total: items.length, page, page_size }
}
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const optStr = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

// ---------- static catalogs ----------

const categories = [
  ['restaurant', 'Restaurant & café'],
  ['retail', 'Retail & shop'],
  ['hospitality', 'Hotel & hospitality'],
  ['professional_services', 'Professional services'],
  ['health', 'Health & wellness'],
  ['education', 'Education'],
  ['events', 'Events & venues'],
  ['real_estate', 'Real estate'],
  ['technology', 'Technology'],
  ['creative', 'Creative & media'],
  ['other', 'Other'],
].map(([code, label]) => ({ code, label }))

const actionTypes: ActionTypeDef[] = [
  { type: 'business_profile', label: 'Business profile', description: 'Opens your public business page.', fields: [] },
  { type: 'employee_profile', label: 'Employee profile', description: 'Opens the digital business card of an employee (default: the card holder).', fields: [{ name: 'employee_id', type: 'employee', required: false, label: 'Employee', help: 'Leave empty to use whoever the card is assigned to.' }] },
  { type: 'website', label: 'Website', description: 'Redirects to a web page.', fields: [{ name: 'url', type: 'url', required: true, label: 'URL', placeholder: 'https://example.com' }] },
  { type: 'custom_url', label: 'Custom URL', description: 'Redirects to any https link (booking page, form, review page…).', fields: [{ name: 'url', type: 'url', required: true, label: 'URL', placeholder: 'https://' }] },
  { type: 'profile', label: 'Custom profile page', description: 'Opens one of your custom, menu or product pages.', fields: [{ name: 'profile_id', type: 'profile', required: true, label: 'Profile', profile_types: ['custom', 'menu', 'product'] }] },
  { type: 'share_contact', label: 'Share contact', description: 'Downloads a contact card (vCard) the customer can save.', fields: [{ name: 'employee_id', type: 'employee', required: false, label: 'Employee', help: 'Empty = card holder, or the business contact for tags.' }] },
  { type: 'whatsapp', label: 'WhatsApp', description: 'Opens a WhatsApp chat with an optional pre-filled message.', fields: [{ name: 'phone', type: 'phone', required: true, label: 'WhatsApp number' }, { name: 'message', type: 'text', required: false, label: 'Pre-filled message' }] },
  { type: 'phone_call', label: 'Phone call', description: 'Shows a page with a big call button.', fields: [{ name: 'phone', type: 'phone', required: true, label: 'Phone number' }] },
  { type: 'email', label: 'Email', description: 'Opens a new email in the customer’s mail app.', fields: [{ name: 'to', type: 'email', required: true, label: 'To' }, { name: 'subject', type: 'string', required: false, label: 'Subject' }, { name: 'body', type: 'text', required: false, label: 'Body' }] },
  { type: 'maps', label: 'Maps / directions', description: 'Opens Google Maps at an address or coordinates.', fields: [{ name: 'query', type: 'string', required: false, label: 'Address or place', one_of: 'location' }, { name: 'lat', type: 'number', required: false, label: 'Latitude', one_of: 'location' }, { name: 'lng', type: 'number', required: false, label: 'Longitude', one_of: 'location' }] },
  { type: 'social', label: 'Social profile', description: 'Redirects to a social network profile.', fields: [{ name: 'platform', type: 'select', required: true, label: 'Platform', options: ['instagram', 'facebook', 'linkedin', 'x', 'tiktok', 'youtube'] }, { name: 'url', type: 'url', required: true, label: 'Profile URL' }] },
  { type: 'digital_menu', label: 'Digital menu', description: 'Opens your menu page (or an external menu link).', fields: [{ name: 'profile_id', type: 'profile', required: false, label: 'Menu page', one_of: 'target', profile_types: ['menu'] }, { name: 'url', type: 'url', required: false, label: 'External menu URL', one_of: 'target' }] },
  { type: 'product_info', label: 'Product info', description: 'Opens a product page (or an external link).', fields: [{ name: 'profile_id', type: 'profile', required: false, label: 'Product page', one_of: 'target', profile_types: ['product'] }, { name: 'url', type: 'url', required: false, label: 'External product URL', one_of: 'target' }] },
  { type: 'wifi', label: 'Wi-Fi', description: 'Shows the network name, a copy-password button and a Wi-Fi QR code.', fields: [{ name: 'ssid', type: 'string', required: true, label: 'Network name (SSID)' }, { name: 'password', type: 'string', required: false, label: 'Password' }, { name: 'security', type: 'select', required: true, label: 'Security', options: [{ value: 'WPA', label: 'WPA/WPA2/WPA3' }, { value: 'WEP', label: 'WEP' }, { value: 'nopass', label: 'Open network' }], default: 'WPA' }, { name: 'hidden', type: 'boolean', required: false, label: 'Hidden network' }] },
  { type: 'developer_webhook', label: 'Developer webhook', description: 'Sends a signed card.tapped event to an application endpoint, then runs a follow-up action.', fields: [{ name: 'application_id', type: 'application', required: true, label: 'Application' }, { name: 'then', type: 'action', required: false, label: 'Then', help: 'What the customer sees afterwards. Default: business profile.' }] },
]

const devPlans: BusinessPlan[] = [
  { code: 'free', name: 'Free', price_monthly_cents: 0, currency: 'usd', events_per_month: 10_000, max_applications: 3, max_devices: 5, features: ['Relay & direct delivery', 'HMAC-signed webhooks'], audience: 'developer' },
  { code: 'pro', name: 'Pro', price_monthly_cents: 2900, currency: 'usd', events_per_month: 250_000, max_applications: 20, max_devices: 100, features: ['Everything in Free', 'Email support'], audience: 'developer' },
  { code: 'business', name: 'Business', price_monthly_cents: 19900, currency: 'usd', events_per_month: 5_000_000, max_applications: null, max_devices: null, features: ['Everything in Pro', 'Priority support'], audience: 'developer' },
]
const bizPlans: BusinessPlan[] = [
  { code: 'biz_starter', name: 'Starter', price_monthly_cents: 0, currency: 'usd', events_per_month: 10_000, max_applications: 2, max_devices: 3, max_cards: 50, max_members: 5, taps_per_month: 10_000, features: ['50 NFC cards & tags', '3 reader devices', '5 team members', 'Public profiles & digital menu', 'Tap analytics'], audience: 'business' },
  { code: 'biz_growth', name: 'Growth', price_monthly_cents: 4900, currency: 'usd', events_per_month: 250_000, max_applications: 10, max_devices: 25, max_cards: 1000, max_members: 25, taps_per_month: 250_000, features: ['1,000 NFC cards & tags', '25 reader devices', '25 team members', 'Developer webhooks & API', 'Priority email support'], audience: 'business' },
  { code: 'biz_enterprise', name: 'Enterprise', price_monthly_cents: 19900, currency: 'usd', events_per_month: null, max_applications: null, max_devices: null, max_cards: null, max_members: null, taps_per_month: null, features: ['Unlimited cards, devices & members', 'SSO & audit exports (soon)', 'Dedicated success manager', 'Custom SLA'], audience: 'business' },
]

// ---------- per-business state ----------

interface Db {
  business: Business
  role: BusinessRole
  employees: Employee[]
  customers: Customer[]
  cards: Card[]
  history: Map<string, CardHistoryEntry[]>
  taps: CardTap[]
  profiles: Profile[]
  apps: BusinessApplication[]
  keys: ApiKey[]
  devices: BusinessDevice[]
  events: NfcEvent[]
  deliveries: Delivery[]
  members: Member[]
  invitations: (Invitation & { token: string })[]
}

const dbs: Db[] = []
const pairings = new Map<string, PairingCodeState & { bid: string }>()

function makeBusiness(p: Partial<Business> & { name: string; slug: string }): Business {
  return {
    id: uuid(),
    email: null,
    phone: null,
    country: 'US',
    category: 'restaurant',
    description: null,
    website: null,
    address: null,
    logo_url: null,
    status: 'active',
    verified: true,
    settings: { devices_can_register_cards: true, default_card_action: null, timezone: 'America/New_York' },
    plan: { code: 'biz_starter', name: 'Starter' },
    created_at: ago(120 * DAY),
    ...p,
  }
}

type SeedSection = { type: Section['type']; data: Record<string, unknown> }
/** Seed data is written `{ type, data }` for readability; the wire format is flat `{ type, ...fields }`. */
const flat = (xs: (SeedSection | Section)[]): Section[] =>
  xs.map((x) => ('data' in x && x.data && typeof x.data === 'object' ? ({ type: x.type, ...(x.data as object) } as Section) : (x as Section)))

function makeProfile(b: Business, p: Omit<Partial<Profile>, 'sections'> & { type: Profile['type']; slug: string; title: string; sections: (SeedSection | Section)[] }): Profile {
  return {
    id: uuid(),
    business_id: b.id,
    employee_id: null,
    published: true,
    theme: { accent: '#b91c1c', cover_image_url: null },
    public_url: p.type === 'business' ? `${WEB_BASE}/b/${b.slug}` : `${WEB_BASE}/b/${b.slug}/${p.slug}`,
    updated_at: ago(rand(20) * DAY + HOUR),
    ...p,
    sections: flat(p.sections),
  }
}

const weekHours = (): SeedSection => ({
  type: 'hours',
  data: {
    rows: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day, i) => ({
      day,
      open: i < 5 ? '07:00' : '08:00',
      close: i < 5 ? '19:00' : '16:00',
      closed: i === 6,
    })),
  },
})

function seedAcme(): Db {
  const business = makeBusiness({
    name: 'Acme Café',
    slug: 'acme-cafe',
    email: 'hello@acme-cafe.example',
    phone: '+14155550142',
    country: 'US',
    category: 'restaurant',
    description: 'Neighbourhood specialty coffee, fresh pastries and a quiet corner to work. Roasting our own beans since 2016.',
    website: 'https://acme-cafe.example',
    address: '42 Market Street, San Francisco, CA 94105',
    verified: true,
  })
  const db: Db = { business, role: 'owner', employees: [], customers: [], cards: [], history: new Map(), taps: [], profiles: [], apps: [], keys: [], devices: [], events: [], deliveries: [], members: [], invitations: [] }

  const people: [string, string, string, string][] = [
    ['John', 'Doe', 'Sales Manager', 'Sales'],
    ['Maria', 'Garcia', 'Head Barista', 'Kitchen'],
    ['Liam', 'Chen', 'Barista', 'Kitchen'],
    ['Sofia', 'Rossi', 'Store Manager', 'Management'],
    ['Noah', 'Okafor', 'Catering Lead', 'Sales'],
    ['Emma', 'Novak', 'Marketing Lead', 'Marketing'],
    ['Lucas', 'Silva', 'Pastry Chef', 'Kitchen'],
    ['Aisha', 'Khan', 'Customer Success', 'Support'],
    ['Oliver', 'Brown', 'Barista', 'Kitchen'],
    ['Mia', 'Tanaka', 'Events Coordinator', 'Sales'],
    ['Ethan', 'Müller', 'Delivery', 'Support'],
    ['Zoe', 'Martin', 'Social Media', 'Marketing'],
  ]
  db.employees = people.map(([first, last, position, department], i) => {
    const slug = `${first}-${last}`.toLowerCase().replace(/ü/g, 'u')
    return {
      id: uuid(),
      business_id: business.id,
      first_name: first,
      last_name: last,
      full_name: `${first} ${last}`,
      photo_url: null,
      position,
      department,
      phone: `+1415555${String(1000 + i * 37).slice(0, 4)}`,
      email: `${first.toLowerCase()}@acme-cafe.example`,
      social_links: i % 3 === 0 ? [{ platform: 'linkedin', url: `https://linkedin.com/in/${slug}` }, { platform: 'instagram', url: `https://instagram.com/${slug}` }] : i % 3 === 1 ? [{ platform: 'linkedin', url: `https://linkedin.com/in/${slug}` }] : [],
      slug,
      status: i === 10 ? 'inactive' : 'active',
      profile_published: i !== 10,
      cards: [],
      total_taps: 0,
      last_tap_at: null,
      created_at: ago((100 - i * 6) * DAY),
    }
  })

  const cust: [string, string | null, string[]][] = [
    ['Harper Wilson', 'Wilson & Co', ['VIP', 'wholesale']],
    ['Daniel Kim', null, ['loyalty']],
    ['Chloe Dubois', 'Studio Dubois', ['loyalty']],
    ['Mateo Álvarez', null, ['VIP']],
    ['Grace Lee', 'Lee Events', ['wholesale', 'events']],
    ['Samuel Adeyemi', null, ['loyalty']],
    ['Isabella Moretti', 'Moretti Hotels', ['VIP', 'events']],
    ['Jack Thompson', null, []],
    ['Ava Johansson', 'Nordic Design', ['wholesale']],
  ]
  db.customers = cust.map(([name, company, tags], i) => ({
    id: uuid(),
    business_id: business.id,
    full_name: name,
    email: `${name.split(' ')[0].toLowerCase()}@example.com`,
    phone: i % 2 ? `+1212555${String(2000 + i * 13).slice(0, 4)}` : null,
    company,
    notes: i === 0 ? 'Orders 20kg of house blend monthly. Prefers invoices on the 1st.' : null,
    tags,
    status: i === 7 ? 'inactive' : 'active',
    cards: [],
    total_taps: 0,
    last_tap_at: null,
    created_at: ago((80 - i * 7) * DAY),
  }))

  // Profiles
  const bizProfile = makeProfile(business, {
    type: 'business',
    slug: 'acme-cafe',
    title: 'Acme Café',
    sections: [
      { type: 'about', data: { text: business.description ?? '' } },
      { type: 'contact', data: { phone: business.phone ?? '', email: business.email ?? '', website: business.website ?? '', address: business.address ?? '' } },
      weekHours(),
      { type: 'services', data: { items: [{ title: 'Catering', description: 'Coffee carts and pastry boxes for offices and events.', price: 'from $180' }, { title: 'Barista classes', description: 'Two-hour latte-art workshop, max 6 people.', price: '$65' }, { title: 'Wholesale beans', description: 'Freshly roasted beans for restaurants and offices.' }] } },
      { type: 'social', data: { links: [{ platform: 'instagram', url: 'https://instagram.com/acmecafe' }, { platform: 'facebook', url: 'https://facebook.com/acmecafe' }, { platform: 'tiktok', url: 'https://tiktok.com/@acmecafe' }] } },
      { type: 'buttons', data: { items: [{ label: 'Order ahead', action: { type: 'website', config: { url: 'https://order.acme-cafe.example' } } }, { label: 'Leave a review', action: { type: 'custom_url', config: { url: 'https://g.page/acme-cafe/review' } } }] } },
    ],
  })
  const menu = makeProfile(business, {
    type: 'menu',
    slug: 'menu',
    title: 'Café menu',
    sections: [
      { type: 'text', data: { markdown: 'All drinks available with oat, almond or soy milk. **Ask us about today’s single origin.**' } },
      {
        type: 'menu',
        data: {
          categories: [
            { name: 'Coffee', items: [{ name: 'Espresso', description: 'House blend, 18g double shot.', price: '$3.20', tags: ['vegan'] }, { name: 'Flat white', description: 'Double shot, silky milk.', price: '$4.50', tags: [] }, { name: 'Cold brew', description: '18-hour steep, served over ice.', price: '$4.80', tags: ['vegan'] }] },
            { name: 'Pastries', items: [{ name: 'Butter croissant', description: 'Laminated in-house every morning.', price: '$3.90', tags: ['vegetarian'] }, { name: 'Cardamom bun', description: 'Swedish-style, lightly sweet.', price: '$4.20', tags: ['vegetarian'] }] },
            { name: 'Breakfast', items: [{ name: 'Avocado toast', description: 'Sourdough, chili flakes, lemon.', price: '$9.50', tags: ['vegan'] }, { name: 'Granola bowl', description: 'Greek yogurt, seasonal fruit, honey.', price: '$8.00', tags: ['vegetarian', 'gluten-free'] }] },
          ],
        },
      },
    ],
  })
  const product = makeProfile(business, {
    type: 'product',
    slug: 'house-blend',
    title: 'House Blend beans',
    sections: [
      { type: 'products', data: { items: [{ title: 'House Blend — 250g', description: 'Chocolate, hazelnut, caramel. Medium roast, great for espresso and filter.', price: '$16', url: 'https://shop.acme-cafe.example/house-blend' }, { title: 'House Blend — 1kg', description: 'Same blend, café size.', price: '$52', url: 'https://shop.acme-cafe.example/house-blend-1kg' }] } },
      { type: 'about', data: { text: 'Sourced from a cooperative in Huila, Colombia and a washed Ethiopian Guji. Roasted every Tuesday.' } },
    ],
  })
  const eventProfile = makeProfile(business, {
    type: 'custom',
    slug: 'summer-tasting',
    title: 'Summer tasting night',
    published: false,
    sections: [
      { type: 'text', data: { markdown: 'Join us on **July 18** for a cold-brew and pastry pairing evening. Limited to 30 guests.' } },
      { type: 'buttons', data: { items: [{ label: 'Reserve a seat', action: { type: 'website', config: { url: 'https://tickets.example.com/acme-summer' } } }] } },
      { type: 'gallery', data: { images: [] } },
    ],
  })
  db.profiles = [bizProfile, menu, product, eventProfile]
  for (const e of db.employees) {
    db.profiles.push(
      makeProfile(business, {
        type: 'employee',
        slug: e.slug,
        title: e.full_name,
        employee_id: e.id,
        published: e.profile_published,
        sections: [
          { type: 'about', data: { text: `${e.position} at Acme Café.` } },
          { type: 'contact', data: { phone: e.phone ?? '', email: e.email ?? '' } },
          ...(e.social_links.length ? [{ type: 'social' as const, data: { links: e.social_links } as Record<string, unknown> }] : []),
        ],
      }),
    )
  }

  // Cards
  const cardNames = db.employees.map((e) => `${e.first_name}'s card`)
  let seq = 1
  const mkCard = (kind: Card['kind'], name: string, assignee: Assignee | null, extra: Partial<Card> = {}): Card => {
    const code = base62(10)
    const uid = extra.programmed === false ? null : '04' + hex(6)
    return {
      id: uuid(),
      business_id: business.id,
      kind,
      name,
      uid,
      uid_masked: uid ? `${uid.slice(0, 2)}••••••${uid.slice(-2)}` : null,
      public_code: code,
      tap_url: TAP_BASE + code,
      status: 'active',
      effective_status: 'active',
      assignee,
      profile_id: null,
      action: null,
      programmed: uid != null,
      programmed_at: uid ? ago((60 - seq++) * DAY) : null,
      total_taps: 0,
      unique_visitors: 0,
      last_tap_at: null,
      created_at: ago((70 - seq) * DAY),
      ...extra,
    }
  }
  db.employees.forEach((e, i) => {
    db.cards.push(
      mkCard('card', cardNames[i], { type: 'employee', id: e.id, name: e.full_name, photo_url: e.photo_url }, {
        action: i === 0 ? { type: 'employee_profile', config: {} } : i === 4 ? { type: 'share_contact', config: {} } : i === 9 ? { type: 'whatsapp', config: { phone: '+14155550199', message: 'Hi Mia! I’d like to book an event.' } } : { type: 'employee_profile', config: {} },
      }),
    )
  })
  db.cards.push(mkCard('card', "John's backup card", { type: 'employee', id: db.employees[0].id, name: db.employees[0].full_name }, { status: 'inactive' }))
  db.customers.slice(0, 5).forEach((c, i) => {
    db.cards.push(mkCard('card', `Loyalty card · ${c.full_name.split(' ')[0]}`, { type: 'customer', id: c.id, name: c.full_name }, { action: i === 0 ? { type: 'developer_webhook', config: { application_id: '', then: { type: 'business_profile', config: {} } } } : { type: 'website', config: { url: 'https://acme-cafe.example/loyalty' } } }))
  })
  for (let i = 1; i <= 4; i++) db.cards.push(mkCard('card', `Blank card #${String(i).padStart(3, '0')}`, null, { programmed: false }))
  // Tags
  for (let t = 1; t <= 6; t++) db.cards.push(mkCard('tag', `Table ${t}`, null, { action: { type: 'digital_menu', config: { profile_id: menu.id } } }))
  db.cards.push(mkCard('tag', 'Front window poster', null, { action: { type: 'website', config: { url: 'https://acme-cafe.example/summer' } } }))
  db.cards.push(mkCard('tag', 'Guest Wi-Fi sticker', null, { action: { type: 'wifi', config: { ssid: 'AcmeCafe-Guest', password: 'espresso2026', security: 'WPA', hidden: false } } }))
  db.cards.push(mkCard('tag', 'Counter stand', null, { action: { type: 'business_profile', config: {} } }))
  db.cards.push(mkCard('tag', 'Bean shelf — House Blend', null, { action: { type: 'product_info', config: { profile_id: product.id } } }))
  db.cards.push(mkCard('tag', 'Entrance door', null, { action: { type: 'maps', config: { query: business.address } }, status: 'inactive' }))

  // Apps, keys, devices
  const terminal: BusinessApplication = {
    id: uuid(),
    business_id: business.id,
    name: 'Business Terminal',
    description: 'Default application for your NFC reader phones.',
    is_active: true,
    delivery_mode: 'relay',
    endpoint: { url: null, enabled: false, timeout_seconds: 10, custom_headers: {}, last_tested_at: null, last_test_success: null },
    webhook_secret: { configured: true, last4: 'Tq3v', rotated_at: null },
    allowed_domains: [],
    device_count: 0,
    created_at: business.created_at,
    updated_at: business.created_at,
  }
  const pos: BusinessApplication = {
    id: uuid(),
    business_id: business.id,
    name: 'POS loyalty integration',
    description: 'Sends loyalty-card taps to our point-of-sale.',
    is_active: true,
    delivery_mode: 'relay',
    endpoint: { url: 'https://pos.acme-cafe.example/nfc', enabled: true, timeout_seconds: 8, custom_headers: { 'X-Store': 'sf-01' }, last_tested_at: ago(3 * DAY), last_test_success: true },
    webhook_secret: { configured: true, last4: 'm9Xa', rotated_at: ago(20 * DAY) },
    allowed_domains: ['pos.acme-cafe.example'],
    device_count: 0,
    created_at: ago(40 * DAY),
    updated_at: ago(3 * DAY),
  }
  db.apps = [terminal, pos]
  const loyalty = db.cards.find((c) => c.action?.type === 'developer_webhook')
  if (loyalty?.action) loyalty.action.config.application_id = pos.id
  db.keys = db.apps.map((a) => ({ id: uuid(), application_id: a.id, application_name: a.name, name: 'Default key', prefix: `nfc_${urlsafe(8)}`, last4: urlsafe(4), created_at: a.created_at, last_used_at: ago(2 * HOUR), revoked_at: null, is_active: true }))
  const mkDevice = (name: string, model: string, seenMs: number, emp: Employee | null, status: 'active' | 'revoked' = 'active'): BusinessDevice => ({
    id: uuid(),
    application_id: terminal.id,
    application_name: terminal.name,
    name,
    platform: 'android',
    model,
    os_version: 'Android 15',
    app_version: '2.0.0',
    status,
    last_seen_at: ago(seenMs),
    last_ip: `203.0.113.${10 + rand(200)}`,
    events_count: 0,
    created_at: ago(50 * DAY),
    assigned_employee: emp ? { id: emp.id, name: emp.full_name } : null,
    last_scan_at: null,
    online: status === 'active' && seenMs < 2 * MIN,
  })
  db.devices = [
    mkDevice('Front counter Pixel', 'Pixel 8', 40_000, db.employees[3]),
    mkDevice('Catering tablet', 'Galaxy Tab S9', 5 * HOUR, db.employees[4]),
    mkDevice('Pop-up stand phone', 'Moto G54', 12 * DAY, null, 'revoked'),
  ]
  terminal.device_count = 2

  // Taps
  const tappable = db.cards.filter((c) => c.programmed)
  const weights = tappable.map((c) => (c.kind === 'tag' ? (c.name.startsWith('Table') ? 5 : 3) : c.assignee?.type === 'customer' ? 2 : 4))
  const total = weights.reduce((a, b) => a + b, 0)
  const weightedCard = () => {
    let r = rnd() * total
    for (let i = 0; i < tappable.length; i++) {
      r -= weights[i]
      if (r <= 0) return tappable[i]
    }
    return tappable[0]
  }
  const hourWeights = [0, 0, 0, 0, 0, 0, 1, 4, 8, 9, 6, 5, 8, 9, 6, 4, 4, 6, 7, 5, 3, 2, 1, 0]
  const hourTotal = hourWeights.reduce((a, b) => a + b, 0)
  const pickHour = () => {
    let r = rnd() * hourTotal
    for (let h = 0; h < 24; h++) {
      r -= hourWeights[h]
      if (r <= 0) return h
    }
    return 12
  }
  for (let i = 0; i < 1100; i++) {
    const dayAgo = Math.floor(Math.pow(rnd(), 1.35) * 120)
    const d = new Date(Date.now() - dayAgo * DAY)
    d.setHours(pickHour(), rand(60), rand(60))
    if (d.getTime() > Date.now()) d.setTime(Date.now() - rand(3 * HOUR))
    addTap(db, weightedCard(), d.getTime(), rnd() < 0.14 ? 'reader' : 'web')
  }
  // Unknown card seen by a reader
  addTap(db, null, Date.now() - 3 * HOUR, 'reader')
  db.taps.sort((a, b) => b.created_at.localeCompare(a.created_at))

  // Team
  const memberRows: [string, string, BusinessRole, number][] = [
    ['Ada Developer', 'dev@example.com', 'owner', 1],
    ['Sofia Rossi', 'sofia@acme-cafe.example', 'admin', 0.5],
    ['Maria Garcia', 'maria@acme-cafe.example', 'manager', 3],
    ['Liam Chen', 'liam@acme-cafe.example', 'staff', 26],
    ['Noah Okafor', 'noah@acme-cafe.example', 'manager', 70],
  ]
  db.members = memberRows.map(([full_name, email, role, hoursAgo], i) => ({
    id: uuid(),
    user_id: uuid(),
    full_name,
    email,
    role,
    extra_permissions: i === 3 ? ['analytics.view'] : [],
    status: 'active',
    joined_at: ago((110 - i * 15) * DAY),
    last_active_at: ago(hoursAgo * HOUR),
  }))
  db.invitations = [
    { id: uuid(), token: 'demo-invite-token', email: 'lucas@acme-cafe.example', role: 'staff', status: 'pending', invited_by: 'Ada Developer', expires_at: ago(-5 * DAY), created_at: ago(2 * DAY) },
    { id: uuid(), token: urlsafe(24), email: 'finance@acme-cafe.example', role: 'admin', status: 'pending', invited_by: 'Sofia Rossi', expires_at: ago(-6 * DAY), created_at: ago(1 * DAY) },
    { id: uuid(), token: urlsafe(24), email: 'old.hire@example.com', role: 'staff', status: 'expired', invited_by: 'Ada Developer', expires_at: ago(3 * DAY), created_at: ago(10 * DAY) },
  ]

  for (const c of db.cards) {
    const entries: CardHistoryEntry[] = [
      { id: uuid(), type: 'created', description: `${c.kind === 'tag' ? 'Tag' : 'Card'} created`, actor: { type: 'user', id: null, name: 'Ada Developer' }, created_at: c.created_at },
      ...(c.programmed_at ? [{ id: uuid(), type: 'programmed', description: 'Programmed with the NFC Terminal app', actor: { type: 'device' as const, id: db.devices[0].id, name: db.devices[0].name }, created_at: c.programmed_at }] : []),
      ...(c.assignee ? [{ id: uuid(), type: 'assigned', description: `Assigned to ${c.assignee.name}`, actor: { type: 'user' as const, id: null, name: 'Sofia Rossi' }, created_at: c.programmed_at ?? c.created_at }] : []),
      ...(c.status === 'inactive' ? [{ id: uuid(), type: 'deactivated', description: 'Deactivated', actor: { type: 'user' as const, id: null, name: 'Ada Developer' }, created_at: ago(4 * DAY) }] : []),
    ]
    db.history.set(c.id, entries.sort((a, b) => b.created_at.localeCompare(a.created_at)))
  }
  return db
}

function seedNorthwind(): Db {
  const business = makeBusiness({
    name: 'Northwind Studio',
    slug: 'northwind-studio',
    email: 'studio@northwind.example',
    phone: '+442079460123',
    country: 'GB',
    category: 'creative',
    description: 'Brand and product design studio.',
    website: 'https://northwind.example',
    verified: false,
    settings: { devices_can_register_cards: false, default_card_action: null, timezone: 'Europe/London' },
    created_at: ago(9 * DAY),
  })
  const db: Db = { business, role: 'manager', employees: [], customers: [], cards: [], history: new Map(), taps: [], profiles: [], apps: [], keys: [], devices: [], events: [], deliveries: [], members: [], invitations: [] }
  db.profiles = [
    makeProfile(business, {
      type: 'business',
      slug: business.slug,
      title: business.name,
      sections: [{ type: 'about', data: { text: business.description ?? '' } }, { type: 'contact', data: { email: business.email ?? '', phone: business.phone ?? '', website: business.website ?? '' } }],
    }),
  ]
  db.apps = [{ id: uuid(), business_id: business.id, name: 'Business Terminal', description: 'Default application for your NFC reader phones.', is_active: true, delivery_mode: 'relay', endpoint: { url: null, enabled: false, timeout_seconds: 10, custom_headers: {}, last_tested_at: null, last_test_success: null }, webhook_secret: { configured: true, last4: 'aa11', rotated_at: null }, allowed_domains: [], device_count: 0, created_at: business.created_at, updated_at: business.created_at }]
  db.members = [
    { id: uuid(), user_id: uuid(), full_name: 'Olivia Hart', email: 'olivia@northwind.example', role: 'owner', extra_permissions: [], status: 'active', joined_at: business.created_at, last_active_at: ago(HOUR) },
    { id: uuid(), user_id: uuid(), full_name: 'Ada Developer', email: 'dev@example.com', role: 'manager', extra_permissions: [], status: 'active', joined_at: ago(5 * DAY), last_active_at: ago(10 * MIN) },
  ]
  return db
}

// ---------- derived state ----------

function empById(db: Db, id: string | undefined | null) {
  return db.employees.find((e) => e.id === id)
}

function effectiveStatus(db: Db, c: Card): Card['effective_status'] {
  if (db.business.status === 'suspended') return 'business_suspended'
  if (c.status === 'inactive') return 'inactive'
  if (c.assignee?.type === 'employee' && empById(db, c.assignee.id)?.status === 'inactive') return 'inactive_owner'
  if (!c.assignee && c.kind === 'card') return 'unassigned'
  return 'active'
}

function summary(c: Card): CardSummary {
  return { id: c.id, name: c.name, kind: c.kind, status: c.status, effective_status: c.effective_status, uid_masked: c.uid_masked, total_taps: c.total_taps, last_tap_at: c.last_tap_at }
}

function refresh(db: Db) {
  for (const c of db.cards) c.effective_status = effectiveStatus(db, c)
  for (const e of db.employees) {
    const cs = db.cards.filter((c) => c.assignee?.type === 'employee' && c.assignee.id === e.id)
    e.cards = cs.map(summary)
    e.total_taps = cs.reduce((a, c) => a + c.total_taps, 0)
    e.last_tap_at = cs.map((c) => c.last_tap_at).filter(Boolean).sort().pop() ?? null
  }
  for (const cu of db.customers) {
    const cs = db.cards.filter((c) => c.assignee?.type === 'customer' && c.assignee.id === cu.id)
    cu.cards = cs.map(summary)
    cu.total_taps = cs.reduce((a, c) => a + c.total_taps, 0)
    cu.last_tap_at = cs.map((c) => c.last_tap_at).filter(Boolean).sort().pop() ?? null
  }
  for (const a of db.apps) a.device_count = db.devices.filter((d) => d.application_id === a.id && d.status === 'active').length
  for (const d of db.devices) {
    d.online = d.status === 'active' && !!d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < 2 * MIN
  }
}

const visitors = Array.from({ length: 380 }, () => hex(8))

function addTap(db: Db, card: Card | null, at: number, source: CardTap['source']) {
  const dev = source === 'reader' ? db.devices.find((d) => d.status === 'active') ?? null : null
  const action = card?.action?.type ?? db.business.settings.default_card_action?.type ?? 'business_profile'
  const eff = card ? effectiveStatus(db, card) : null
  const result: TapResult = !card
    ? 'unknown_card'
    : eff === 'inactive' || eff === 'inactive_owner'
      ? 'inactive'
      : action === 'share_contact'
        ? 'vcard'
        : action === 'developer_webhook'
          ? 'webhook'
          : ['wifi', 'phone_call'].includes(action)
            ? 'page'
            : 'redirected'
  const device_type: DeviceType = source === 'reader' ? 'android' : pick<DeviceType>(['ios', 'ios', 'ios', 'android', 'android', 'desktop', 'other'])
  let nfc_event_id: string | null = null
  if (source === 'reader' && dev) {
    const app = db.apps.find((a) => a.id === dev.application_id)!
    const e: NfcEvent = {
      id: uuid(),
      application_id: app.id,
      application_name: app.name,
      device_id: dev.id,
      device_name: dev.name,
      event_type: 'card.detected',
      card_id: card?.uid ?? '04' + hex(6),
      card_type: 'ntag215',
      card_technologies: ['NfcA', 'MifareUltralight'],
      authenticated: false,
      delivery_mode: 'relay',
      status: 'delivered',
      attempts: action === 'developer_webhook' ? 1 : 0,
      last_status_code: action === 'developer_webhook' ? 200 : null,
      last_error: null,
      detected_at: iso(at),
      received_at: iso(at),
      delivered_at: iso(at),
    }
    db.events.push(e)
    nfc_event_id = e.id
    dev.events_count++
    if (!dev.last_scan_at || dev.last_scan_at < e.detected_at) dev.last_scan_at = e.detected_at
    if (action === 'developer_webhook') {
      const posApp = db.apps.find((a) => a.id === card?.action?.config.application_id) ?? app
      db.deliveries.push({ id: uuid(), event_id: e.id, application_id: posApp.id, attempt: 1, mode: 'relay', url: posApp.endpoint.url ?? '', success: true, status_code: 200, latency_ms: 80 + rand(200), error: null, response_excerpt: '{"ok":true}', created_at: iso(at) })
    }
  }
  const tap: CardTap = {
    id: uuid(),
    business_id: db.business.id,
    card_id: card?.id ?? null,
    card_name: card?.name ?? null,
    card_kind: card?.kind ?? null,
    assignee: card?.assignee ? { type: card.assignee.type, id: card.assignee.id, name: card.assignee.name } : null,
    source,
    action_type: card ? action : null,
    result,
    device_id: dev?.id ?? null,
    device_name: dev?.name ?? null,
    nfc_event_id,
    visitor_hash: source === 'web' ? pick(visitors) : null,
    device_type,
    browser: source === 'web' ? (device_type === 'ios' ? 'Safari' : device_type === 'android' ? 'Chrome' : pick(['Chrome', 'Firefox', 'Edge'])) : 'NFC Terminal',
    country: source === 'web' ? pick(['US', 'US', 'US', 'US', 'CA', 'GB', 'MX', 'DE', null]) : null,
    created_at: iso(at),
  }
  db.taps.push(tap)
  if (card) {
    card.total_taps++
    if (!card.last_tap_at || card.last_tap_at < tap.created_at) card.last_tap_at = tap.created_at
  }
  return tap
}

function seed() {
  if (dbs.length) return
  const a = seedAcme()
  const n = seedNorthwind()
  dbs.push(a, n)
  for (const db of dbs) {
    for (const c of db.cards) c.unique_visitors = new Set(db.taps.filter((t) => t.card_id === c.id && t.visitor_hash).map((t) => t.visitor_hash)).size
    db.events.sort((x, y) => y.detected_at.localeCompare(x.detected_at))
    db.deliveries.sort((x, y) => y.created_at.localeCompare(x.created_at))
    refresh(db)
  }
}

// ---------- analytics ----------

const RANGE_DAYS: Record<AnalyticsRange, number> = { '7d': 7, '30d': 30, '90d': 90, '365d': 365 }

function dayKey(t: string | number) {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function totalsOf(taps: CardTap[]): AnalyticsTotals {
  return {
    taps: taps.length,
    unique_visitors: new Set(taps.map((t) => t.visitor_hash).filter(Boolean)).size,
    web_taps: taps.filter((t) => t.source === 'web').length,
    reader_taps: taps.filter((t) => t.source === 'reader').length,
    active_cards: new Set(taps.map((t) => t.card_id).filter(Boolean)).size,
    active_employees: new Set(taps.filter((t) => t.assignee?.type === 'employee').map((t) => t.assignee!.id)).size,
  }
}

function countBy<T>(xs: T[], key: (x: T) => string | null): [string, number][] {
  const m = new Map<string, number>()
  for (const x of xs) {
    const k = key(x)
    if (k == null) continue
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

function timeline(taps: CardTap[], days: number) {
  const out = []
  for (let i = days - 1; i >= 0; i--) {
    const key = dayKey(Date.now() - i * DAY)
    const ts = taps.filter((t) => dayKey(t.created_at) === key)
    out.push({ date: key, taps: ts.length, unique_visitors: new Set(ts.map((t) => t.visitor_hash).filter(Boolean)).size })
  }
  return out
}

function analytics(db: Db, q: Query): Analytics {
  const range = (String(q?.range ?? '30d') as AnalyticsRange) in RANGE_DAYS ? (String(q?.range ?? '30d') as AnalyticsRange) : '30d'
  const days = RANGE_DAYS[range]
  const from = Date.now() - days * DAY
  const prevFrom = from - days * DAY
  const filt = (t: CardTap) =>
    t.result !== 'unknown_card' &&
    (!q?.card_id || t.card_id === q.card_id) &&
    (!q?.employee_id || (t.assignee?.type === 'employee' && t.assignee.id === q.employee_id))
  const cur = db.taps.filter((t) => filt(t) && new Date(t.created_at).getTime() >= from)
  const prev = db.taps.filter((t) => filt(t) && new Date(t.created_at).getTime() >= prevFrom && new Date(t.created_at).getTime() < from)
  const cardName = new Map(db.cards.map((c) => [c.id, c.name]))
  const empName = new Map(db.employees.map((e) => [e.id, e.full_name]))
  return {
    totals: totalsOf(cur),
    previous_period_totals: totalsOf(prev),
    timeline: timeline(cur, days),
    by_card: countBy(cur, (t) => t.card_id).slice(0, 10).map(([card_id, taps]) => ({ card_id, name: cardName.get(card_id) ?? 'Deleted card', taps })),
    by_employee: countBy(cur, (t) => (t.assignee?.type === 'employee' ? t.assignee.id : null)).slice(0, 10).map(([employee_id, taps]) => ({ employee_id, name: empName.get(employee_id) ?? '—', taps })),
    by_action: countBy(cur, (t) => t.action_type).map(([action_type, taps]) => ({ action_type, taps })),
    by_device_type: countBy(cur, (t) => t.device_type).map(([device_type, taps]) => ({ device_type: device_type as DeviceType, taps })),
    by_country: countBy(cur, (t) => t.country).map(([country, taps]) => ({ country, taps })),
    by_hour: Array.from({ length: 24 }, (_, hour) => ({ hour, taps: cur.filter((t) => new Date(t.created_at).getHours() === hour).length })),
    last_activity: cur[0] ?? null,
  }
}

// ---------- action validation / preview ----------

function validateAction(db: Db, a: unknown): Record<string, string> | null {
  if (a == null) return null
  const action = a as Action
  const def = actionTypes.find((t) => t.type === action.type)
  if (!def) return { type: 'Unknown action type' }
  const cfg = action.config ?? {}
  const errs: Record<string, string> = {}
  for (const f of def.fields) {
    const v = cfg[f.name]
    const empty = v == null || v === ''
    if (f.required && empty) errs[f.name] = 'This field is required'
    if (!empty && f.type === 'url' && !/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)/.test(String(v))) errs[f.name] = 'Must be an https:// URL'
    if (!empty && f.type === 'phone' && !/^\+[1-9]\d{6,14}$/.test(String(v))) errs[f.name] = 'Use international format, e.g. +14155550123'
    if (!empty && f.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v))) errs[f.name] = 'Enter a valid email address'
    if (!empty && f.type === 'profile' && !db.profiles.some((p) => p.id === v)) errs[f.name] = 'Profile not found'
  }
  const groups = new Set(def.fields.map((f) => f.one_of).filter(Boolean))
  for (const g of groups) {
    const fs = def.fields.filter((f) => f.one_of === g)
    if (!fs.some((f) => cfg[f.name] != null && cfg[f.name] !== '')) errs[fs[0].name] ??= `Provide ${fs.map((f) => f.label ?? f.name).join(' or ')}`
  }
  return Object.keys(errs).length ? errs : null
}

function preview(db: Db, action: Action, cardId?: string): { resolved_url: string | null; kind: 'redirect' | 'page' | 'vcard' | 'webhook' } {
  const c = action.config ?? {}
  const card = db.cards.find((x) => x.id === cardId)
  const b = db.business
  const prof = (id: unknown) => db.profiles.find((p) => p.id === id)
  switch (action.type) {
    case 'website':
    case 'custom_url':
    case 'social':
      return { resolved_url: str(c.url) || null, kind: 'redirect' }
    case 'business_profile':
      return { resolved_url: `${WEB_BASE}/b/${b.slug}`, kind: 'redirect' }
    case 'employee_profile': {
      const e = empById(db, str(c.employee_id) || (card?.assignee?.type === 'employee' ? card.assignee.id : null))
      return { resolved_url: e ? `${WEB_BASE}/b/${b.slug}/${e.slug}` : `${WEB_BASE}/b/${b.slug}`, kind: 'redirect' }
    }
    case 'profile':
    case 'digital_menu':
    case 'product_info': {
      const p = prof(c.profile_id)
      return { resolved_url: p?.public_url ?? (str(c.url) || null), kind: 'redirect' }
    }
    case 'share_contact':
      return { resolved_url: null, kind: 'vcard' }
    case 'whatsapp':
      return { resolved_url: `https://wa.me/${str(c.phone).replace(/\D/g, '')}${c.message ? `?text=${encodeURIComponent(str(c.message))}` : ''}`, kind: 'redirect' }
    case 'phone_call':
      return { resolved_url: `tel:${str(c.phone)}`, kind: 'page' }
    case 'email': {
      const qs = [c.subject && `subject=${encodeURIComponent(str(c.subject))}`, c.body && `body=${encodeURIComponent(str(c.body))}`].filter(Boolean).join('&')
      return { resolved_url: `mailto:${str(c.to)}${qs ? `?${qs}` : ''}`, kind: 'page' }
    }
    case 'maps':
      return { resolved_url: c.query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(str(c.query))}` : `https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}`, kind: 'redirect' }
    case 'wifi':
      return { resolved_url: card ? `${WEB_BASE}/w/${card.public_code}` : `${WEB_BASE}/w/PREVIEW`, kind: 'page' }
    case 'developer_webhook':
      return { resolved_url: c.then ? preview(db, c.then as Action, cardId).resolved_url : `${WEB_BASE}/b/${b.slug}`, kind: 'webhook' }
    default:
      return { resolved_url: null, kind: 'redirect' }
  }
}

// ---------- public ----------

function vcardUrl(name: string, phone?: string | null, email?: string | null, org?: string, title?: string | null) {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${name}`, org ? `ORG:${org}` : '', title ? `TITLE:${title}` : '', phone ? `TEL;TYPE=CELL:${phone}` : '', email ? `EMAIL:${email}` : '', 'END:VCARD'].filter(Boolean)
  return `data:text/vcard;charset=utf-8,${encodeURIComponent(lines.join('\r\n'))}`
}

function publicInfo(b: Business) {
  return { name: b.name, slug: b.slug, logo_url: b.logo_url, verified: b.verified, category: categories.find((c) => c.code === b.category)?.label ?? b.category }
}

function unavailable(reason: string): RawResponse {
  return fail(404, 'profile_unavailable', 'This page is not available.', { reason })
}

function handlePublic(seg: string[]): RawResponse | null {
  if (seg[0] !== 'public') return null
  if (seg[1] === 'b' && seg[2]) {
    const db = dbs.find((d) => d.business.slug === seg[2])
    if (!db) return unavailable('not_found')
    if (db.business.status !== 'active') return unavailable('suspended')
    if (!db.business.verified) return unavailable('unverified')
    const profile = seg[3] ? db.profiles.find((p) => p.slug === seg[3] && p.type !== 'business') : db.profiles.find((p) => p.type === 'business')
    if (!profile) return unavailable('not_found')
    if (!profile.published) return unavailable('unpublished')
    const emp = profile.employee_id ? empById(db, profile.employee_id) : null
    if (emp && emp.status !== 'active') return unavailable('inactive')
    const b = db.business
    return ok({
      business: { ...publicInfo(b), category: b.category },
      profile,
      employee: emp ? { id: emp.id, full_name: emp.full_name, position: emp.position, department: emp.department, photo_url: emp.photo_url, phone: emp.phone, email: emp.email, social_links: emp.social_links } : null,
      vcard_url: emp ? vcardUrl(emp.full_name, emp.phone, emp.email, b.name, emp.position) : vcardUrl(b.name, b.phone, b.email, b.name),
    })
  }
  if (seg[1] === 'w' && seg[2]) {
    for (const db of dbs) {
      const c = db.cards.find((x) => x.public_code === seg[2])
      if (!c) continue
      if (!db.business.verified) return unavailable('unverified')
      if (c.effective_status !== 'active') return unavailable('inactive')
      if (c.action?.type !== 'wifi') return unavailable('not_wifi')
      const cfg = c.action.config
      const esc = (v: string) => v.replace(/([\\;,:"])/g, '\\$1')
      const security = (cfg.security as string) ?? 'WPA'
      return ok({
        business: { ...publicInfo(db.business), category: db.business.category },
        ssid: str(cfg.ssid),
        password: optStr(cfg.password),
        security,
        hidden: Boolean(cfg.hidden),
        wifi_qr: `WIFI:T:${security};S:${esc(str(cfg.ssid))};${cfg.password ? `P:${esc(str(cfg.password))};` : ''}${cfg.hidden ? 'H:true;' : ''};`,
      })
    }
    return unavailable('not_found')
  }
  return null
}

// ---------- permissions ----------

function permsOf(db: Db): Permission[] {
  return ROLE_PERMISSIONS[db.role]
}

function need(db: Db, p: Permission): RawResponse | null {
  return permsOf(db).includes(p) ? null : fail(403, 'insufficient_permissions', `Your role (${db.role}) can’t do this.`, { required: p })
}

// ---------- main handler ----------

export function handleBusinessMock(method: string, path: string, q: Query, body: Body, token: string | null): RawResponse | null {
  seed()
  const seg = path.split('/').filter(Boolean)
  const is = (m: string, pattern: string) => {
    if (m !== method) return false
    const p = pattern.split('/').filter(Boolean)
    return p.length === seg.length && p.every((x, i) => x.startsWith(':') || x === seg[i])
  }

  // ---- public (no auth) ----
  if (is('GET', '/meta/business-categories')) return ok(categories)
  if (is('GET', '/actions/types')) return ok(actionTypes)
  if (is('GET', '/billing/plans')) return ok(q?.audience === 'business' ? bizPlans : q?.audience === 'developer' ? devPlans : [...devPlans, ...bizPlans])
  const pub = handlePublic(seg)
  if (pub) return pub
  if (is('GET', '/invitations/:token')) {
    for (const db of dbs) {
      const inv = db.invitations.find((i) => i.token === seg[1])
      if (inv) return ok({ business_name: db.business.name, role: inv.role, email: inv.email, expires_at: inv.expires_at, status: inv.status })
    }
    return fail(404, 'not_found', 'This invitation link is invalid.')
  }

  // Everything below needs a session; unrelated routes fall through to the Part 1 mock.
  const ownsRoute =
    seg[0] === 'businesses' ||
    (seg[0] === 'invitations' && seg[2] === 'accept') ||
    (is('POST', '/applications') && typeof body.business_id === 'string') ||
    findBizApp(seg) != null ||
    (typeof q?.application_id === 'string' && dbs.some((d) => d.apps.some((a) => a.id === q.application_id))) ||
    (is('POST', '/api-keys') && dbs.some((d) => d.apps.some((a) => a.id === body.application_id)))
  if (!ownsRoute) return null
  if (!token) return fail(401, 'not_authenticated', 'Not authenticated')

  if (is('POST', '/invitations/:token/accept')) {
    for (const db of dbs) {
      const inv = db.invitations.find((i) => i.token === seg[1])
      if (inv) {
        if (inv.status !== 'pending') return fail(409, 'invitation_not_pending', `This invitation is ${inv.status}.`)
        inv.status = 'accepted'
        db.members.push({ id: uuid(), user_id: uuid(), full_name: inv.email.split('@')[0], email: inv.email, role: inv.role, extra_permissions: [], status: 'active', joined_at: now(), last_active_at: now() })
        return ok({ business_id: db.business.id })
      }
    }
    return fail(404, 'not_found', 'Invitation not found')
  }

  // ---- Part 1 routes on business-owned applications/devices/keys/events ----
  const p1 = handlePart1(method, seg, q, body, is)
  if (p1) return p1

  if (is('GET', '/businesses/slug-available')) {
    const slug = str(q?.slug).trim().toLowerCase()
    if (!/^[a-z0-9-]{3,48}$/.test(slug)) return ok({ available: false, reason: 'invalid' })
    if (['admin', 'api', 'dashboard', 'business', 'taken', 'www'].includes(slug)) return ok({ available: false, reason: 'reserved' })
    return ok(dbs.some((d) => d.business.slug === slug) ? { available: false, reason: 'taken' } : { available: true, reason: null })
  }
  if (is('GET', '/businesses')) return ok(dbs.map((d) => ({ ...d.business, role: d.role })))

  const db = dbs.find((d) => d.business.id === seg[1])
  if (!db) return fail(404, 'not_found', 'Business not found')
  const b = db.business
  refresh(db)
  const at = (m: string, pattern: string) => is(m, `/businesses/:bid${pattern}`)

  // Generic permission guard for writes.
  if (method !== 'GET') {
    const area = seg[2]
    const perm: Permission | null =
      area === undefined ? (method === 'DELETE' ? 'business.delete' : 'settings.manage')
      : area === 'logo' ? 'settings.manage'
      : area === 'cards' || area === 'actions' ? (area === 'actions' && seg[3] === 'preview' ? null : 'cards.manage')
      : area === 'employees' || area === 'customers' ? 'people.manage'
      : area === 'profiles' ? 'profiles.manage'
      : area === 'devices' ? 'devices.manage'
      : area === 'members' || area === 'invitations' ? 'team.manage'
      : null
    if (perm) {
      const denied = need(db, perm)
      if (denied) return denied
    }
  }

  // ---- business ----
  if (at('GET', '')) return ok(b)
  if (at('GET', '/me')) return ok({ role: db.role, permissions: permsOf(db) })
  if (at('PATCH', '')) {
    if (typeof body.slug === 'string') {
      const slug = body.slug.trim()
      if (!/^[a-z0-9-]{3,48}$/.test(slug)) return fail(422, 'validation_error', 'Validation failed', [{ field: 'body.slug', message: 'Use 3–48 lowercase letters, numbers or dashes' }])
      if (dbs.some((d) => d !== db && d.business.slug === slug) || ['admin', 'api', 'dashboard', 'business', 'taken'].includes(slug)) return fail(409, 'slug_taken', 'That URL is already taken.', { field: 'slug' })
      b.slug = slug
      for (const p of db.profiles) p.public_url = p.type === 'business' ? `${WEB_BASE}/b/${slug}` : `${WEB_BASE}/b/${slug}/${p.slug}`
    }
    for (const f of ['name', 'email', 'phone', 'country', 'category', 'description', 'website', 'address'] as const) {
      if (f in body) (b as unknown as Record<string, unknown>)[f] = body[f] ?? null
    }
    if (body.settings && typeof body.settings === 'object') {
      const s = body.settings as Record<string, unknown>
      if ('default_card_action' in s) {
        const errs = validateAction(db, s.default_card_action)
        if (errs) return fail(422, 'invalid_action_config', 'Invalid action configuration', errs)
      }
      b.settings = { ...b.settings, ...(s as Partial<Business['settings']>) }
    }
    return ok(b)
  }
  if (at('DELETE', '')) {
    dbs.splice(dbs.indexOf(db), 1)
    return ok(null, 204)
  }
  if (at('POST', '/logo')) {
    b.logo_url = str(body.file_url) || null
    return ok(b)
  }
  if (at('GET', '/overview')) {
    const today = dayKey(Date.now())
    const weekAgo = Date.now() - 7 * DAY
    const cards = db.cards.filter((c) => c.kind === 'card')
    const tags = db.cards.filter((c) => c.kind === 'tag')
    return ok({
      cards: { total: cards.length, active: cards.filter((c) => c.status === 'active').length },
      tags: { total: tags.length, active: tags.filter((c) => c.status === 'active').length },
      employees: { total: db.employees.length, active: db.employees.filter((e) => e.status === 'active').length },
      customers: db.customers.length,
      devices: { total: db.devices.filter((d) => d.status === 'active').length, online: db.devices.filter((d) => d.online).length },
      taps_today: db.taps.filter((t) => dayKey(t.created_at) === today).length,
      taps_7d: db.taps.filter((t) => new Date(t.created_at).getTime() >= weekAgo).length,
      recent_taps: db.taps.slice(0, 10),
      checklist: {
        email_verified: b.verified,
        logo_uploaded: !!b.logo_url,
        profile_published: db.profiles.some((p) => p.type === 'business' && p.published),
        first_employee: db.employees.length > 0,
        first_card: db.cards.length > 0,
        card_programmed: db.cards.some((c) => c.programmed),
        device_paired: db.devices.length > 0,
        team_invited: db.members.length > 1,
      },
    })
  }
  if (at('GET', '/billing')) {
    const code = typeof b.plan === 'string' ? b.plan : (b.plan?.code ?? 'biz_starter')
    const plan = bizPlans.find((p) => p.code === code) ?? bizPlans[0]
    const month = dayKey(Date.now()).slice(0, 7)
    const res: BusinessBilling = {
      plan,
      usage: { cards: db.cards.length, devices: db.devices.filter((d) => d.status === 'active').length, members: db.members.length, taps_this_month: db.taps.filter((t) => dayKey(t.created_at).startsWith(month)).length },
      limits: { cards: plan.max_cards ?? null, devices: plan.max_devices, members: plan.max_members ?? null, taps_per_month: plan.taps_per_month ?? null },
      status: 'active',
    }
    return ok(res)
  }

  // ---- cards ----
  if (at('GET', '/cards')) {
    const qs = str(q?.q).toLowerCase()
    const list = db.cards
      .filter(
        (c) =>
          (!q?.kind || c.kind === q.kind) &&
          (!q?.status || c.status === q.status) &&
          (!q?.assignee_type || (q.assignee_type === 'none' ? !c.assignee : c.assignee?.type === q.assignee_type)) &&
          (!qs || c.name.toLowerCase().includes(qs) || c.assignee?.name.toLowerCase().includes(qs) || c.public_code.toLowerCase().includes(qs) || (c.uid ?? '').toLowerCase().includes(qs)),
      )
      .sort((x, y) => y.created_at.localeCompare(x.created_at))
    return ok(paginate(list, q))
  }
  if (at('POST', '/cards')) {
    const name = str(body.name).trim()
    if (!name) return fail(422, 'validation_error', 'Validation failed', [{ field: 'body.name', message: 'Field required' }])
    const uid = optStr(body.uid)?.toUpperCase().replace(/[:\s-]/g, '') ?? null
    if (uid && !/^[0-9A-F]{4,64}$/.test(uid)) return fail(422, 'validation_error', 'Validation failed', [{ field: 'body.uid', message: 'Use hexadecimal characters only (e.g. 04A1B2C3D4E5)' }])
    if (uid && db.cards.some((c) => c.uid === uid)) return fail(409, 'card_uid_exists', 'A card with this UID already exists in this business.')
    const limit = bizPlans[0].max_cards ?? Infinity
    if (db.cards.length >= limit && b.plan && (typeof b.plan === 'string' ? b.plan : b.plan.code) === 'biz_starter') return fail(402, 'plan_limit_reached', `Your Starter plan allows ${limit} cards and tags.`, { limit: 'cards' })
    const errs = validateAction(db, body.action)
    if (errs) return fail(422, 'invalid_action_config', 'Invalid action configuration', errs)
    const code = base62(10)
    const c: Card = { id: uuid(), business_id: b.id, kind: body.kind === 'tag' ? 'tag' : 'card', name, uid, uid_masked: uid ? `${uid.slice(0, 2)}••••••${uid.slice(-2)}` : null, public_code: code, tap_url: TAP_BASE + code, status: 'active', effective_status: 'active', assignee: null, profile_id: (body.profile_id as string) ?? null, action: (body.action as Action) ?? null, programmed: false, programmed_at: null, total_taps: 0, unique_visitors: 0, last_tap_at: null, created_at: now() }
    db.cards.unshift(c)
    db.history.set(c.id, [{ id: uuid(), type: 'created', description: `${c.kind === 'tag' ? 'Tag' : 'Card'} created`, actor: { type: 'user', id: null, name: 'You' }, created_at: now() }])
    refresh(db)
    return ok(c, 201)
  }
  if (at('POST', '/cards/bulk')) {
    const count = Math.floor(Number(body.count))
    if (!(count >= 1 && count <= 500)) return fail(422, 'validation_error', 'Validation failed', [{ field: 'body.count', message: 'Between 1 and 500' }])
    const prefix = str(body.name_prefix).trim() || 'Card'
    const created: Card[] = []
    const startN = db.cards.filter((c) => c.name.startsWith(prefix)).length
    for (let i = 1; i <= count; i++) {
      const code = base62(10)
      const c: Card = { id: uuid(), business_id: b.id, kind: body.kind === 'tag' ? 'tag' : 'card', name: `${prefix} ${String(startN + i).padStart(3, '0')}`, uid: null, uid_masked: null, public_code: code, tap_url: TAP_BASE + code, status: 'active', effective_status: 'active', assignee: null, profile_id: null, action: null, programmed: false, programmed_at: null, total_taps: 0, unique_visitors: 0, last_tap_at: null, created_at: now() }
      created.push(c)
      db.history.set(c.id, [{ id: uuid(), type: 'created', description: 'Created in a bulk batch', actor: { type: 'user', id: null, name: 'You' }, created_at: now() }])
    }
    db.cards.unshift(...created)
    refresh(db)
    return ok({ created: created.length, items: created }, 201)
  }
  if (seg[2] === 'cards' && seg[3]) {
    const c = db.cards.find((x) => x.id === seg[3])
    if (!c) return fail(404, 'not_found', 'Card not found')
    const hist = (type: string, description: string) => db.history.get(c.id)?.unshift({ id: uuid(), type, description, actor: { type: 'user', id: null, name: 'You' }, created_at: now() })
    if (at('GET', '/cards/:cid')) return ok(c)
    if (at('PATCH', '/cards/:cid')) {
      if ('action' in body) {
        const errs = validateAction(db, body.action)
        if (errs) return fail(422, 'invalid_action_config', 'Invalid action configuration', errs)
        c.action = (body.action as Action) ?? null
        hist('action_changed', c.action ? `Action set to ${actionTypes.find((t) => t.type === c.action!.type)?.label ?? c.action.type}` : 'Action reset to business default')
      }
      if (typeof body.name === 'string' && body.name.trim() && body.name !== c.name) {
        hist('renamed', `Renamed from “${c.name}” to “${body.name.trim()}”`)
        c.name = body.name.trim()
      }
      if ('profile_id' in body) c.profile_id = (body.profile_id as string) ?? null
      if ('uid' in body) {
        const uid = optStr(body.uid)?.toUpperCase().replace(/[:\s-]/g, '') ?? null
        if (uid && db.cards.some((x) => x !== c && x.uid === uid)) return fail(409, 'card_uid_exists', 'A card with this UID already exists in this business.')
        c.uid = uid
        c.uid_masked = uid ? `${uid.slice(0, 2)}••••••${uid.slice(-2)}` : null
      }
      refresh(db)
      return ok(c)
    }
    if (at('DELETE', '/cards/:cid')) {
      db.cards.splice(db.cards.indexOf(c), 1)
      refresh(db)
      return ok(null, 204)
    }
    if (at('POST', '/cards/:cid/assign')) {
      const type = body.assignee_type
      const person = type === 'employee' ? db.employees.find((e) => e.id === body.assignee_id) : db.customers.find((x) => x.id === body.assignee_id)
      if (!person) return fail(404, 'not_found', 'Assignee not found')
      c.assignee = { type: type as Assignee['type'], id: person.id, name: person.full_name, photo_url: 'photo_url' in person ? person.photo_url : null }
      hist('assigned', `Assigned to ${person.full_name}`)
      refresh(db)
      return ok(c)
    }
    if (at('POST', '/cards/:cid/unassign')) {
      if (c.assignee) hist('unassigned', `Unassigned from ${c.assignee.name}`)
      c.assignee = null
      refresh(db)
      return ok(c)
    }
    if (at('POST', '/cards/:cid/activate') || at('POST', '/cards/:cid/deactivate')) {
      c.status = seg[4] === 'activate' ? 'active' : 'inactive'
      hist(seg[4] === 'activate' ? 'activated' : 'deactivated', seg[4] === 'activate' ? 'Activated' : 'Deactivated')
      refresh(db)
      return ok(c)
    }
    if (at('GET', '/cards/:cid/history')) return ok(db.history.get(c.id) ?? [])
    if (at('GET', '/cards/:cid/taps')) return ok(paginate(db.taps.filter((t) => t.card_id === c.id), q))
    if (at('GET', '/cards/:cid/stats')) {
      const days = RANGE_DAYS[(String(q?.range ?? '30d') as AnalyticsRange)] ?? 30
      const ts = db.taps.filter((t) => t.card_id === c.id && new Date(t.created_at).getTime() >= Date.now() - days * DAY)
      return ok({
        total_taps: ts.length,
        unique_visitors: new Set(ts.map((t) => t.visitor_hash).filter(Boolean)).size,
        timeline: timeline(ts, days),
        by_source: countBy(ts, (t) => t.source).map(([source, taps]) => ({ source, taps })),
        by_device_type: countBy(ts, (t) => t.device_type).map(([device_type, taps]) => ({ device_type, taps })),
        by_country: countBy(ts, (t) => t.country).map(([country, taps]) => ({ country, taps })),
      })
    }
  }

  // ---- actions ----
  if (at('POST', '/actions/preview')) {
    const action = body.action as Action | undefined
    if (!action?.type) return fail(422, 'validation_error', 'Validation failed', [{ field: 'body.action', message: 'Field required' }])
    const errs = validateAction(db, action)
    if (errs) return fail(422, 'invalid_action_config', 'Invalid action configuration', errs)
    return ok(preview(db, action, str(body.card_id) || undefined))
  }

  // ---- employees ----
  if (at('GET', '/employees')) {
    const qs = str(q?.q).toLowerCase()
    const list = db.employees.filter(
      (e) =>
        (!q?.status || e.status === q.status) &&
        (!q?.department || e.department === q.department) &&
        (!qs || [e.full_name, e.email, e.phone, e.position].some((v) => (v ?? '').toLowerCase().includes(qs))),
    )
    return ok(paginate(list, q))
  }
  if (at('POST', '/employees')) {
    const first = str(body.first_name).trim()
    const last = str(body.last_name).trim()
    const errs = [!first && { field: 'body.first_name', message: 'Field required' }, !last && { field: 'body.last_name', message: 'Field required' }].filter(Boolean)
    if (errs.length) return fail(422, 'validation_error', 'Validation failed', errs)
    let slug = `${first}-${last}`.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    if (db.employees.some((e) => e.slug === slug)) slug += `-${rand(90) + 10}`
    const e: Employee = { id: uuid(), business_id: b.id, first_name: first, last_name: last, full_name: `${first} ${last}`, photo_url: null, position: optStr(body.position), department: optStr(body.department), phone: optStr(body.phone), email: optStr(body.email), social_links: (body.social_links as Employee['social_links']) ?? [], slug, status: 'active', profile_published: true, cards: [], total_taps: 0, last_tap_at: null, created_at: now() }
    db.employees.unshift(e)
    db.profiles.push(makeProfile(b, { type: 'employee', slug, title: e.full_name, employee_id: e.id, updated_at: now(), sections: [{ type: 'about', data: { text: e.position ? `${e.position} at ${b.name}.` : '' } }, { type: 'contact', data: { phone: e.phone ?? '', email: e.email ?? '' } }] }))
    return ok(e, 201)
  }
  if (seg[2] === 'employees' && seg[3]) {
    const e = db.employees.find((x) => x.id === seg[3])
    if (!e) return fail(404, 'not_found', 'Employee not found')
    if (at('GET', '/employees/:eid')) return ok(e)
    if (at('PATCH', '/employees/:eid')) {
      for (const f of ['first_name', 'last_name', 'position', 'department', 'phone', 'email', 'social_links'] as const) {
        if (f in body) (e as unknown as Record<string, unknown>)[f] = body[f] ?? null
      }
      e.full_name = `${e.first_name} ${e.last_name}`
      for (const c of db.cards) if (c.assignee?.type === 'employee' && c.assignee.id === e.id) c.assignee.name = e.full_name
      return ok(e)
    }
    if (at('DELETE', '/employees/:eid')) {
      db.employees.splice(db.employees.indexOf(e), 1)
      for (const c of db.cards) if (c.assignee?.id === e.id) c.assignee = null
      db.profiles = db.profiles.filter((p) => p.employee_id !== e.id)
      refresh(db)
      return ok(null, 204)
    }
    if (at('POST', '/employees/:eid/deactivate') || at('POST', '/employees/:eid/activate')) {
      const active = seg[4] === 'activate'
      e.status = active ? 'active' : 'inactive'
      e.profile_published = active
      for (const p of db.profiles) if (p.employee_id === e.id) p.published = active
      refresh(db)
      return ok(e)
    }
    if (at('POST', '/employees/:eid/photo')) {
      e.photo_url = str(body.file_url) || null
      for (const c of db.cards) if (c.assignee?.id === e.id) c.assignee.photo_url = e.photo_url
      return ok(e)
    }
  }

  // ---- customers ----
  if (at('GET', '/customers')) {
    const qs = str(q?.q).toLowerCase()
    const list = db.customers.filter(
      (c) => (!q?.status || c.status === q.status) && (!qs || [c.full_name, c.email, c.phone, c.company, ...c.tags].some((v) => (v ?? '').toLowerCase().includes(qs))),
    )
    return ok(paginate(list, q))
  }
  if (at('POST', '/customers')) {
    const name = str(body.full_name).trim()
    if (!name) return fail(422, 'validation_error', 'Validation failed', [{ field: 'body.full_name', message: 'Field required' }])
    const c: Customer = { id: uuid(), business_id: b.id, full_name: name, email: optStr(body.email), phone: optStr(body.phone), company: optStr(body.company), notes: optStr(body.notes), tags: (body.tags as string[]) ?? [], status: 'active', cards: [], total_taps: 0, last_tap_at: null, created_at: now() }
    db.customers.unshift(c)
    return ok(c, 201)
  }
  if (seg[2] === 'customers' && seg[3]) {
    const c = db.customers.find((x) => x.id === seg[3])
    if (!c) return fail(404, 'not_found', 'Customer not found')
    if (at('GET', '/customers/:id')) return ok(c)
    if (at('PATCH', '/customers/:id')) {
      for (const f of ['full_name', 'email', 'phone', 'company', 'notes', 'tags', 'status'] as const) {
        if (f in body) (c as unknown as Record<string, unknown>)[f] = body[f] ?? null
      }
      for (const card of db.cards) if (card.assignee?.type === 'customer' && card.assignee.id === c.id) card.assignee.name = c.full_name
      return ok(c)
    }
    if (at('DELETE', '/customers/:id')) {
      db.customers.splice(db.customers.indexOf(c), 1)
      for (const card of db.cards) if (card.assignee?.id === c.id) card.assignee = null
      return ok(null, 204)
    }
  }

  // ---- profiles ----
  if (at('GET', '/profiles')) return ok(paginate(db.profiles.filter((p) => !q?.type || p.type === q.type), q, 100))
  if (at('POST', '/profiles')) {
    const type = (body.type as Profile['type']) ?? 'custom'
    if (type === 'business' || type === 'employee') return fail(422, 'validation_error', 'Validation failed', [{ field: 'body.type', message: 'Only custom, menu and product profiles can be created' }])
    const title = str(body.title).trim()
    if (!title) return fail(422, 'validation_error', 'Validation failed', [{ field: 'body.title', message: 'Field required' }])
    const slug = str(body.slug).trim() || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    if (db.profiles.some((p) => p.slug === slug)) return fail(409, 'slug_taken', 'Another page already uses this URL.', { field: 'slug' })
    const p = makeProfile(b, { type, slug, title, published: false, updated_at: now(), sections: (body.sections as Section[]) ?? [], theme: (body.theme as Profile['theme']) ?? { accent: '#b91c1c' } })
    db.profiles.push(p)
    return ok(p, 201)
  }
  if (seg[2] === 'profiles' && seg[3]) {
    const p = db.profiles.find((x) => x.id === seg[3])
    if (!p) return fail(404, 'not_found', 'Profile not found')
    if (at('GET', '/profiles/:pid')) return ok(p)
    if (at('PATCH', '/profiles/:pid')) {
      if (typeof body.slug === 'string' && body.slug !== p.slug) {
        if (p.type === 'business') return fail(422, 'validation_error', 'Validation failed', [{ field: 'body.slug', message: 'The business profile uses the business URL — change it in Business Settings' }])
        if (!/^[a-z0-9-]{3,48}$/.test(body.slug)) return fail(422, 'validation_error', 'Validation failed', [{ field: 'body.slug', message: 'Use 3–48 lowercase letters, numbers or dashes' }])
        if (db.profiles.some((x) => x !== p && x.slug === body.slug)) return fail(409, 'slug_taken', 'Another page already uses this URL.', { field: 'slug' })
        p.slug = body.slug
        p.public_url = `${WEB_BASE}/b/${b.slug}/${p.slug}`
      }
      if (typeof body.title === 'string') p.title = body.title
      if (body.theme) p.theme = body.theme as Profile['theme']
      if (Array.isArray(body.sections)) p.sections = flat(body.sections as Section[])
      p.updated_at = now()
      return ok(p)
    }
    if (at('DELETE', '/profiles/:pid')) {
      if (p.type === 'business' || p.type === 'employee') return fail(409, 'profile_not_deletable', 'Business and employee profiles can’t be deleted — unpublish them instead.')
      db.profiles.splice(db.profiles.indexOf(p), 1)
      return ok(null, 204)
    }
    if (at('POST', '/profiles/:pid/publish') || at('POST', '/profiles/:pid/unpublish')) {
      if (seg[4] === 'publish' && p.employee_id && empById(db, p.employee_id)?.status !== 'active') return fail(409, 'employee_inactive', 'Reactivate the employee before publishing their profile.')
      p.published = seg[4] === 'publish'
      p.updated_at = now()
      const e = empById(db, p.employee_id)
      if (e) e.profile_published = p.published
      return ok(p)
    }
  }

  // ---- taps & analytics ----
  if (at('GET', '/taps')) {
    const list = db.taps.filter(
      (t) =>
        (!q?.source || t.source === q.source) &&
        (!q?.card_id || t.card_id === q.card_id) &&
        (!q?.employee_id || (t.assignee?.type === 'employee' && t.assignee.id === q.employee_id)) &&
        (!q?.customer_id || (t.assignee?.type === 'customer' && t.assignee.id === q.customer_id)) &&
        (!q?.device_id || t.device_id === q.device_id) &&
        (!q?.result || t.result === q.result) &&
        (!q?.date_from || t.created_at >= String(q.date_from)) &&
        (!q?.date_to || t.created_at <= String(q.date_to)),
    )
    return ok(paginate(list, q))
  }
  if (at('GET', '/analytics')) {
    const denied = need(db, 'analytics.view')
    return denied ?? ok(analytics(db, q))
  }
  if (at('GET', '/api-usage')) {
    const denied = need(db, 'api.view')
    if (denied) return denied
    const hours = ({ '1h': 1, '24h': 24, '7d': 168, '30d': 720 } as Record<string, number>)[String(q?.range ?? '7d')] ?? 168
    const total = Math.round(hours * (18 + rand(6)))
    const errors = Math.round(total * 0.011)
    const share = (f: number) => Math.round(total * f)
    return ok({
      range: q?.range ?? '7d',
      totals: { requests: total, errors, error_rate: total ? Math.round((errors / total) * 10000) / 10000 : 0 },
      by_route: [
        { route: '/api/v1/device/heartbeat', count: share(0.5), error_rate: 0.001, p95_ms: 38 },
        { route: '/api/v1/device/events', count: share(0.3), error_rate: 0.02, p95_ms: 182 },
        { route: '/t/{public_code}', count: share(0.15), error_rate: 0.004, p95_ms: 61 },
        { route: '/api/v1/device/config', count: share(0.04), error_rate: 0, p95_ms: 44 },
        { route: '/api/v1/device/business/cards', count: share(0.01), error_rate: 0.05, p95_ms: 90 },
      ],
      by_device: db.devices.filter((d) => d.status === 'active').map((d, i) => ({ device_id: d.id, name: d.name, count: share(i === 0 ? 0.55 : 0.3), errors: rand(12) })),
      by_api_key: db.keys.slice(0, 1).map((k) => ({ api_key_id: k.id, count: share(0.01), errors: 0 })),
    })
  }

  // ---- applications & devices ----
  if (at('GET', '/applications')) return ok(db.apps)
  if (at('POST', '/applications')) return handlePart1('POST', ['applications'], q, { ...body, business_id: b.id }, (m, pat) => m === 'POST' && pat === '/applications')
  if (at('GET', '/devices')) return ok(db.devices)
  if (seg[2] === 'devices' && seg[3]) {
    const d = db.devices.find((x) => x.id === seg[3])
    if (!d) return fail(404, 'not_found', 'Device not found')
    if (at('PATCH', '/devices/:did')) {
      if (typeof body.name === 'string' && body.name.trim()) d.name = body.name.trim()
      if ('assigned_employee_id' in body) {
        const e = empById(db, body.assigned_employee_id as string)
        d.assigned_employee = e ? { id: e.id, name: e.full_name } : null
      }
      return ok(d)
    }
    if (at('GET', '/devices/:did/activity')) {
      const routes = ['/api/v1/device/heartbeat', '/api/v1/device/events', '/api/v1/device/config']
      const logs = Array.from({ length: 14 }, (_, i) => {
        const route = routes[i % 3 === 1 ? 1 : i % 5 === 0 ? 2 : 0]
        const err = i === 4
        return { id: uuid(), created_at: ago(i * 7 * MIN + 30_000), request_id: hex(8).toLowerCase(), method: route.endsWith('config') ? 'GET' : 'POST', route, path: route, status_code: err ? 422 : 200, outcome: err ? 'client_error' : 'success', latency_ms: 20 + rand(180), error_code: err ? 'validation_error' : null, error_ref: err ? 'NFC-2001' : null, actor_type: 'device', device_id: d.id }
      })
      return ok({ taps: db.taps.filter((t) => t.device_id === d.id).slice(0, 20), request_logs: d.status === 'active' ? logs : [] })
    }
  }

  if (seg[2] === 'members') {
    if (at('GET', '/members')) return ok(db.members.map((m) => ({ ...m, permissions: [...new Set([...ROLE_PERMISSIONS[m.role], ...m.extra_permissions])] })))
    const m = db.members.find((x) => x.id === seg[3])
    if (!m) return fail(404, 'not_found', 'Member not found')
    const owners = db.members.filter((x) => x.role === 'owner' && x.status === 'active')
    if ((m.role === 'owner' || body.role === 'owner') && db.role !== 'owner') return fail(403, 'insufficient_permissions', 'Only owners can change owners.', { required: 'ownership.transfer' })
    if (at('PATCH', '/members/:mid')) {
      if (m.email === 'dev@example.com' && body.role && body.role !== m.role) return fail(409, 'cannot_edit_self', 'You can’t change your own role.')
      if (m.role === 'owner' && ((body.role && body.role !== 'owner') || body.status === 'suspended') && owners.length <= 1) return fail(409, 'last_owner', 'A business must always have at least one active owner.')
      if (body.role) m.role = body.role as BusinessRole
      if (Array.isArray(body.extra_permissions)) m.extra_permissions = body.extra_permissions as Permission[]
      if (body.status === 'active' || body.status === 'suspended') m.status = body.status
      return ok(m)
    }
    if (at('DELETE', '/members/:mid')) {
      if (m.role === 'owner' && owners.length <= 1) return fail(409, 'last_owner', 'A business must always have at least one active owner.')
      db.members.splice(db.members.indexOf(m), 1)
      return ok(null, 204)
    }
  }
  if (seg[2] === 'invitations') {
    const strip = (i: Invitation & { token: string }) => ({ ...i, token: undefined })
    if (at('GET', '/invitations')) return ok(db.invitations.map(strip))
    if (at('POST', '/invitations')) {
      const email = str(body.email).trim().toLowerCase()
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(422, 'validation_error', 'Validation failed', [{ field: 'body.email', message: 'Enter a valid email address' }])
      if (db.members.some((m) => m.email === email)) return fail(409, 'already_member', 'This person is already a member.')
      if (db.role !== 'owner' && body.role === 'owner') return fail(403, 'insufficient_permissions', 'Only owners can invite owners.', { required: 'ownership.transfer' })
      const token = urlsafe(24)
      const inv = { id: uuid(), token, email, role: (body.role as BusinessRole) ?? 'staff', status: 'pending' as const, invited_by: 'You', expires_at: ago(-7 * DAY), created_at: now() }
      db.invitations.unshift(inv)
      return ok({ ...strip(inv), dev_invite_url: `${WEB_BASE}/invite/${token}` }, 201)
    }
    const inv = db.invitations.find((x) => x.id === seg[3])
    if (!inv) return fail(404, 'not_found', 'Invitation not found')
    if (at('POST', '/invitations/:iid/revoke')) {
      inv.status = 'revoked'
      return ok(strip(inv))
    }
    if (at('POST', '/invitations/:iid/resend')) {
      inv.status = 'pending'
      inv.expires_at = ago(-7 * DAY)
      return ok({ ...strip(inv), dev_invite_url: `${WEB_BASE}/invite/${inv.token}` })
    }
  }

  return fail(404, 'not_found', `Mock: no business handler for ${method} ${path}`)
}

// ---------- Part 1 endpoints for business-owned resources ----------

function findBizApp(seg: string[]): Db | null {
  seed()
  const id = seg[1]
  if (!id) return null
  for (const db of dbs) {
    if (seg[0] === 'applications' && db.apps.some((a) => a.id === id)) return db
    if (seg[0] === 'api-keys' && db.keys.some((k) => k.id === id)) return db
    if (seg[0] === 'devices' && db.devices.some((d) => d.id === id)) return db
    if (seg[0] === 'events' && db.events.some((e) => e.id === id)) return db
    if (seg[0] === 'pairing-codes' && pairings.get(id)?.bid === db.business.id) return db
  }
  return null
}

function handlePart1(method: string, seg: string[], q: Query, body: Body, is: (m: string, p: string) => boolean): RawResponse | null {
  // Creating a business application (Part 1 endpoint + business_id).
  if (is('POST', '/applications') && typeof body.business_id === 'string') {
    const db = dbs.find((d) => d.business.id === body.business_id)
    if (!db) return fail(404, 'not_found', 'Business not found')
    const denied = need(db, 'api.manage')
    if (denied) return denied
    const name = str(body.name).trim()
    if (!name) return fail(422, 'validation_error', 'Validation failed', [{ field: 'body.name', message: 'Field required' }])
    const secret = str(body.webhook_secret) || `whsec_${urlsafe(43)}`
    const app: BusinessApplication = { id: uuid(), business_id: db.business.id, name, description: optStr(body.description), is_active: true, delivery_mode: (body.delivery_mode as 'relay' | 'direct') ?? 'relay', endpoint: { url: optStr(body.endpoint_url), enabled: !!optStr(body.endpoint_url), timeout_seconds: 10, custom_headers: {}, last_tested_at: null, last_test_success: null }, webhook_secret: { configured: true, last4: secret.slice(-4), rotated_at: null }, allowed_domains: [], device_count: 0, created_at: now(), updated_at: now() }
    db.apps.push(app)
    const plaintext = `nfc_${urlsafe(48)}`
    const key: ApiKey = { id: uuid(), application_id: app.id, application_name: app.name, name: 'Default key', prefix: plaintext.slice(0, 12), last4: plaintext.slice(-4), created_at: now(), last_used_at: null, revoked_at: null, is_active: true }
    db.keys.unshift(key)
    return ok({ application: app, api_key: key, api_key_plaintext: plaintext, webhook_secret_plaintext: secret }, 201)
  }
  if (is('POST', '/api-keys')) {
    const db = dbs.find((d) => d.apps.some((a) => a.id === body.application_id))
    if (!db) return null
    const app = db.apps.find((a) => a.id === body.application_id)!
    const plaintext = `nfc_${urlsafe(48)}`
    const key: ApiKey = { id: uuid(), application_id: app.id, application_name: app.name, name: str(body.name) || 'API key', prefix: plaintext.slice(0, 12), last4: plaintext.slice(-4), created_at: now(), last_used_at: null, revoked_at: null, is_active: true }
    db.keys.unshift(key)
    return ok({ api_key: key, plaintext }, 201)
  }
  if (is('GET', '/api-keys') && q?.application_id) {
    const db = dbs.find((d) => d.apps.some((a) => a.id === q.application_id))
    return db ? ok(db.keys.filter((k) => k.application_id === q.application_id)) : null
  }
  if (is('GET', '/deliveries') && q?.application_id) {
    const db = dbs.find((d) => d.apps.some((a) => a.id === q.application_id))
    if (!db) return null
    return ok(paginate(db.deliveries.filter((d) => d.application_id === q.application_id && (q.success == null || String(d.success) === String(q.success))), q))
  }
  if (is('GET', '/devices') && q?.application_id) {
    const db = dbs.find((d) => d.apps.some((a) => a.id === q.application_id))
    return db ? ok(db.devices.filter((d) => d.application_id === q.application_id && (!q.status || d.status === q.status))) : null
  }

  const db = findBizApp(seg)
  if (!db) return null
  const id = seg[1]

  if (seg[0] === 'applications') {
    const app = db.apps.find((a) => a.id === id)!
    if (is('GET', '/applications/:id')) return ok(app)
    if (method !== 'GET') {
      const perm: Permission = seg[2] === 'pairing-codes' ? 'devices.manage' : 'api.manage'
      const denied = need(db, perm)
      if (denied) return denied
    }
    if (is('PATCH', '/applications/:id')) {
      if (typeof body.name === 'string') app.name = body.name
      if (typeof body.description === 'string') app.description = body.description
      if (typeof body.is_active === 'boolean') app.is_active = body.is_active
      app.updated_at = now()
      return ok(app)
    }
    if (is('DELETE', '/applications/:id')) {
      if (app.name === 'Business Terminal') return fail(409, 'application_protected', 'The Business Terminal application can’t be deleted.')
      db.apps.splice(db.apps.indexOf(app), 1)
      return ok(null, 204)
    }
    if (is('PUT', '/applications/:id/endpoint')) {
      const url = (body.url as string | null) ?? null
      if (url && !/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(url)) return fail(422, 'validation_error', 'Validation failed', [{ field: 'body.url', message: 'Endpoint must use https://' }])
      app.endpoint = { ...app.endpoint, url, enabled: Boolean(body.enabled), timeout_seconds: Number(body.timeout_seconds ?? app.endpoint.timeout_seconds), custom_headers: (body.custom_headers as Record<string, string>) ?? app.endpoint.custom_headers }
      if (body.delivery_mode) app.delivery_mode = body.delivery_mode as 'relay' | 'direct'
      app.updated_at = now()
      return ok(app)
    }
    if (is('PUT', '/applications/:id/allowed-domains')) {
      app.allowed_domains = Array.isArray(body.domains) ? (body.domains as string[]) : []
      return ok(app)
    }
    if (is('POST', '/applications/:id/endpoint/test')) {
      const success = !!app.endpoint.url && !app.endpoint.url.includes('fail')
      const latency = 80 + rand(300)
      app.endpoint.last_tested_at = now()
      app.endpoint.last_test_success = success
      db.deliveries.unshift({ id: uuid(), event_id: uuid(), application_id: app.id, attempt: 1, mode: 'relay', url: app.endpoint.url ?? '', success, status_code: success ? 200 : null, latency_ms: latency, error: success ? null : 'endpoint_not_configured', response_excerpt: success ? '{"ok":true}' : null, created_at: now() })
      return ok({ success, status_code: success ? 200 : null, latency_ms: latency, error: success ? null : 'No endpoint URL configured', response_excerpt: success ? '{"ok":true}' : null })
    }
    if (is('POST', '/applications/:id/webhook-secret/rotate')) {
      const secret = str(body.webhook_secret) || `whsec_${urlsafe(43)}`
      app.webhook_secret = { configured: true, last4: secret.slice(-4), rotated_at: now() }
      return ok({ webhook_secret_plaintext: secret, last4: secret.slice(-4), rotated_at: app.webhook_secret.rotated_at })
    }
    if (is('POST', '/applications/:id/pairing-codes')) {
      const code = `nfcp_${urlsafe(32)}`
      const pid = uuid()
      const serverUrl = 'http://192.168.1.10:8000'
      const name = optStr(body.device_name)
      const expires_at = ago(-10 * MIN)
      pairings.set(pid, { id: pid, bid: db.business.id, application_id: app.id, status: 'pending', expires_at, used_at: null, device: null })
      setTimeout(() => {
        const p = pairings.get(pid)
        if (!p || p.status !== 'pending') return
        const d: BusinessDevice = { id: uuid(), application_id: app.id, application_name: app.name, name: name ?? 'Pixel 9 (paired)', platform: 'android', model: 'Pixel 9', os_version: 'Android 16', app_version: '2.0.0', status: 'active', last_seen_at: now(), last_ip: '192.168.1.57', events_count: 0, created_at: now(), assigned_employee: null, last_scan_at: null, online: true }
        db.devices.unshift(d)
        refresh(db)
        p.status = 'used'
        p.used_at = now()
        p.device = d
      }, 7000)
      const qs = `v=1&server=${encodeURIComponent(serverUrl)}&code=${code}${name ? `&name=${encodeURIComponent(name)}` : ''}`
      return ok({ id: pid, code, expires_at, server_url: serverUrl, qr_payload: `nfcterminal://pair?${qs}` }, 201)
    }
  }
  if (seg[0] === 'pairing-codes') {
    const p = pairings.get(id)!
    if (p.status === 'pending' && p.expires_at < now()) p.status = 'expired'
    const { bid: _bid, ...pub } = p
    void _bid
    if (is('GET', '/pairing-codes/:id')) return ok(pub)
    if (is('POST', '/pairing-codes/:id/cancel')) {
      if (p.status === 'pending') p.status = 'expired'
      return ok(null, 204)
    }
  }
  if (seg[0] === 'api-keys' && is('POST', '/api-keys/:id/revoke')) {
    const k = db.keys.find((x) => x.id === id)!
    k.is_active = false
    k.revoked_at = now()
    return ok(k)
  }
  if (seg[0] === 'devices') {
    const d = db.devices.find((x) => x.id === id)!
    if (is('GET', '/devices/:id')) return ok(d)
    const denied = method !== 'GET' ? need(db, 'devices.manage') : null
    if (denied) return denied
    if (is('POST', '/devices/:id/revoke')) {
      d.status = 'revoked'
      refresh(db)
      return ok(d)
    }
    if (is('PATCH', '/devices/:id')) {
      if (typeof body.name === 'string') d.name = body.name
      return ok(d)
    }
    if (is('DELETE', '/devices/:id')) {
      db.devices.splice(db.devices.indexOf(d), 1)
      refresh(db)
      return ok(null, 204)
    }
  }
  if (seg[0] === 'events') {
    const e = db.events.find((x) => x.id === id)!
    if (is('GET', '/events/:id')) return ok({ ...e, deliveries: db.deliveries.filter((d) => d.event_id === e.id) })
    if (is('POST', '/events/:id/redeliver')) {
      const app = db.apps.find((a) => a.id === e.application_id)
      const d: Delivery = { id: uuid(), event_id: e.id, application_id: e.application_id, attempt: e.attempts + 1, mode: 'relay', url: app?.endpoint.url ?? '', success: !!app?.endpoint.url, status_code: app?.endpoint.url ? 200 : null, latency_ms: 90 + rand(200), error: app?.endpoint.url ? null : 'endpoint_not_configured', response_excerpt: null, created_at: now() }
      db.deliveries.unshift(d)
      e.attempts++
      return ok(d)
    }
  }
  return null
}

// Simulate live web taps so the overview / events pages have something new to show.
setInterval(() => {
  if (!dbs.length || Math.random() < 0.4) return
  const db = dbs[0]
  const card = pick(db.cards.filter((c) => c.programmed))
  const t = addTap(db, card, Date.now(), 'web')
  db.taps.sort((a, b) => b.created_at.localeCompare(a.created_at))
  db.devices[0].last_seen_at = t.created_at
}, 9000)

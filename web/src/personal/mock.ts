/**
 * DEV-ONLY in-memory mock of the Part 4 personal API (contract §1, §2, §4, §6). Imported only by
 * src/api/mock/server.ts (mock mode), never in production builds. Returns null for routes it doesn't own.
 */
import type { RawResponse } from '@/api/client'
import type {
  ActivityItem,
  BusinessInvite,
  CardDesign,
  CardFields,
  CardTemplate,
  Contact,
  DigitalCard,
  PersonalSession,
  Visibility,
  VisibilityKey,
} from './api/types'
import { DEFAULT_VISIBILITY } from './lib/design'

type Query = Record<string, string | number | boolean | null | undefined> | undefined
type Body = Record<string, unknown>

let seedState = 0x51ed27a1
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
const b64 = (n: number) => bytes(n).map((b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[b % 64]).join('')
const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z')
const now = () => iso(Date.now())
const ago = (ms: number) => iso(Date.now() - ms)
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const rand = (n: number) => Math.floor(rnd() * n)
const pick = <T,>(xs: T[]): T => xs[rand(xs.length)]
const WEB = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173'
const REFS: Record<string, string> = { not_found: 'NFC-2004', validation_error: 'NFC-2001', card_unavailable: 'NFC-6041', plan_limit_reached: 'NFC-7001', field_locked: 'NFC-6043', slug_taken: 'NFC-6002', invalid_login_code: 'NFC-1020' }
const ok = (body: unknown, status = 200): RawResponse => ({ status, headers: new Headers(), body })
const fail = (status: number, code: string, message: string, details: unknown = null): RawResponse => ({
  status,
  headers: new Headers(),
  body: { error: { code, message, details, ref: REFS[code] ?? 'NFC-9000', request_id: b64(16).toLowerCase() } },
})
function paginate<T>(items: T[], q: Query, def = 20) {
  const page = Math.max(1, Number(q?.page) || 1)
  const page_size = Math.min(100, Math.max(1, Number(q?.page_size) || def))
  return { items: items.slice((page - 1) * page_size, page * page_size), total: items.length, page, page_size }
}
const str = (v: unknown) => (typeof v === 'string' ? v : '')

// ---------- templates ----------

const design = (p: Partial<CardDesign>): CardDesign => ({
  primary: '#b91c1c', background: '#ffffff', text: '#1c1717', accent: '#b91c1c', background_style: 'solid', pattern: null, font: 'sans', corner_radius: 20, show_qr: true, ...p,
})
const templates: CardTemplate[] = [
  { id: 'modern', name: 'Modern', description: 'Round photo, centred name and quick actions.', layout: 'centered', default_design: design({}), supports: { photo: true, cover: false, logo: true }, premium: false },
  { id: 'classic', name: 'Classic', description: 'Photo beside your name, clean and left-aligned.', layout: 'left', default_design: design({ primary: '#1f2937', accent: '#b91c1c', font: 'serif', corner_radius: 12 }), supports: { photo: true, cover: false, logo: true }, premium: false },
  { id: 'minimal', name: 'Minimal', description: 'Quiet and typographic.', layout: 'centered', default_design: design({ primary: '#111111', accent: '#57524f', font: 'display', corner_radius: 8, show_qr: false }), supports: { photo: true, cover: false, logo: false }, premium: false },
  { id: 'gradient', name: 'Gradient', description: 'A colourful banner that fades into your details.', layout: 'banner', default_design: design({ primary: '#dc2626', accent: '#ea580c', background_style: 'gradient' }), supports: { photo: true, cover: true, logo: true }, premium: false },
  { id: 'glass', name: 'Glass', description: 'Frosted glass on a dark backdrop.', layout: 'centered', default_design: design({ primary: '#f43f5e', background: '#18181b', text: '#f4f4f5', accent: '#fb7185', background_style: 'glass', corner_radius: 28 }), supports: { photo: true, cover: false, logo: true }, premium: true },
  { id: 'bold', name: 'Bold', description: 'A strong colour panel with your photo.', layout: 'split', default_design: design({ primary: '#991b1b', accent: '#991b1b', font: 'display', corner_radius: 16 }), supports: { photo: true, cover: false, logo: true }, premium: false },
  { id: 'split', name: 'Split', description: 'Colour panel on top, details below.', layout: 'split', default_design: design({ primary: '#0f766e', accent: '#0d9488', background_style: 'pattern', pattern: 'dots' }), supports: { photo: true, cover: false, logo: true }, premium: false },
  { id: 'photo_hero', name: 'Photo hero', description: 'Your photo, big, with your name over it.', layout: 'hero_photo', default_design: design({ primary: '#1d4ed8', accent: '#2563eb', corner_radius: 24 }), supports: { photo: true, cover: true, logo: true }, premium: true },
  { id: 'business_card', name: 'Business card', description: 'Classic 1.75:1 card with logo and QR.', layout: 'compact', default_design: design({ primary: '#1c1717', accent: '#b91c1c', font: 'sans', corner_radius: 10 }), supports: { photo: false, cover: false, logo: true }, premium: false },
]

// ---------- state ----------

let seeded = false
const cards: DigitalCard[] = []
const contacts: Contact[] = []
const activity: ActivityItem[] = []
const sessions: PersonalSession[] = []
const invites: BusinessInvite[] = []
const loginCodes = new Map<string, { status: 'pending' | 'used' | 'expired'; expires_at: string; session: PersonalSession | null }>()

const baseFields = (p: Partial<CardFields>): CardFields => ({ full_name: '', phones: [], emails: [], websites: [], socials: [], custom_links: [], ...p })

function makeCard(p: Partial<DigitalCard> & { label: string; template_id: string; fields: CardFields; slug: string }): DigitalCard {
  const t = templates.find((x) => x.id === p.template_id) ?? templates[0]
  return {
    id: uuid(),
    share_id: uuid(),
    is_primary: false,
    status: 'active',
    public_url: `${WEB}/p/${p.slug}`,
    design: { ...t.default_design },
    photo_url: null,
    cover_url: null,
    logo_url: null,
    visibility: { ...DEFAULT_VISIBILITY },
    share_settings: { auto_exchange: true, web_page_enabled: true, lead_capture_enabled: true, nfc_sharing_enabled: true },
    business_link: null,
    stats: { views: 0, nfc_taps: 0, exchanges: 0, leads: 0 },
    created_at: ago(30 * DAY),
    updated_at: ago(2 * DAY),
    ...p,
  }
}

const people: [string, string, string, string][] = [
  ['Amara Mensah', 'Product Designer', 'Figma', 'Design'],
  ['Kenji Watanabe', 'Founder', 'Tsuru Labs', 'Startups'],
  ['Lucía Fernández', 'Head of Sales', 'Norte Foods', 'Sales'],
  ['David Cohen', 'Engineering Manager', 'Stripe', 'Engineering'],
  ['Fatima Al-Sayed', 'Architect', 'Studio Noor', 'Design'],
  ['Oskar Nilsson', 'Photographer', 'Freelance', 'Creative'],
  ['Priya Raman', 'VC Partner', 'Blue Harbor Capital', 'Investors'],
  ['Tomás Novak', 'Barista trainer', 'Acme Café', 'Hospitality'],
  ['Grace Wanjiru', 'Community Lead', 'kLab', 'Community'],
  ['Marco Bianchi', 'Chef', 'Osteria Nove', 'Hospitality'],
  ['Hannah Schmidt', 'Recruiter', 'Talentia', 'Hiring'],
  ['Yusuf Demir', 'Data Scientist', 'Aydın AI', 'Engineering'],
  ['Chloé Martin', 'Journalist', 'Le Monde Tech', 'Press'],
  ['Samuel Okoro', 'Software Engineer', 'Paystack', 'Engineering'],
]

function seed() {
  if (seeded) return
  seeded = true
  const work = makeCard({
    label: 'Work',
    template_id: 'modern',
    slug: 'ada-developer',
    is_primary: true,
    fields: baseFields({
      full_name: 'Ada Developer',
      pronouns: 'she/her',
      headline: 'Building NFC products people love',
      job_title: 'Product Engineer',
      company: 'Nexventures',
      bio: 'I help teams ship hardware-meets-web experiences. Ask me about NFC, payments and good coffee.',
      phones: [{ label: 'Mobile', value: '+250788123456' }],
      emails: [{ label: 'Work', value: 'ada@nexventures.example' }],
      websites: [{ label: 'Website', url: 'https://nexventures.net' }],
      address: 'Kigali Heights, Kigali, Rwanda',
      socials: [
        { platform: 'linkedin', url: 'https://linkedin.com/in/ada-dev' },
        { platform: 'github', url: 'https://github.com/ada-dev' },
      ],
      custom_links: [{ label: 'Book a meeting', url: 'https://cal.example.com/ada' }],
    }),
    stats: { views: 482, nfc_taps: 131, exchanges: 57, leads: 12 },
  })
  const personal = makeCard({
    label: 'Personal',
    template_id: 'photo_hero',
    slug: 'ada-d',
    design: { ...templates.find((t) => t.id === 'photo_hero')!.default_design, primary: '#be123c', accent: '#e11d48' },
    fields: baseFields({
      full_name: 'Ada D.',
      headline: 'Runner · Coffee nerd · Maker',
      phones: [{ label: 'Mobile', value: '+250788123456' }],
      socials: [{ platform: 'instagram', url: 'https://instagram.com/ada.makes' }],
    }),
    stats: { views: 64, nfc_taps: 18, exchanges: 9, leads: 0 },
  })
  cards.push(work, personal)

  for (const [i, [name, title, company, tag]] of people.entries()) {
    const t = templates[i % templates.length]
    const first = name.split(' ')[0].toLowerCase().normalize('NFKD').replace(/[^\w]/g, '')
    const source: Contact['source'] = i % 5 === 3 ? 'web_lead' : i % 4 === 1 ? 'qr_exchange' : i === 13 ? 'manual' : 'nfc_exchange'
    contacts.push({
      id: uuid(),
      source,
      counterpart_user_id: source === 'web_lead' || source === 'manual' ? null : uuid(),
      counterpart_card_id: source === 'web_lead' || source === 'manual' ? null : uuid(),
      card: {
        layout: t.layout,
        template_id: t.id,
        design: { ...t.default_design, primary: pick(['#b91c1c', '#0f766e', '#1d4ed8', '#b45309', '#334155', '#be123c']) },
        fields: baseFields({
          full_name: name,
          job_title: title,
          company,
          headline: i % 3 === 0 ? `${title} at ${company}` : null,
          phones: [{ label: 'Mobile', value: `+2507${String(80000000 + i * 1234567).slice(0, 8)}` }],
          emails: [{ label: 'Work', value: `${first}@${company.toLowerCase().replace(/[^a-z]/g, '') || 'mail'}.example` }],
          websites: i % 2 ? [{ label: 'Website', url: `https://${company.toLowerCase().replace(/[^a-z]/g, '')}.example` }] : [],
          socials: [{ platform: 'linkedin', url: `https://linkedin.com/in/${first}` }],
        }),
        photo_url: null,
      },
      live: source === 'nfc_exchange' || source === 'qr_exchange',
      notes: i === 0 ? 'Met at the Kigali design meetup — wants a demo of the NFC terminal.' : i === 6 ? 'Interested in the seed round. Follow up in October.' : null,
      tags: [tag, ...(i % 4 === 0 ? ['Follow up'] : [])],
      favorite: i % 5 === 0,
      met_at: ago((i * 3 + 1) * DAY + rand(10) * HOUR),
      created_at: ago((i * 3 + 1) * DAY),
      updated_at: ago(i * DAY),
    })
  }

  const types: ActivityItem['type'][] = ['view', 'view', 'view', 'nfc_tap', 'exchange', 'lead', 'terminal_read']
  for (let i = 0; i < 60; i++) {
    const type = pick(types)
    const c = contacts[rand(contacts.length)]
    activity.push({
      id: uuid(),
      type,
      card_id: rnd() < 0.8 ? work.id : personal.id,
      card_label: null,
      source: type === 'view' ? pick(['nfc', 'qr', 'link']) : null,
      counterpart_name: type === 'exchange' || type === 'lead' ? c.card.fields.full_name : null,
      description: type === 'terminal_read' ? 'Read by a terminal of Acme Café' : null,
      created_at: ago(Math.floor(Math.pow(rnd(), 1.4) * 30 * DAY)),
    })
  }
  activity.sort((a, b) => b.created_at.localeCompare(a.created_at))
  for (const a of activity) a.card_label = cards.find((c) => c.id === a.card_id)?.label ?? null

  sessions.push(
    { id: uuid(), device_name: 'Ada’s Pixel 8', platform: 'android', model: 'Pixel 8', app_version: '2.1.0', created_at: ago(20 * DAY), last_seen_at: ago(4 * MIN), revoked_at: null },
    { id: uuid(), device_name: 'Galaxy S23', platform: 'android', model: 'SM-S911B', app_version: '2.0.3', created_at: ago(60 * DAY), last_seen_at: ago(9 * DAY), revoked_at: null },
  )
  invites.push({
    id: uuid(),
    business_name: 'Acme Café',
    business_logo_url: null,
    employee_name: 'Ada Developer',
    email: 'dev@example.com',
    template_id: 'bold',
    design: { primary: '#991b1b', accent: '#b91c1c' },
    locked_fields: ['company', 'job_title', 'logo'],
    status: 'pending',
    created_at: ago(1 * DAY),
    expires_at: ago(-6 * DAY),
  })
}

// ---------- helpers ----------

const PUBLIC_KEYS: VisibilityKey[] = ['full_name', 'pronouns', 'headline', 'job_title', 'company', 'department', 'bio', 'phones', 'emails', 'websites', 'address', 'socials', 'custom_links']

function publicFields(c: DigitalCard): Partial<CardFields> & { full_name: string } {
  const vis = (k: VisibilityKey): Visibility => c.visibility[k] ?? DEFAULT_VISIBILITY[k]
  const out: Record<string, unknown> = { full_name: c.fields.full_name }
  for (const k of PUBLIC_KEYS) if (vis(k) === 'public') out[k] = (c.fields as unknown as Record<string, unknown>)[k]
  return out as Partial<CardFields> & { full_name: string }
}

function vcard(f: Partial<CardFields> & { full_name: string }): string {
  return [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${f.full_name}`,
    f.company ? `ORG:${f.company}` : '',
    f.job_title ? `TITLE:${f.job_title}` : '',
    ...(f.phones ?? []).map((p) => `TEL;TYPE=${p.label.toUpperCase()}:${p.value}`),
    ...(f.emails ?? []).map((e) => `EMAIL;TYPE=${e.label.toUpperCase()}:${e.value}`),
    ...(f.websites ?? []).map((w) => `URL:${w.url}`),
    'END:VCARD',
  ]
    .filter(Boolean)
    .join('\r\n')
}

function statsFor(range: string) {
  const days = range === '7d' ? 7 : range === '90d' ? 90 : 30
  const tl = Array.from({ length: days }, (_, i) => {
    const date = new Date(Date.now() - (days - 1 - i) * DAY).toISOString().slice(0, 10)
    const w = 1 + (i % 7 < 5 ? 1 : 0)
    return { date, views: rand(14) * w, nfc_taps: rand(5) * w, exchanges: rand(3), leads: rnd() < 0.2 ? 1 : 0 }
  })
  const sum = (k: 'views' | 'nfc_taps' | 'exchanges' | 'leads') => tl.reduce((a, x) => a + x[k], 0)
  const totals = { views: sum('views'), nfc_taps: sum('nfc_taps'), exchanges: sum('exchanges'), leads: sum('leads') }
  return {
    totals,
    previous_totals: { views: Math.round(totals.views * 0.8), nfc_taps: Math.round(totals.nfc_taps * 0.9), exchanges: Math.max(0, totals.exchanges - 3), leads: Math.max(0, totals.leads - 1) },
    timeline: tl,
    by_source: [
      { source: 'nfc', count: Math.round(totals.views * 0.46) },
      { source: 'qr', count: Math.round(totals.views * 0.31) },
      { source: 'link', count: Math.round(totals.views * 0.23) },
    ],
  }
}

const slugify = (v: string) => v.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'card'
function uniqueSlug(base: string) {
  let s = slugify(base)
  while (cards.some((c) => c.slug === s)) s = `${slugify(base)}-${rand(900) + 100}`
  return s
}

// ---------- handler ----------

export function handlePersonalMock(method: string, path: string, q: Query, body: Body, token: string | null): RawResponse | null {
  const seg = path.split('/').filter(Boolean)
  const is = (m: string, pattern: string) => {
    if (m !== method) return false
    const p = pattern.split('/').filter(Boolean)
    return p.length === seg.length && p.every((x, i) => x.startsWith(':') || x === seg[i])
  }
  if (seg[0] !== 'personal' && !(seg[0] === 'public' && seg[1] === 'p')) return null
  seed()

  // ---- public ----
  if (is('GET', '/personal/templates')) return ok(templates)
  if (seg[0] === 'public') {
    const card = cards.find((c) => c.slug === seg[2])
    if (!card || card.status !== 'active' || !card.share_settings.web_page_enabled) return fail(404, 'card_unavailable', 'This card isn’t available.')
    if (is('GET', '/public/p/:slug')) {
      card.stats.views++
      const t = templates.find((x) => x.id === card.template_id) ?? templates[0]
      const pub = publicFields(card)
      return ok({
        card: {
          design: card.design,
          template: { id: t.id, layout: t.layout, name: t.name },
          fields: pub,
          photo_url: (card.visibility.photo ?? 'public') === 'public' ? card.photo_url : null,
          cover_url: card.cover_url,
          logo_url: card.logo_url,
          public_url: card.public_url,
          business: card.business_link ? { name: card.business_link.business_name, logo_url: null, verified: true } : null,
        },
        lead_capture_enabled: card.share_settings.lead_capture_enabled,
        vcard_url: `data:text/vcard;charset=utf-8,${encodeURIComponent(vcard(pub))}`,
      })
    }
    if (is('POST', '/public/p/:slug/leads')) {
      if (str(body.website)) return ok({ ok: true }, 201) // honeypot: silently accepted, discarded
      const name = str(body.full_name).trim()
      if (!name) return fail(422, 'validation_error', 'Validation failed', [{ field: 'body.full_name', message: 'Field required' }])
      if (!str(body.email) && !str(body.phone)) return fail(422, 'validation_error', 'Validation failed', [{ field: 'body.email', message: 'Leave an email or a phone number' }])
      contacts.unshift({
        id: uuid(),
        source: 'web_lead',
        counterpart_user_id: null,
        counterpart_card_id: null,
        card: { design: { ...templates[0].default_design }, layout: 'centered', fields: baseFields({ full_name: name, company: str(body.company) || null, emails: str(body.email) ? [{ label: 'Email', value: str(body.email) }] : [], phones: str(body.phone) ? [{ label: 'Phone', value: str(body.phone) }] : [] }) },
        live: false,
        notes: str(body.message) || null,
        tags: ['Lead'],
        favorite: false,
        met_at: now(),
        created_at: now(),
        updated_at: now(),
      })
      card.stats.leads++
      return ok({ ok: true }, 201)
    }
    return null
  }

  if (!token) return fail(401, 'not_authenticated', 'Not authenticated')

  // ---- cards ----
  if (is('GET', '/personal/cards')) return ok(cards)
  if (is('POST', '/personal/cards')) {
    if (cards.length >= 3) return fail(402, 'plan_limit_reached', 'Your Free plan allows 3 cards. Upgrade to Pro for up to 20.', { limit: 'cards' })
    const t = templates.find((x) => x.id === body.template_id) ?? templates[0]
    const base = cards.find((c) => c.is_primary) ?? cards[0]
    const label = str(body.label) || 'New card'
    const c = makeCard({ label, template_id: t.id, slug: uniqueSlug(`${base?.fields.full_name ?? 'card'} ${label}`), fields: { ...(base?.fields ?? baseFields({ full_name: 'Your name' })) }, created_at: now(), updated_at: now(), stats: { views: 0, nfc_taps: 0, exchanges: 0, leads: 0 } })
    cards.push(c)
    return ok(c, 201)
  }
  if (seg[1] === 'cards' && seg[2]) {
    const c = cards.find((x) => x.id === seg[2])
    if (!c) return fail(404, 'not_found', 'Card not found')
    if (is('GET', '/personal/cards/:id')) return ok(c)
    if (is('PATCH', '/personal/cards/:id')) {
      const locked = c.business_link?.locked_fields ?? []
      const f = (body.fields ?? {}) as Partial<CardFields>
      const bad = Object.keys(f).find((k) => locked.includes(k) && JSON.stringify((f as Record<string, unknown>)[k]) !== JSON.stringify((c.fields as unknown as Record<string, unknown>)[k]))
      if (bad) return fail(403, 'field_locked', `“${bad.replace(/_/g, ' ')}” is managed by ${c.business_link!.business_name}.`, { field: bad })
      if (typeof body.slug === 'string' && body.slug !== c.slug) {
        if (!/^[a-z0-9-]{3,48}$/.test(body.slug)) return fail(422, 'validation_error', 'Validation failed', [{ field: 'body.slug', message: 'Use 3–48 lowercase letters, numbers or dashes' }])
        if (cards.some((x) => x !== c && x.slug === body.slug)) return fail(409, 'slug_taken', 'That link is already taken.')
        c.slug = body.slug
        c.public_url = `${WEB}/p/${c.slug}`
      }
      if (typeof body.label === 'string') c.label = body.label
      if (typeof body.template_id === 'string') c.template_id = body.template_id
      if (body.status === 'active' || body.status === 'inactive') c.status = body.status
      if (body.design) c.design = { ...c.design, ...(body.design as Partial<CardDesign>) }
      if (body.fields) c.fields = { ...c.fields, ...f }
      if (body.visibility) c.visibility = { ...c.visibility, ...(body.visibility as DigitalCard['visibility']) }
      if (body.share_settings) c.share_settings = { ...c.share_settings, ...(body.share_settings as Partial<DigitalCard['share_settings']>) }
      c.updated_at = now()
      return ok(c)
    }
    if (is('DELETE', '/personal/cards/:id')) {
      if (c.is_primary && cards.length > 1) return fail(409, 'primary_card', 'Set another card as primary before deleting this one.')
      cards.splice(cards.indexOf(c), 1)
      return ok(null, 204)
    }
    if (is('POST', '/personal/cards/:id/primary')) {
      for (const x of cards) x.is_primary = x === c
      return ok(c)
    }
    if (is('POST', '/personal/cards/:id/rotate-share-id')) {
      c.share_id = uuid()
      c.updated_at = now()
      return ok(c)
    }
    if (is('POST', '/personal/cards/:id/duplicate')) {
      if (cards.length >= 3) return fail(402, 'plan_limit_reached', 'Your Free plan allows 3 cards. Upgrade to Pro for up to 20.', { limit: 'cards' })
      const d = { ...structuredClone(c), id: uuid(), share_id: uuid(), is_primary: false, business_link: null, label: `${c.label} (copy)`, slug: uniqueSlug(`${c.slug}-copy`), stats: { views: 0, nfc_taps: 0, exchanges: 0, leads: 0 }, created_at: now(), updated_at: now() }
      d.public_url = `${WEB}/p/${d.slug}`
      cards.push(d)
      return ok(d, 201)
    }
    if (is('POST', '/personal/cards/:id/images')) {
      const kind = String(q?.kind ?? 'photo') as 'photo' | 'cover' | 'logo'
      c[`${kind}_url`] = str(body.file_url) || null
      c.updated_at = now()
      return ok(c)
    }
    if (is('DELETE', '/personal/cards/:id/images')) {
      const kind = String(q?.kind ?? 'photo') as 'photo' | 'cover' | 'logo'
      c[`${kind}_url`] = null
      return ok(c)
    }
    if (is('GET', '/personal/cards/:id/exchange-qr')) {
      return ok({ qr_payload: `nfcterminal://card?v=1&t=${b64(55)}`, expires_at: iso(Date.now() + 10 * MIN) })
    }
  }

  // ---- contacts ----
  if (is('GET', '/personal/contacts/export.vcf')) return ok(contacts.map((c) => vcard(c.card.fields)).join('\r\n'))
  if (is('GET', '/personal/contacts/export.csv')) {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const rows = contacts.map((c) => [c.card.fields.full_name, c.card.fields.company, c.card.fields.job_title, c.card.fields.emails?.[0]?.value, c.card.fields.phones?.[0]?.value, c.tags.join('; '), c.source, c.met_at].map(esc).join(','))
    return ok(['name,company,title,email,phone,tags,source,met_at', ...rows].join('\n'))
  }
  if (is('GET', '/personal/contacts')) {
    const qs = str(q?.q).toLowerCase()
    const list = contacts.filter(
      (c) =>
        (!qs || [c.card.fields.full_name, c.card.fields.company, c.card.fields.job_title, c.notes, ...c.tags, ...(c.card.fields.emails ?? []).map((e) => e.value)].some((v) => (v ?? '').toLowerCase().includes(qs))) &&
        (!q?.tag || c.tags.includes(String(q.tag))) &&
        (!q?.source || c.source === q.source) &&
        (q?.favorite == null || String(c.favorite) === String(q.favorite)),
    )
    return ok(paginate(list, q))
  }
  if (is('POST', '/personal/contacts')) {
    const card = (body.card ?? {}) as { fields?: Partial<CardFields> }
    if (!card.fields?.full_name) return fail(422, 'validation_error', 'Validation failed', [{ field: 'body.card.fields.full_name', message: 'Field required' }])
    const c: Contact = { id: uuid(), source: 'manual', counterpart_user_id: null, counterpart_card_id: null, card: { design: { ...templates[0].default_design }, layout: 'centered', fields: baseFields(card.fields as CardFields) }, live: false, notes: str(body.notes) || null, tags: (body.tags as string[]) ?? [], favorite: false, met_at: now(), created_at: now(), updated_at: now() }
    contacts.unshift(c)
    return ok(c, 201)
  }
  if (seg[1] === 'contacts' && seg[2]) {
    const c = contacts.find((x) => x.id === seg[2])
    if (!c) return fail(404, 'not_found', 'Contact not found')
    if (is('GET', '/personal/contacts/:id')) return ok(c)
    if (is('GET', '/personal/contacts/:id/vcard')) return ok(vcard(c.card.fields))
    if (is('PATCH', '/personal/contacts/:id')) {
      if ('notes' in body) c.notes = (body.notes as string | null) ?? null
      if (Array.isArray(body.tags)) c.tags = body.tags as string[]
      if (typeof body.favorite === 'boolean') c.favorite = body.favorite
      c.updated_at = now()
      return ok(c)
    }
    if (is('DELETE', '/personal/contacts/:id')) {
      contacts.splice(contacts.indexOf(c), 1)
      return ok(null, 204)
    }
  }

  // ---- activity & stats ----
  if (is('GET', '/personal/activity')) return ok(paginate(activity, q))
  if (is('GET', '/personal/stats')) return ok(statsFor(String(q?.range ?? '30d')))

  // ---- sessions & QR login ----
  if (is('GET', '/personal/sessions')) return ok(sessions.filter((s) => !s.revoked_at))
  if (is('DELETE', '/personal/sessions/:id')) {
    const s = sessions.find((x) => x.id === seg[2])
    if (!s) return fail(404, 'not_found', 'Session not found')
    s.revoked_at = now()
    return ok(null, 204)
  }
  if (is('POST', '/personal/login-codes')) {
    const id = uuid()
    const code = `nfcl_${b64(32)}`
    const expires_at = iso(Date.now() + 5 * MIN)
    loginCodes.set(id, { status: 'pending', expires_at, session: null })
    // Demo: a phone scans the code ~7 s later.
    setTimeout(() => {
      const lc = loginCodes.get(id)
      if (!lc || lc.status !== 'pending') return
      const s: PersonalSession = { id: uuid(), device_name: 'Pixel 9 Pro', platform: 'android', model: 'Pixel 9 Pro', app_version: '2.1.0', created_at: now(), last_seen_at: now(), revoked_at: null }
      sessions.unshift(s)
      lc.status = 'used'
      lc.session = s
    }, 7000)
    return ok({ id, code, expires_at, qr_payload: `nfcterminal://login?v=1&server=${encodeURIComponent('http://192.168.1.10:8000')}&code=${code}` }, 201)
  }
  if (is('GET', '/personal/login-codes/:id')) {
    const lc = loginCodes.get(seg[2])
    if (!lc) return fail(401, 'invalid_login_code', 'This sign-in code is invalid.')
    if (lc.status === 'pending' && lc.expires_at < now()) lc.status = 'expired'
    return ok({ status: lc.status, session: lc.session })
  }

  // ---- business invites ----
  if (is('GET', '/personal/business-invites')) return ok(invites)
  if (seg[1] === 'business-invites' && seg[2]) {
    const inv = invites.find((x) => x.id === seg[2])
    if (!inv) return fail(404, 'not_found', 'Invitation not found')
    if (inv.status !== 'pending') return fail(409, 'invite_not_pending', `This invitation is ${inv.status}.`)
    if (is('POST', '/personal/business-invites/:id/decline')) {
      inv.status = 'declined'
      return ok(inv)
    }
    if (is('POST', '/personal/business-invites/:id/accept')) {
      inv.status = 'accepted'
      const t = templates.find((x) => x.id === inv.template_id) ?? templates[0]
      const base = cards[0]
      const c = makeCard({
        label: inv.business_name,
        template_id: t.id,
        slug: uniqueSlug(`${base?.fields.full_name ?? 'me'} ${inv.business_name}`),
        design: { ...t.default_design, ...(inv.design ?? {}) },
        fields: { ...(base?.fields ?? baseFields({ full_name: 'Your name' })), company: inv.business_name, job_title: 'Store Manager' },
        business_link: { business_id: uuid(), business_name: inv.business_name, employee_id: uuid(), locked_fields: inv.locked_fields, template_locked: true, status: 'active' },
        created_at: now(),
        updated_at: now(),
        stats: { views: 0, nfc_taps: 0, exchanges: 0, leads: 0 },
      })
      cards.push(c)
      return ok(c)
    }
  }
  return fail(404, 'not_found', `Mock: no personal handler for ${method} ${path}`)
}

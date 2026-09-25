import { endpointGroups } from './data/endpoints'

export interface DocHeading {
  id: string
  title: string
}

export interface DocPage {
  /** Route segment under /docs ('' = the introduction). */
  slug: string
  title: string
  group: string
  description: string
  /** h2 anchors on the page — used by the search index. Keep in sync with the page's <H2 id>. */
  headings: DocHeading[]
  keywords?: string
}

export const docPages: DocPage[] = [
  {
    slug: '',
    title: 'Introduction',
    group: 'Getting started',
    description: 'What the platform does, who it is for and how the pieces fit together.',
    headings: [
      { id: 'what-it-is', title: 'What it is' },
      { id: 'two-ways', title: 'Two ways to use it' },
      { id: 'architecture', title: 'Architecture' },
      { id: 'next-steps', title: 'Next steps' },
    ],
    keywords: 'overview product nfc reader android',
  },
  {
    slug: 'quickstart-developers',
    title: 'Quick start — Developers',
    group: 'Getting started',
    description: 'Create an application, pair a phone and receive your first signed webhook.',
    headings: [
      { id: 'create-application', title: '1. Create an application' },
      { id: 'configure-endpoint', title: '2. Configure your endpoint' },
      { id: 'pair-phone', title: '3. Pair a phone' },
      { id: 'verify', title: '4. Verify signatures' },
      { id: 'tap', title: '5. Tap a card' },
    ],
    keywords: 'getting started api key webhook secret whsec endpoint',
  },
  {
    slug: 'quickstart-businesses',
    title: 'Quick start — Businesses',
    group: 'Getting started',
    description: 'Set up your business workspace, create cards, choose actions and program them.',
    headings: [
      { id: 'register', title: '1. Create a business account' },
      { id: 'profile', title: '2. Publish your profile' },
      { id: 'cards', title: '3. Add cards & tags' },
      { id: 'actions', title: '4. Choose what a tap does' },
      { id: 'program', title: '5. Program the cards' },
      { id: 'share', title: '6. Tap, share & measure' },
    ],
    keywords: 'business card tag employee profile no-code',
  },
  {
    slug: 'concepts',
    title: 'Concepts',
    group: 'Core concepts',
    description: 'Applications, devices, events, delivery modes and the UID-only security model.',
    headings: [
      { id: 'applications', title: 'Applications' },
      { id: 'credentials', title: 'Credentials' },
      { id: 'devices', title: 'Devices' },
      { id: 'events', title: 'Events' },
      { id: 'delivery-modes', title: 'Relay vs direct' },
      { id: 'uid-only', title: 'UID-only security' },
      { id: 'business-model', title: 'Businesses, cards & taps' },
    ],
    keywords: 'application device token api key relay direct uid authenticated',
  },
  {
    slug: 'tap-lifecycle',
    title: 'What happens when a card is tapped',
    group: 'Core concepts',
    description: 'The full journey of a tap on a developer device, a business device and a customer’s phone.',
    headings: [
      { id: 'three-paths', title: 'Three kinds of tap' },
      { id: 'developer-device', title: 'Developer device' },
      { id: 'business-device', title: 'Business device' },
      { id: 'customer-phone', title: 'Customer phone' },
      { id: 'background', title: 'When the app is closed' },
      { id: 'failures', title: 'When something fails' },
    ],
    keywords: 'tap flow lifecycle result recognized inactive unknown register open action notification t link',
  },
  {
    slug: 'mobile-app',
    title: 'Mobile app',
    group: 'Core concepts',
    description: 'Install NFC Terminal, pair it with a QR code, understand background reading and program cards.',
    headings: [
      { id: 'download', title: 'Download the Android app' },
      { id: 'requirements', title: 'Requirements' },
      { id: 'setup', title: 'Setup' },
      { id: 'qr-pairing', title: 'QR pairing' },
      { id: 'reading', title: 'Reading cards' },
      { id: 'background', title: 'Background reading limits' },
      { id: 'offline', title: 'Offline queue & retries' },
      { id: 'business-devices', title: 'Business devices' },
      { id: 'programming', title: 'Programming cards' },
    ],
    keywords: 'android flutter nfc terminal qr pairing screen off locked ndef write',
  },
  {
    slug: 'device-api',
    title: 'Device API',
    group: 'Developers',
    description: 'The four endpoints the reader app uses — build your own client with them.',
    headings: [
      { id: 'overview', title: 'Overview' },
      { id: 'register', title: 'Register a device' },
      { id: 'pairing', title: 'Register with a pairing code' },
      { id: 'config', title: 'Config & heartbeat' },
      { id: 'events', title: 'Report a card tap' },
      { id: 'business-response', title: 'Business device responses' },
      { id: 'device-errors', title: 'Device errors' },
    ],
    keywords: 'device register heartbeat config events nfcd idempotency-key pairing nfcp',
  },
  {
    slug: 'webhooks',
    title: 'Webhooks & signatures',
    group: 'Developers',
    description: 'Payload, headers and exactly how to verify the v1 HMAC-SHA256 signature.',
    headings: [
      { id: 'payload', title: 'Payload' },
      { id: 'headers', title: 'Headers' },
      { id: 'signature-scheme', title: 'Signature scheme' },
      { id: 'direct-key', title: 'Direct-mode derived key' },
      { id: 'verify', title: 'Verification code' },
      { id: 'replay', title: 'Replay protection' },
      { id: 'idempotency', title: 'Idempotency & retries' },
      { id: 'responding', title: 'Responding' },
      { id: 'test-events', title: 'Test events' },
    ],
    keywords: 'hmac sha256 x-nfc-signature v1 timestamp nonce raw body verify whsec',
  },
  {
    slug: 'sandbox',
    title: 'Sandbox',
    group: 'Developers',
    description: 'A hosted test endpoint that records requests, checks signatures and simulates responses.',
    headings: [
      { id: 'what', title: 'What the sandbox is' },
      { id: 'getting-started', title: 'Getting started' },
      { id: 'simulate', title: 'Simulating responses' },
      { id: 'inspect', title: 'Reading a request' },
      { id: 'verdicts', title: 'Signature verdicts' },
      { id: 'sandbox-api', title: 'Sandbox API' },
    ],
    keywords: 'test endpoint timeout status code simulate verdict valid invalid missing unverifiable',
  },
  {
    slug: 'run-mode',
    title: 'Run mode (live console)',
    group: 'Developers',
    description: 'Watch taps, delivery attempts and sandbox verdicts stream in live while you test.',
    headings: [
      { id: 'what', title: 'What run mode shows' },
      { id: 'start', title: 'Start a session' },
      { id: 'events', title: 'Stream events' },
      { id: 'reading', title: 'Reading a delivery attempt' },
      { id: 'api', title: 'Live API (SSE)' },
      { id: 'fallback', title: 'Limits & fallback' },
    ],
    keywords: 'live console stream sse run mode realtime debug event.received delivery.attempt',
  },
  {
    slug: 'business-guide',
    title: 'Business guide',
    group: 'Businesses',
    description: 'Cards vs tags, tap actions, profiles, employees, team roles, analytics and programming.',
    headings: [
      { id: 'cards-vs-tags', title: 'Cards vs tags' },
      { id: 'actions', title: 'Tap actions' },
      { id: 'profiles', title: 'Profiles' },
      { id: 'employees', title: 'Employees & customers' },
      { id: 'roles', title: 'Team roles & permissions' },
      { id: 'analytics', title: 'Analytics' },
      { id: 'programming', title: 'Programming cards' },
      { id: 'reader-devices', title: 'Reader devices' },
      { id: 'developers', title: 'Webhooks for businesses' },
      { id: 'plans', title: 'Plans & limits' },
    ],
    keywords: 'whatsapp wifi vcard menu profile employee owner admin manager staff permissions analytics tap',
  },
  {
    slug: 'api-reference',
    title: 'REST API reference',
    group: 'Developers',
    description: 'Every developer- and business-facing endpoint, grouped by area.',
    headings: [
      { id: 'conventions', title: 'Conventions' },
      { id: 'authentication', title: 'Authentication' },
      ...endpointGroups.map((g) => ({ id: g.id, title: g.title })),
    ],
    keywords: 'rest endpoints pagination reference http',
  },
  {
    slug: 'errors',
    title: 'Error codes',
    group: 'Developers',
    description: 'The complete error catalog with stable refs (NFC-xxxx, MOB-xxxx), causes and fixes.',
    headings: [
      { id: 'envelope', title: 'Error envelope' },
      { id: 'ranges', title: 'Ref ranges' },
      { id: 'catalog', title: 'Catalog' },
    ],
    keywords: 'error ref nfc-1003 request_id docs_url mob delivery_timeout',
  },
  {
    slug: 'rate-limits',
    title: 'Rate limits',
    group: 'Developers',
    description: 'Request rate limits, headers and plan limits.',
    headings: [
      { id: 'request-limits', title: 'Request rate limits' },
      { id: 'handling-429', title: 'Handling 429' },
      { id: 'plan-limits', title: 'Plan limits' },
    ],
    keywords: '429 retry-after x-ratelimit 402 plan_limit_reached quota',
  },
  {
    slug: 'digital-cards',
    title: 'Digital cards',
    group: 'Individuals',
    description: 'Your business card on your phone: design, share, exchange, privacy — and how terminals read it.',
    headings: [
      { id: 'create', title: 'Create your card' },
      { id: 'templates', title: 'Templates & design' },
      { id: 'share-scan', title: 'Share vs scan' },
      { id: 'exchange', title: 'Mutual exchange' },
      { id: 'no-app', title: 'iPhones & phones without the app' },
      { id: 'qr', title: 'QR fallback' },
      { id: 'privacy', title: 'Privacy & visibility' },
      { id: 'business-issued', title: 'Cards issued by a business' },
      { id: 'limits', title: 'Plans & limits' },
      { id: 'developers', title: 'For developers: reading digital cards' },
    ],
    keywords: 'personal digital card exchange hce ndef iphone qr visibility template digital_card_token signed_token share_id',
  },
  {
    slug: 'security',
    title: 'Security',
    group: 'Platform',
    description: 'How credentials, signing, allowlists, logging and privacy work — and what NFC cannot prove.',
    headings: [
      { id: 'uid', title: 'UID ≠ identity' },
      { id: 'credentials', title: 'Credential storage' },
      { id: 'signing', title: 'Signed delivery' },
      { id: 'allowlist', title: 'Endpoint allowlist' },
      { id: 'endpoint-rules', title: 'Endpoint rules & SSRF' },
      { id: 'origins', title: 'Allowed origins (CORS)' },
      { id: 'logging', title: 'Audit & request logs' },
      { id: 'privacy', title: 'Visitor privacy' },
      { id: 'checklist', title: 'Receiver checklist' },
    ],
    keywords: 'security hmac allowlist ssrf cors audit privacy clone',
  },
  {
    slug: 'changelog',
    title: 'Changelog',
    group: 'Platform',
    description: 'What changed in each part of the platform.',
    headings: [
      { id: 'part-4', title: 'Part 4 — Personal accounts & digital cards' },
      { id: 'part-3', title: 'Part 3 — Branding, pricing & live tools' },
      { id: 'part-2', title: 'Part 2 — Business accounts' },
      { id: 'v1-1', title: 'v1.1 — Access controls & QR pairing' },
      { id: 'part-1', title: 'Part 1 — Developer platform' },
    ],
    keywords: 'release notes changes versions',
  },
]

export const docGroups = ['Getting started', 'Core concepts', 'Developers', 'Businesses', 'Individuals', 'Platform']

export const docPath = (slug: string) => (slug ? `/docs/${slug}` : '/docs')

export function findDoc(slug: string): DocPage | undefined {
  return docPages.find((p) => p.slug === slug)
}

/** Pages in sidebar order (grouped), for prev/next links. */
export const orderedDocs: DocPage[] = docGroups.flatMap((g) => docPages.filter((p) => p.group === g))

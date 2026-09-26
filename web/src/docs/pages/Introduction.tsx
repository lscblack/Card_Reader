import { useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { ArrowRight, Briefcase, Code2, IdCard, type LucideIcon } from 'lucide-react'
import { CodeBlock } from '../components/Code'
import { B, C, Callout, DocHeader, DocLink, H2, P, PrevNext, UL } from '../components/Prose'
import { Figure } from '../components/Figure'
import { useProductName } from '@/marketing/lib'
import { ArchitectureDiagram } from '../components/Diagrams'

const flow = `NFC card ──tap──▶ Android phone (nexTap app)
                        │
         ┌──────────────┴───────────────┐
         ▼ relay (default)              ▼ direct
   Platform ────── signed POST ──▶  your endpoint  ◀── signed POST ── phone
   (logs, retries, analytics)                         (reports outcome to the platform)

Business cards & tags:
   customer's phone ──tap──▶ {PUBLIC_API_URL}/t/{code} ──▶ action (profile, WhatsApp, Wi-Fi, vCard…)`

/** Anchors of the old single-page dashboard docs (/docs#…) → their new home. */
const legacyAnchors: Record<string, string> = {
  concepts: '/docs/concepts',
  'quick-start': '/docs/quickstart-developers',
  authentication: '/docs/concepts#credentials',
  pairing: '/docs/mobile-app#qr-pairing',
  'device-api': '/docs/device-api',
  payload: '/docs/webhooks#payload',
  headers: '/docs/webhooks#headers',
  signatures: '/docs/webhooks#verify',
  'delivery-modes': '/docs/concepts#delivery-modes',
  allowlist: '/docs/security#allowlist',
  origins: '/docs/security#origins',
  security: '/docs/security',
  errors: '/docs/errors',
  'rate-limits': '/docs/rate-limits',
  reference: '/docs/api-reference',
  'two-ways': '/docs#three-ways',
}

function Choice({ to, icon: Icon, title, body }: { to: string; icon: LucideIcon; title: string; body: string }) {
  return (
    <Link to={to} className="group rounded-2xl border border-border bg-surface p-5 transition-all hover:-translate-y-0.5 hover:border-accent/60">
      <Icon className="h-5 w-5 text-accent" aria-hidden="true" />
      <p className="mt-3 flex items-center gap-1 text-[16px] font-semibold text-fg">
        {title} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </p>
      <p className="mt-1 text-[14px] leading-relaxed text-muted">{body}</p>
    </Link>
  )
}

export default function Introduction() {
  const { hash } = useLocation()
  const navigate = useNavigate()
  const productName = useProductName()
  useEffect(() => {
    const target = legacyAnchors[hash.slice(1)]
    if (target) navigate(target, { replace: true })
  }, [hash, navigate])

  return (
    <article>
      <DocHeader slug="" />

      <H2 id="what-it-is">What it is</H2>
      <P>
        {productName} turns any NFC-enabled Android phone into a programmable card reader. The principle is simple:{' '}
        <B>NFC detection → card ID → secure delivery</B>. The phone reads a card&apos;s identifier (UID), and the platform delivers it — signed
        — to wherever it needs to go.
      </P>
      <P>
        The platform never interprets what a card ID means. Whether a tap is an attendance check-in, a loyalty stamp, a ticket scan or a
        stock count is entirely up to you (developers) or to the action you configure (businesses). Individuals use the same app to share a
        digital business card from their phone.
      </P>

      <H2 id="three-ways">Three ways to use it</H2>
      <div className="my-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Choice
          to="/docs/quickstart-developers"
          icon={Code2}
          title="Developers"
          body="Receive every tap as a signed card.detected webhook on your HTTPS endpoint. Relay or direct delivery, sandbox, device API."
        />
        <Choice
          to="/docs/quickstart-businesses"
          icon={Briefcase}
          title="Businesses"
          body="NFC business cards and tags with no-code actions, employee profiles, public pages and menus, analytics, team roles and reader devices."
        />
        <Choice
          to="/docs/personal-guide"
          icon={IdCard}
          title="Individuals"
          body="Your business card on your phone. Design it from a template, share it by NFC, QR code or link, and keep everyone you meet in Contacts."
        />
      </div>
      <P>
        All three share the same app, cards and signed delivery pipeline. A business can add developer webhooks at any time with the{' '}
        <C>developer_webhook</C> action, can issue branded digital cards to its employees&apos; personal accounts, and one phone can be a
        reader and share your personal card at the same time.
      </P>

      <H2 id="architecture">Architecture</H2>
      <Figure scroll caption="How the pieces fit: readers, the platform, your endpoint and customer phones.">
        <ArchitectureDiagram />
      </Figure>
      <CodeBlock code={flow} language="text" title="How a tap flows" />
      <UL>
        <li>
          <B>nexTap</B> — the Flutter Android app. Reads card UIDs in reader mode, queues events offline and (for business devices)
          programs cards.
        </li>
        <li>
          <B>Platform API</B> — REST API at <C>/api/v1</C>: accounts, applications, keys, devices, events, deliveries, businesses, sandbox and
          the error catalog.
        </li>
        <li>
          <B>Dashboard</B> — manage everything, watch events and taps live, pair phones with a QR code. Personal accounts get their own
          dashboard at <C>/me</C>.
        </li>
        <li>
          <B>Public pages</B> — business and employee profiles at <C>/b/{'{slug}'}</C> that open when a customer taps a card, and personal
          digital cards at <C>/p/{'{slug}'}</C>.
        </li>
      </UL>

      <Figure shot="dashboard" caption="The developer dashboard: applications, devices, events and delivery success at a glance." />

      <Callout tone="danger" title="A UID is an identifier, not proof of identity">
        Many card UIDs can be read by anyone nearby, cloned or randomised. Every event carries <C>security.authenticated = false</C> and{' '}
        <C>security.level = &quot;uid_only&quot;</C>. Don&apos;t rely on the UID alone for payments or high-security access. See{' '}
        <DocLink to="/docs/security">Security</DocLink>.
      </Callout>

      <H2 id="next-steps">Next steps</H2>
      <UL>
        <li>
          <DocLink to="/docs/concepts">Concepts</DocLink> — applications, devices, events, relay vs direct.
        </li>
        <li>
          <DocLink to="/docs/webhooks">Webhooks &amp; signatures</DocLink> — payload, headers and verification code.
        </li>
        <li>
          <DocLink to="/docs/business-guide">Business guide</DocLink> — cards, actions, pages and menus, roles and analytics.
        </li>
        <li>
          <DocLink to="/docs/personal-guide">Personal guide</DocLink> — make, share and manage your digital card.
        </li>
        <li>
          <DocLink to="/docs/errors">Error codes</DocLink> — every error with its ref, cause and fix.
        </li>
      </UL>
      <PrevNext slug="" />
    </article>
  )
}

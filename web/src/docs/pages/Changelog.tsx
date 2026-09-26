import type { ReactNode } from 'react'
import { C, DocHeader, DocLink, H2, P, PrevNext } from '../components/Prose'

function Entry({ items }: { items: ReactNode[] }) {
  return (
    <ul className="my-4 space-y-2.5 border-l-2 border-accent/40 pl-5 text-[15px] leading-7 text-muted">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  )
}

export default function Changelog() {
  return (
    <article>
      <DocHeader slug="changelog" />
      <P>All changes are additive and backward compatible: existing developer accounts, devices, keys and the mobile app keep working.</P>

      <H2 id="part-4">Part 4 — Personal accounts & digital cards</H2>
      <Entry
        items={[
          <>
            <b className="text-fg">Personal accounts</b> with a free plan and a <C>/me</C> dashboard.
          </>,
          <>
            <b className="text-fg">Digital cards</b>: templates, per-field visibility, NFC phone-to-phone sharing, <b className="text-fg">mutual exchange</b>,
            QR fallback and a public card page for phones without the app. See <DocLink to="/docs/digital-cards">Digital cards</DocLink>.
          </>,
          <>
            <b className="text-fg">Business-issued employee cards</b> with locked fields and company branding.
          </>,
          <>
            Terminals read digital cards: <C>digital_card_token</C> on device events and a <C>digital_card</C> object in webhooks (
            <C>signed_token</C> level).
          </>,
        ]}
      />

      <H2 id="part-3">Part 3 — Branding, pricing & live tools</H2>
      <Entry
        items={[
          'Runtime branding (name, logo, colours, fonts), admin-managed plans with promotions and yearly prices.',
          <>
            <b className="text-fg">Run mode</b>: a live console of taps and delivery attempts. See <DocLink to="/docs/run-mode">Run mode</DocLink>.
          </>,
          'Android app downloads from the dashboard and docs, in-app notifications and product tours.',
          'The public API reference now lives only in these docs (no public Swagger).',
        ]}
      />

      <H2 id="part-2">Part 2 — Business accounts</H2>
      <Entry
        items={[
          <>
            <b className="text-fg">Business accounts</b>: workspaces with owner/admin/manager/staff roles, invitations and extra permissions.
          </>,
          <>
            <b className="text-fg">NFC cards &amp; tags</b> with unguessable tap links, assignments, history, bulk creation and{' '}
            <DocLink to="/docs/business-guide#actions">14 no-code tap actions</DocLink> plus <C>developer_webhook</C>.
          </>,
          <>
            <b className="text-fg">Public profiles</b> for businesses, employees, menus and products, with vCard downloads.
          </>,
          <>
            <b className="text-fg">Analytics</b>: taps, unique visitors, top cards and employees, device types, hours — privacy-preserving.
          </>,
          <>
            <b className="text-fg">Business reader devices</b>: recognise cards, register unknown cards and program cards from the app.
          </>,
          <>
            <b className="text-fg">Error catalog</b>: every error has a stable <C>ref</C>, <C>request_id</C> and <C>docs_url</C>;{' '}
            <DocLink to="/docs/errors">GET /errors</DocLink> is public.
          </>,
          <>
            <b className="text-fg">Sandbox</b> endpoints with signature verdicts and simulated responses. See{' '}
            <DocLink to="/docs/sandbox">Sandbox</DocLink>.
          </>,
          <>
            <b className="text-fg">Request logs</b> for every request (no bodies or secrets), and a full admin console.
          </>,
          <>
            <b className="text-fg">Email verification</b>, public <C>GET /billing/plans</C> with <C>audience</C>, and a new dark-red theme.
          </>,
        ]}
      />

      <H2 id="v1-1">v1.1 — Access controls &amp; QR pairing</H2>
      <Entry
        items={[
          <>
            <b className="text-fg">Endpoint domain allowlist</b> per application, enforced on every relay attempt and on phones in direct mode.
          </>,
          <>
            <b className="text-fg">Allowed origins</b> (CORS) managed by admins in the database, alongside <C>CORS_ORIGINS</C>.
          </>,
          <>
            <b className="text-fg">QR pairing</b>: single-use <C>nfcp_</C> codes that expire in 10 minutes — register a phone without typing an
            API key.
          </>,
        ]}
      />

      <H2 id="part-1">Part 1 — Developer platform</H2>
      <Entry
        items={[
          'Accounts, applications, API keys, webhook secrets and device tokens.',
          <>
            <b className="text-fg">nexTap</b> Android app: reader mode, background reading, offline retry queue, history.
          </>,
          <>
            Signed <C>card.detected</C> webhooks (<C>v1=</C> HMAC-SHA256) with <b className="text-fg">relay</b> and{' '}
            <b className="text-fg">direct</b> delivery.
          </>,
          'Events, delivery logs, redelivery, usage, plans, audit logs and rate limiting.',
        ]}
      />
      <PrevNext slug="changelog" />
    </article>
  )
}

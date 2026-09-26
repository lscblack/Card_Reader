import { B, C, Callout, DocHeader, DocLink, H2, P, PrevNext, Table, UL } from '../components/Prose'
import { Figure } from '../components/Figure'
import { RelayDirectDiagram } from '../components/Diagrams'

export default function Concepts() {
  return (
    <article>
      <DocHeader slug="concepts" />

      <H2 id="applications">Applications</H2>
      <P>
        An <B>application</B> is one integration: it owns API keys, a webhook secret, an endpoint configuration, a delivery mode, an optional
        domain allowlist and the devices registered to it. Developers can have several (e.g. staging and production); a business gets a
        default <B>Business Terminal</B> application for its reader phones.
      </P>
      <P>
        Pausing an application (<C>is_active = false</C>) makes its devices receive <C>403 application_disabled</C>; they keep their token and
        retry later. Deleting it revokes its keys and devices.
      </P>

      <H2 id="credentials">Credentials</H2>
      <P>
        All requests use <C>Authorization: Bearer &lt;credential&gt;</C>. Which credential depends on the caller:
      </P>
      <Table
        head={['Credential', 'Format', 'Used for', 'Stored as']}
        rows={[
          ['Dashboard JWT', 'JWT (HS256)', 'Dashboard and management API', 'Not stored'],
          [<C key="k">API key</C>, <C key="f">nfc_ + 48 chars</C>, <>Only <C>POST /device/register</C></>, 'SHA-256 hash + prefix + last 4'],
          [<C key="k">Pairing code</C>, <C key="f">nfcp_ + 32 chars</C>, 'One-time phone registration via QR (10 min)', 'SHA-256 hash'],
          [<C key="k">Device token</C>, <C key="f">nfcd_ + 48 chars</C>, <>All other <C>/device/*</C> calls</>, 'SHA-256 hash'],
          [<C key="k">Webhook secret</C>, <C key="f">whsec_ + 43 chars</C>, 'Verifying signatures on your endpoint', 'Encrypted (Fernet)'],
          ['Device signing secret', '64 hex chars (derived)', 'Direct-mode signing on the phone', 'Never stored; derived on demand'],
        ]}
      />
      <P>
        Keys, tokens and secrets are shown once and never logged. The mobile app uses an API key (or pairing code) only to register, then
        discards it and keeps only its device token.
      </P>

      <H2 id="devices">Devices</H2>
      <P>
        A <B>device</B> is a phone running nexTap, registered to exactly one application. It has a name, model, OS and app version,
        last-seen time and event count. You can rename or revoke it at any time; a revoked device gets <C>401 device_revoked</C> on its next
        call and returns to setup. Re-registering with the same <C>installation_id</C> for the same application revokes the old token and
        issues a new one.
      </P>

      <H2 id="events">Events</H2>
      <P>
        Each tap is a <C>card.detected</C> <B>event</B> with an <C>event_id</C> generated on the phone. Events are idempotent: sending the same{' '}
        <C>event_id</C> again returns the current state instead of creating a duplicate. Each delivery attempt is recorded as a{' '}
        <B>delivery</B> with status code, latency and error.
      </P>
      <Table
        head={['Status', 'Meaning']}
        rows={[
          [<C key="s">pending</C>, 'Stored, first attempt not finished yet'],
          [<C key="s">delivered</C>, 'Your endpoint answered 2xx'],
          [<C key="s">retrying</C>, 'Relay: an attempt failed, retries are scheduled server-side'],
          [<C key="s">failed</C>, 'All attempts failed (or the attempt could not be made, e.g. domain not allowed)'],
          [<C key="s">logged</C>, 'Business apps only: no endpoint configured — the tap is recorded, nothing is delivered'],
        ]}
      />

      <Figure shot="events" caption="Events with status, device and attempts in the dashboard." />

      <H2 id="delivery-modes">Relay vs direct</H2>
      <P>Choose the delivery mode per application under Endpoint configuration. Devices pick up the change on their next config refresh.</P>
      <Table
        head={['', 'Relay (default, recommended)', 'Direct']}
        rows={[
          ['Path', 'Phone → Platform → your endpoint', 'Phone → your endpoint (outcome reported to the platform)'],
          ['Signing key', 'Webhook secret — never leaves our servers', 'Per-device key derived from the webhook secret'],
          ['Retries', 'Server-side: 10 s, 60 s, 300 s…', 'On the phone: 5 s, 30 s, 2 min, then every 10 min'],
          ['Latency', 'One extra hop', 'Lowest'],
          ['Custom headers', 'Applied server-side, never sent to phones', 'Sent to the device'],
          ['Redeliver from dashboard', 'Yes', 'No'],
          ['User-Agent', <C key="u">nexTap-Webhook/1.0</C>, <C key="u">nexTap-Terminal/1.0</C>],
          ['Good for', 'Most integrations, public HTTPS endpoints', 'Latency-critical or LAN-only endpoints'],
        ]}
      />
      <Figure scroll caption="Relay: the platform signs and retries. Direct: the phone signs with a derived key and reports back.">
        <RelayDirectDiagram />
      </Figure>
      <P>
        Either way the payload and signature scheme are identical — only the key differs. See{' '}
        <DocLink to="/docs/webhooks#direct-key">direct-mode derived key</DocLink>.
      </P>

      <H2 id="uid-only">UID-only security</H2>
      <Callout tone="danger" title="Card detected ≠ card authenticated">
        Every event carries <C>security.authenticated = false</C> and <C>security.level = &quot;uid_only&quot;</C>. A UID is an{' '}
        <em>identifier</em>, not proof of identity: many cards let anyone read it, and it can be cloned or emulated. Some phones and cards
        even randomise it.
      </Callout>
      <UL>
        <li>Good for: attendance, check-in, loyalty, lookups, inventory, opening a profile or menu.</li>
        <li>
          Not on its own for: payments, doors that protect something valuable, privileged access — combine it with a PIN, a person at the desk
          or your own checks.
        </li>
      </UL>

      <H2 id="business-model">Businesses, cards &amp; taps</H2>
      <P>
        Business accounts add a layer on top: a <B>business</B> workspace has members with roles, <B>employees</B> and <B>customers</B>,{' '}
        <B>cards</B> (held by people) and <B>tags</B> (placed on things), <B>profiles</B> (public pages) and <B>taps</B>. A tap comes from one of
        two sources:
      </P>
      <UL>
        <li>
          <C>web</C> — a customer&apos;s phone opened the card&apos;s tap link; the configured action runs (redirect, page, vCard or webhook).
        </li>
        <li>
          <C>reader</C> — a business device running nexTap read the card; the platform recognises the UID and shows who or what it is.
        </li>
      </UL>
      <P>
        Details in the <DocLink to="/docs/business-guide">Business guide</DocLink>.
      </P>
      <PrevNext slug="concepts" />
    </article>
  )
}

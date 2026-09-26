import { receiverSamples } from '../verifySamples'
import { CodeBlock, CodeTabs } from '../components/Code'
import { B, C, Callout, DocHeader, DocLink, H2, OL, P, PrevNext, UL } from '../components/Prose'
import { requestSamples } from '../samples'
import { Figure } from '../components/Figure'

export default function QuickstartDevelopers() {
  return (
    <article>
      <DocHeader slug="quickstart-developers" />
      <P>
        About ten minutes from sign-up to your first signed webhook. You need an NFC-capable Android phone and an HTTPS endpoint — or use the
        built-in <DocLink to="/docs/sandbox">sandbox</DocLink> and skip writing a server for now.
      </P>

      <H2 id="create-application">1. Create an application</H2>
      <P>
        Register a developer account, then go to <B>Applications → New application</B>. You get two secrets, each shown <B>once</B>:
      </P>
      <UL>
        <li>
          an <B>API key</B> (<C>nfc_…</C>) — used only to register a phone manually;
        </li>
        <li>
          a <B>webhook secret</B> (<C>whsec_…</C>) — used by your server to verify signatures.
        </li>
      </UL>
      <P>
        Store them in a secret manager or environment variables. Lost one? Create a new API key or rotate the webhook secret.
      </P>

      <H2 id="configure-endpoint">2. Configure your endpoint</H2>
      <P>
        Under <B>Endpoint configuration</B>, enter an <C>https://</C> URL and press <B>Send test event</B>. New accounts get a sandbox endpoint
        automatically, and your first application uses it if you don&apos;t provide one — so you can see a real delivery immediately.
      </P>
      <P>Or do it with the API (dashboard JWT):</P>
      <CodeTabs
        title="PUT /applications/{id}/endpoint"
        samples={requestSamples({
          method: 'PUT',
          path: '/applications/APPLICATION_ID/endpoint',
          auth: 'YOUR_DASHBOARD_JWT',
          body: { url: 'https://example.com/api/nfc/card', enabled: true, timeout_seconds: 10, delivery_mode: 'relay' },
        })}
      />
      <Figure shot="sandbox" caption="New accounts get a sandbox endpoint: every request, its signature verdict and checks." />
      <Callout tone="tip">
        Restrict where an application may deliver with an <DocLink to="/docs/security#allowlist">endpoint allowlist</DocLink>.
      </Callout>

      <H2 id="pair-phone">3. Pair a phone</H2>
      <OL>
        <li>
          Install <B>nexTap</B> on an NFC Android phone (Android 7.0+).
        </li>
        <li>
          In the dashboard click <B>Pair a phone</B>, pick the application and optionally preset a device name. A QR code appears.
        </li>
        <li>
          In the app tap <B>Scan QR code</B> and confirm <B>Pair this device</B>. The dashboard shows <B>Paired ✓</B>.
        </li>
      </OL>
      <P>
        The app keeps only its own device token (<C>nfcd_…</C>). The pairing code is single-use and expires after 10 minutes. Manual setup
        with the server URL and an API key also works — see <DocLink to="/docs/mobile-app#setup">Mobile app</DocLink>.
      </P>

      <H2 id="verify">4. Verify signatures</H2>
      <P>
        Every request carries <C>X-NFC-Signature: v1=…</C>, an HMAC-SHA256 over <C>{'{timestamp}.{nonce}.{raw_body}'}</C>. Verify it using
        the <B>raw</B> request body:
      </P>
      <CodeTabs samples={receiverSamples} title="verify" />
      <P>
        Details, direct-mode keys and replay protection: <DocLink to="/docs/webhooks">Webhooks &amp; signatures</DocLink>.
      </P>

      <H2 id="tap">5. Tap a card</H2>
      <P>
        Hold any NFC card or tag against the back of the phone. The app vibrates, shows <B>Delivered</B>, and the event appears under{' '}
        <B>NFC Events</B> and on your endpoint:
      </P>
      <CodeBlock
        language="json"
        title="What your endpoint receives"
        code={`{
  "event_id": "7f1c2d3e-9a4b-4c1d-8e2f-3a4b5c6d7e8f",
  "event": "card.detected",
  "card_id": "04A1B2C3D4E5",
  "security": { "authenticated": false, "level": "uid_only" },
  "delivery_mode": "relay",
  "test": false,
  …
}`}
      />
      <Figure shot="events" caption="Each tap appears under NFC Events with its delivery status and attempts." />
      <P>
        Respond with any <C>2xx</C> quickly. Map <C>card_id</C> to whatever it means in your system — and remember a UID is{' '}
        <DocLink to="/docs/concepts#uid-only">not proof of identity</DocLink>.
      </P>
      <PrevNext slug="quickstart-developers" />
    </article>
  )
}

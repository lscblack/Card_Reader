import { B, C, Callout, DocHeader, DocLink, H2, P, PrevNext, Table, UL } from '../components/Prose'

export default function SecurityPage() {
  return (
    <article>
      <DocHeader slug="security" />

      <H2 id="uid">UID ≠ identity</H2>
      <Callout tone="danger" title="Card detected is not card authenticated">
        A card UID is readable by anyone nearby and can be cloned or emulated; some cards and phones randomise it. Every event carries{' '}
        <C>security.authenticated = false</C> and <C>security.level = &quot;uid_only&quot;</C>, and the app labels every read “UID only (not
        authenticated)”.
      </Callout>
      <UL>
        <li>Use the UID to look things up — attendance, check-in, loyalty, inventory, opening a profile.</li>
        <li>
          Don&apos;t use it alone to open doors that protect something valuable, move money or grant privileged access. Combine it with a PIN,
          a person at the desk or your own checks.
        </li>
        <li>
          Business tap links use a random <C>public_code</C>, not the UID, so the link itself doesn&apos;t reveal or depend on the chip&apos;s
          identifier.
        </li>
      </UL>

      <H2 id="credentials">Credential storage</H2>
      <Table
        head={['Secret', 'How it is stored']}
        rows={[
          ['API keys, device tokens, pairing codes', 'SHA-256 hash only (plus a display prefix and last 4 for keys)'],
          ['Webhook secrets', 'Encrypted at rest (Fernet); shown once'],
          ['Direct-mode device keys', 'Never stored; derived on demand'],
          ['Passwords', 'Hashed; changing or resetting a password invalidates existing sessions'],
          ['On the phone', 'Device token in Android Keystore-backed secure storage; the API key and pairing code are never stored'],
        ]}
      />
      <P>
        Secrets, Authorization headers and signatures are never logged — the mobile app&apos;s debug logs also pass through a redactor. Keep
        your keys in a secret manager or environment variables, never in source control or client-side code, and rotate the webhook secret if it
        may have leaked.
      </P>

      <H2 id="signing">Signed delivery</H2>
      <UL>
        <li>
          Every delivery carries <C>X-NFC-Signature: v1=HMAC_SHA256(key, &quot;{'{timestamp}.{nonce}.{raw_body}'}&quot;)</C>. Details in{' '}
          <DocLink to="/docs/webhooks#signature-scheme">Webhooks &amp; signatures</DocLink>.
        </li>
        <li>
          <B>Relay</B>: signed on our servers with your webhook secret, which never leaves them.
        </li>
        <li>
          <B>Direct</B>: signed on the phone with a per-device key derived from your secret. A compromised phone can only sign as itself —
          revoke it and its key becomes useless for that device.
        </li>
        <li>Receivers should reject timestamps older than 5 minutes, reject reused nonces, compare in constant time and dedupe on event ID.</li>
      </UL>

      <H2 id="allowlist">Endpoint allowlist</H2>
      <P>
        Each application can restrict which hosts its endpoint may point to (<B>Endpoint configuration → Allowed domains</B>, or{' '}
        <C>PUT /applications/{'{id}'}/allowed-domains</C> with <C>{'{ "domains": [...] }'}</C>). An empty list means no restriction beyond the
        normal rules.
      </P>
      <Table
        head={['Entry', 'Matches']}
        rows={[
          [<C key="e">api.example.com</C>, 'Exactly that host'],
          [<C key="e">*.example.com</C>, <>Any subdomain (<C>a.example.com</C>, <C>a.b.example.com</C>) — <B>not</B> <C>example.com</C> itself</>],
          [<C key="e">192.168.1.74</C>, 'That IP literal (useful in development)'],
        ]}
      />
      <UL>
        <li>Lowercase hosts only: no scheme, port, path, or wildcard anywhere but the first label. Up to 20 entries.</li>
        <li>
          Saving a non-matching endpoint → <C>422 domain_not_allowed</C>. Changing the list so the current endpoint no longer matches →{' '}
          <C>409 endpoint_outside_allowlist</C> (change the endpoint first).
        </li>
        <li>
          Every relay delivery — including retries, redeliveries and tests — re-checks the list. A non-matching endpoint is <B>not contacted</B>;
          the attempt is logged as failed with <C>domain_not_allowed</C>.
        </li>
        <li>Phones receive the list in their config and refuse direct deliveries to other hosts (logged the same way, not retried).</li>
      </UL>

      <H2 id="endpoint-rules">Endpoint rules &amp; SSRF</H2>
      <UL>
        <li>
          Endpoints must be <C>https://</C>. Only in development are <C>http://localhost</C>, <C>127.0.0.1</C>, <C>10.0.2.2</C> and private LAN
          hosts allowed.
        </li>
        <li>
          Outside development, hosts resolving to private, loopback, link-local or cloud-metadata addresses are rejected (
          <C>delivery_ssrf_blocked</C>).
        </li>
        <li>Max 2048 characters, no credentials in the URL, no fragments. Redirects are never followed.</li>
      </UL>

      <H2 id="origins">Allowed origins (CORS)</H2>
      <P>
        Browsers may only call the API from allowed origins: the server&apos;s <C>CORS_ORIGINS</C> environment variable plus origins an
        administrator adds under <B>Admin → Allowed origins</B> (environment origins are read-only in the UI).
      </P>
      <UL>
        <li>
          Format <C>scheme://host[:port]</C>, lowercase, no path or trailing slash; <C>https</C> required outside development.
        </li>
        <li>
          Admin API: <C>GET/POST /admin/allowed-origins</C> (duplicate → <C>409 origin_exists</C>), <C>DELETE /admin/allowed-origins/{'{id}'}</C>.
        </li>
        <li>Changes apply within about 30 seconds across API processes. Server-to-server calls (your backend, the phone app) aren&apos;t affected by CORS.</li>
      </UL>

      <H2 id="logging">Audit &amp; request logs</H2>
      <UL>
        <li>
          <B>Audit log</B>: logins, password changes, application, endpoint, key, secret, device, pairing and allowlist changes, and every
          mutating admin action.
        </li>
        <li>
          <B>Request logs</B>: every API, device, tap and sandbox request — method, route, status, latency, error code/ref, actor and request ID
          — <B>without bodies or secrets</B>. IPs are stored only as a keyed hash. Retention defaults to 90 days.
        </li>
        <li>You see logs for what you own; business members need <C>api.view</C>.</li>
      </UL>

      <H2 id="privacy">Visitor privacy</H2>
      <P>
        Customer taps on business cards record the device type, browser and — only when a trusted proxy provides it — country. Unique visitors
        are counted with a hash using a daily-rotating salt. No raw IP addresses, no GeoIP lookups, no cookies required. Link-preview bots are
        excluded from analytics.
      </P>

      <H2 id="checklist">Receiver checklist</H2>
      <UL>
        <li>Verify the signature over the raw body, in constant time.</li>
        <li>Reject timestamps older than 5 minutes and nonces you&apos;ve already seen.</li>
        <li>Dedupe on <C>X-NFC-Event-Id</C> and return 2xx for duplicates.</li>
        <li>
          Direct mode: check body <C>device_id</C> equals <C>X-NFC-Device-Id</C>.
        </li>
        <li>Respond fast; process asynchronously.</li>
        <li>Treat the UID as an identifier, not an identity.</li>
      </UL>
      <PrevNext slug="security" />
    </article>
  )
}

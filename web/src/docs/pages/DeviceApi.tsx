import { CodeBlock, CodeTabs } from '../components/Code'
import { B, C, Callout, DocHeader, DocLink, H2, H3, P, PrevNext, Table, UL } from '../components/Prose'
import { API_V1, requestSamples } from '../samples'

const registerBody = {
  device_name: 'Front desk Pixel',
  platform: 'android',
  model: 'Pixel 8',
  os_version: 'Android 15',
  app_version: '1.0.0',
  installation_id: '1b4e28ba-2fa1-4d2b-883f-0016d3cca427',
}

const registerResponse = `{
  "device": { "id": "5b0e7c1a-…", "name": "Front desk Pixel", "status": "active", … },
  "device_token": "nfcd_…",
  "config": {
    "device_id": "5b0e7c1a-…",
    "device_name": "Front desk Pixel",
    "application": { "id": "c3d4e5f6-…", "name": "Front desk check-in" },
    "delivery_mode": "relay",
    "endpoint_url": "https://example.com/api/nfc/card",
    "endpoint_enabled": true,
    "timeout_seconds": 10,
    "max_retries": 3,
    "custom_headers": {},
    "signing_secret": null,
    "allowed_domains": [],
    "account_type": "developer",
    "business": null,
    "assigned_employee": null,
    "capabilities": []
  }
}`

const eventBody = {
  event_id: '0d6f6f1e-7f0b-4a55-9d5c-3f0c2b1a9e11',
  card_id: '04A1B2C3D4E5',
  card_technologies: ['NfcA'],
  card_type: 'mifare_ultralight',
  detected_at: '2026-09-25T08:30:21Z',
  direct_delivery: null,
}

const eventResponse = `// relay mode
{ "event_id": "0d6f6f1e-…", "status": "delivered", "status_code": 200, "latency_ms": 184, "error": null }`

const directReport = `"direct_delivery": {
  "success": true,
  "status_code": 200,
  "latency_ms": 92,
  "error": null,
  "attempt": 1
}`

const businessResponse = `{
  "event_id": "0d6f6f1e-…",
  "status": "logged",
  "business": {
    "result": "recognized",
    "card": { "id": "…", "name": "Jane — front desk", "kind": "card", "status": "active", "effective_status": "active" },
    "assignee": { "type": "employee", "id": "…", "name": "Jane Doe", "position": "Sales Manager", "photo_url": null },
    "action": { "type": "employee_profile", "label": null, "url": "https://…/b/acme-cafe/jane-doe" },
    "message": "Jane Doe · Sales Manager"
  }
}`

export default function DeviceApi() {
  return (
    <article>
      <DocHeader slug="device-api" />

      <H2 id="overview">Overview</H2>
      <P>
        These endpoints are what the NFC Terminal app uses. You only need them to build your own reader client. Base URL: <C>{API_V1}</C>
      </P>
      <Table
        head={['Endpoint', 'Auth', 'Purpose']}
        rows={[
          [<C key="e">POST /device/register</C>, <>API key (<C>nfc_…</C>) or pairing code (<C>nfcp_…</C>)</>, 'Register a phone; returns a device token + config'],
          [<C key="e">GET /device/config</C>, 'Device token', 'Fetch the current delivery config'],
          [<C key="e">POST /device/heartbeat</C>, 'Device token', 'Report liveness (updates “last seen”)'],
          [<C key="e">POST /device/events</C>, 'Device token', 'Report a card tap (idempotent on event_id)'],
          [<C key="e">GET/POST /device/business/cards</C>, 'Device token (business)', 'List or register cards from a business device'],
          [<C key="e">POST /device/business/cards/{'{id}'}/programmed</C>, 'Device token (business)', 'Mark a card programmed and bind its UID'],
        ]}
      />

      <H2 id="register">Register a device</H2>
      <CodeTabs title="POST /device/register" samples={requestSamples({ method: 'POST', path: '/device/register', auth: 'nfc_YOUR_API_KEY', body: registerBody })} />
      <CodeBlock language="json" title="201 Created" code={registerResponse} />
      <UL>
        <li>
          Re-registering with the same <C>installation_id</C> for the same application revokes the previous token and issues a new one.
        </li>
        <li>
          <C>signing_secret</C> and <C>custom_headers</C> are present only in direct mode (relay applies custom headers server-side).
        </li>
        <li>
          Business devices get <C>account_type: &quot;business&quot;</C>, the <C>business</C> object, an optional <C>assigned_employee</C> and{' '}
          <C>capabilities</C> such as <C>cards.register</C> and <C>cards.program</C>.
        </li>
      </UL>

      <H2 id="pairing">Register with a pairing code</H2>
      <P>
        Same body and response, with <C>Authorization: Bearer nfcp_…</C> instead of an API key. A device name preset on the code overrides{' '}
        <C>device_name</C>. The code is consumed atomically; an unknown, used, expired or cancelled code returns{' '}
        <C>401 invalid_pairing_code</C>.
      </P>
      <CodeTabs title="Dashboard: create a pairing code" samples={requestSamples({ method: 'POST', path: '/applications/APPLICATION_ID/pairing-codes', auth: 'YOUR_DASHBOARD_JWT', body: { device_name: 'Front desk' } })} />
      <CodeBlock
        language="json"
        title="201 Created"
        code={`{
  "id": "0b3c…",
  "code": "nfcp_…",
  "expires_at": "2026-09-25T08:40:21Z",
  "server_url": "http://192.168.1.74:8000",
  "qr_payload": "nfcterminal://pair?v=1&server=http%3A%2F%2F192.168.1.74%3A8000&code=nfcp_…&name=Front%20desk"
}`}
      />
      <P>
        <C>GET /pairing-codes/{'{id}'}</C> returns <C>status</C>: <C>pending</C>, <C>used</C> (with <C>device</C>) or <C>expired</C>.{' '}
        <C>POST /pairing-codes/{'{id}'}/cancel</C> expires it.
      </P>

      <H2 id="config">Config &amp; heartbeat</H2>
      <CodeTabs title="GET /device/config" samples={requestSamples({ method: 'GET', path: '/device/config', auth: 'nfcd_YOUR_DEVICE_TOKEN' })} />
      <P>
        <C>POST /device/heartbeat</C> returns <C>{'{ "status": "active", "server_time": "…" }'}</C>. The reference app refreshes config every 5
        minutes and sends a heartbeat every 60 s in the foreground.
      </P>

      <H2 id="events">Report a card tap</H2>
      <CodeTabs
        title="POST /device/events"
        samples={requestSamples({
          method: 'POST',
          path: '/device/events',
          auth: 'nfcd_YOUR_DEVICE_TOKEN',
          headers: { 'Idempotency-Key': eventBody.event_id },
          body: eventBody,
        })}
      />
      <CodeBlock language="javascript" title="200 OK" code={eventResponse} />
      <UL>
        <li>
          <C>card_id</C> is normalised (uppercased, <C>:</C> and spaces stripped) and must match <C>^[0-9A-F]{'{4,64}'}$</C>.
        </li>
        <li>
          Reading a phone that shares a <DocLink to="/docs/digital-cards#developers">digital card</DocLink>? Add <C>digital_card_token</C>, set{' '}
          <C>card_type</C> to <C>digital_card</C> and <C>card_id</C> to the share id (32 hex chars).
        </li>
        <li>
          <C>detected_at</C> older than 7 days or more than 5 minutes in the future → <C>422</C>.
        </li>
        <li>
          Sending the same <C>event_id</C> again is safe: you get the current state of the existing event (<C>200</C> both times). An{' '}
          <C>event_id</C> already used by another device → <C>409 event_id_conflict</C>.
        </li>
        <li>
          <B>Relay</B> (no <C>direct_delivery</C>): the server stores the event, makes the first signed attempt synchronously (bounded by the
          endpoint timeout) and schedules retries if it fails (<C>status: &quot;retrying&quot;</C>).
        </li>
        <li>
          <B>Direct</B>: the phone delivers itself, then reports the outcome in <C>direct_delivery</C>; the server only logs it:
        </li>
      </UL>
      <CodeBlock language="json" title="direct_delivery" code={directReport} />
      <P>
        The mode is chosen per request: <C>direct_delivery</C> present → logged as a direct attempt; absent → relayed by the server (even if
        the app is in direct mode, e.g. with a stale config). Monthly quota exceeded → <C>402 plan_limit_reached</C>.
      </P>

      <H2 id="business-response">Business device responses</H2>
      <P>
        For devices that belong to a business, the backend also resolves the UID against the business&apos;s cards, records a <C>reader</C> tap,
        runs a <C>developer_webhook</C> action if configured, and adds a <C>business</C> object. With no endpoint configured, the status is{' '}
        <C>logged</C> — not an error.
      </P>
      <CodeBlock language="json" title="200 OK (business device)" code={businessResponse} />
      <P>
        <C>result</C> is <C>recognized</C>, <C>unknown_card</C> or <C>inactive</C>. Developer devices never get this field.
      </P>

      <H2 id="device-errors">Device errors</H2>
      <Table
        head={['HTTP', 'code', 'What to do']}
        rows={[
          ['401', <C key="c">invalid_api_key · api_key_revoked</C>, 'Registration with an unknown or revoked API key — create a new key'],
          ['401', <C key="c">invalid_pairing_code</C>, 'Generate a new QR code'],
          ['401', <C key="c">invalid_device_token</C>, 'Unknown token — register again'],
          ['401', <C key="c">device_revoked</C>, 'Wipe the stored token and return to setup'],
          ['403', <C key="c">application_disabled</C>, 'Application paused — keep the token and retry later'],
          ['403', <C key="c">business_suspended</C>, 'The business was suspended by an administrator'],
          ['409', <C key="c">event_id_conflict</C>, 'Generate a new event_id'],
          ['402', <C key="c">plan_limit_reached</C>, 'Monthly event quota or device limit reached'],
        ]}
      />
      <Callout tone="tip">
        Every error also has a stable <C>ref</C> and <C>request_id</C>. Look up any ref in <DocLink to="/docs/errors">Error codes</DocLink>.
      </Callout>
      <H3 id="endpoint-rules">Direct delivery rules</H3>
      <P>
        In direct mode the phone posts the section-4 payload with every <C>X-NFC-*</C> header, does not follow redirects, and refuses hosts
        outside <C>allowed_domains</C> (reported as failed with <C>domain_not_allowed</C>, not retried). Each attempt gets a fresh timestamp and
        nonce but keeps the same <C>event_id</C>.
      </P>
      <PrevNext slug="device-api" />
    </article>
  )
}

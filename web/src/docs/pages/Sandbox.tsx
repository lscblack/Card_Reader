import { CodeBlock, CodeTabs } from '../components/Code'
import { B, C, Callout, DocHeader, DocLink, H2, H3, OL, P, PrevNext, Table, UL } from '../components/Prose'
import { requestSamples } from '../samples'
import { Figure } from '../components/Figure'

const requestExample = `{
  "id": "…",
  "received_at": "2026-09-25T08:30:22Z",
  "method": "POST",
  "path": "/sandbox/q8Z…",
  "headers": { "x-nfc-signature": "v1=5d41…", "authorization": "Bearer ••••", … },
  "body_json": { "event": "card.detected", "card_id": "04A1B2C3D4E5", … },
  "size_bytes": 512,
  "signature": { "status": "valid", "mode": "relay", "reason": null, "error_ref": null },
  "checks": [
    { "name": "timestamp_skew", "passed": true,  "detail": "2 s" },
    { "name": "nonce_unused",   "passed": true,  "detail": null },
    { "name": "payload_schema", "passed": true,  "detail": null },
    { "name": "device_known",   "passed": true,  "detail": "Front desk Pixel" }
  ],
  "response_status": 200,
  "response_delay_ms": 0,
  "event_id": "7f1c2d3e-…",
  "device_id": "5b0e7c1a-…"
}`

export default function Sandbox() {
  return (
    <article>
      <DocHeader slug="sandbox" />

      <H2 id="what">What the sandbox is</H2>
      <P>
        A <B>sandbox endpoint</B> is a receiver hosted by the platform at <C>{'{PUBLIC_API_URL}/sandbox/{token}'}</C>. It records everything
        the platform or a phone sends — method, headers, body — verifies the signature, runs sanity checks, and answers with whatever status,
        body, headers and delay you configure. Use it to see real deliveries before you write a line of server code, and to test how your
        integration behaves on errors and timeouts.
      </P>
      <UL>
        <li>Every new developer account gets one sandbox endpoint; your first application uses it if you didn&apos;t set an endpoint.</li>
        <li>The last 500 requests per endpoint are kept. Bodies up to 64 KB are stored (larger → 413, recorded as failed).</li>
        <li>
          <C>Authorization</C> header values are masked. The receiver needs no auth and is rate-limited per token.
        </li>
      </UL>

      <Figure shot="sandbox" caption="The sandbox inspector: incoming requests on the left, verdict, headers and body on the right." />

      <H2 id="getting-started">Getting started</H2>
      <OL>
        <li>
          Open <B>Sandbox</B> in the dashboard (or create one with <C>POST /sandbox/endpoints</C>).
        </li>
        <li>
          Link it to an application so signatures can be verified — or click <B>Use for application</B>, which sets that application&apos;s
          endpoint to the sandbox URL (and adds its host to the allowlist if one exists).
        </li>
        <li>
          Click <B>Send test</B> to run the real signed delivery pipeline to it, or tap a card on a paired phone.
        </li>
        <li>Watch requests appear live (the dashboard polls every 2 seconds).</li>
      </OL>

      <H2 id="simulate">Simulating responses</H2>
      <Table
        head={['Setting', 'Range', 'Use it to test']}
        rows={[
          [<C key="s">response_status</C>, '100–599 (default 200)', <>Any status code: <C>500</C>/<C>503</C> trigger relay retries, <C>410</C> or <C>401</C> show how failures are logged</>],
          [<C key="s">response_delay_ms</C>, '0–15000', 'Slow endpoints. A delay longer than the endpoint timeout simulates a timeout (delivery_timeout)'],
          [<C key="s">response_body</C>, '≤ 4 KB (default {"ok":true})', 'What appears in response_excerpt on the delivery'],
          [<C key="s">response_headers</C>, 'object', <>e.g. <C>Retry-After</C> or custom headers</>],
        ]}
      />
      <Callout tone="tip" title="Timeouts">
        The endpoint timeout is set per application (1–30 s, default 10 s). Set <C>response_delay_ms</C> above it — e.g. 12000 with a 10 s
        timeout — and the attempt fails with <C>delivery_timeout</C>, then retries in relay mode.
      </Callout>
      <CodeTabs
        title="PATCH /sandbox/endpoints/{id}"
        samples={requestSamples({
          method: 'PATCH',
          path: '/sandbox/endpoints/SANDBOX_ID',
          auth: 'YOUR_DASHBOARD_JWT',
          body: { response_status: 503, response_delay_ms: 0, response_body: '{"error":"maintenance"}' },
        })}
      />

      <H2 id="inspect">Reading a request</H2>
      <CodeBlock language="json" title="SandboxRequest" code={requestExample} />
      <P>
        <C>checks</C> tell you what a careful receiver would verify: timestamp skew ≤ 5 minutes, nonce not reused, <C>event_id</C> format,
        payload schema, device known, <C>card_id</C> format. <C>event_id</C> and <C>device_id</C> link back to the event in the dashboard.
      </P>

      <H2 id="verdicts">Signature verdicts</H2>
      <Table
        head={['status', 'Meaning']}
        rows={[
          [<C key="v">valid</C>, <>The <C>v1=</C> signature matches the linked application&apos;s secret (relay) or the derived device key (direct). <C>mode</C> says which.</>],
          [<C key="v">invalid</C>, <>A signature is present but doesn&apos;t match. <C>reason</C> explains (e.g. body modified, wrong secret, unknown device).</>],
          [<C key="v">missing</C>, <>No <C>X-NFC-Signature</C> header — e.g. you sent a request by hand.</>],
          [<C key="v">unverifiable</C>, 'The sandbox has no application linked, so it cannot know the secret. Link one to get a verdict.'],
        ]}
      />
      <P>
        When a verdict is not <C>valid</C>, <C>error_ref</C> points to the matching entry in <DocLink to="/docs/errors">Error codes</DocLink>.
      </P>
      <H3 id="manual">Sending requests by hand</H3>
      <P>The receiver accepts any method, so you can also test your own tooling against it:</P>
      <CodeTabs
        samples={requestSamples({ method: 'POST', path: '/sandbox/YOUR_SANDBOX_TOKEN', root: true, body: { hello: 'sandbox' } })}
      />

      <H2 id="sandbox-api">Sandbox API</H2>
      <P>
        Developer JWT, or a business member with <C>api.manage</C> (add <C>?business_id=</C>).
      </P>
      <Table
        head={['Endpoint', 'Purpose']}
        rows={[
          [<C key="e">GET/POST /sandbox/endpoints</C>, 'List or create sandbox endpoints'],
          [<C key="e">GET/PATCH/DELETE /sandbox/endpoints/{'{id}'}</C>, 'Read, configure or delete one'],
          [<C key="e">GET /sandbox/endpoints/{'{id}'}/requests?page=&amp;since=</C>, 'Recorded requests (poll every 2 s)'],
          [<C key="e">GET /sandbox/requests/{'{id}'}</C>, 'One request with headers, body, verdict and checks'],
          [<C key="e">DELETE /sandbox/endpoints/{'{id}'}/requests</C>, 'Clear recorded requests'],
          [<C key="e">POST /sandbox/endpoints/{'{id}'}/use-for/{'{application_id}'}</C>, 'Point an application at this sandbox'],
          [<C key="e">POST /sandbox/endpoints/{'{id}'}/send-test</C>, 'Run a real signed test delivery to it'],
          [<C key="e">ANY /sandbox/{'{token}'}</C>, 'The public receiver (server root, no /api/v1, no auth)'],
        ]}
      />
      <PrevNext slug="sandbox" />
    </article>
  )
}

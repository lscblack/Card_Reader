import { CodeBlock } from '../components/Code'
import { Figure } from '../components/Figure'
import { B, C, Callout, DocHeader, DocLink, H2, OL, P, PrevNext, Table, UL } from '../components/Prose'
import { API_V1 } from '../samples'

const stream = `event: event.received
data: {"event_id":"7f1c2d3e-…","card_id":"04A1B2C3D4E5","card_type":"ntag","card_technologies":["NfcA"],
       "device_id":"5b0e7c1a-…","device_name":"Front desk Pixel","detected_at":"2026-09-25T08:30:21Z","delivery_mode":"relay"}

event: delivery.attempt
data: {"event_id":"7f1c2d3e-…","attempt":1,"mode":"relay","url":"https://api.example.com/nfc/card","success":false,
       "status_code":null,"latency_ms":10002,"error_code":"delivery_timeout","error_ref":"NFC-5001",
       "response_excerpt":null,"response_headers":{},"request_payload":{"event":"card.detected", …}}

event: sandbox.request
data: {"endpoint_id":"…","request_id":"…","event_id":"7f1c2d3e-…","signature_status":"valid","checks_failed":0,"response_status":200}

: heartbeat`

const client = `// Browser or Node 18+: SSE over fetch (so the Authorization header can be sent)
const res = await fetch("${API_V1}/live/applications/APPLICATION_ID", {
  headers: { Authorization: "Bearer YOUR_DASHBOARD_JWT", Accept: "text/event-stream" },
});
const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
let buffer = "";
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += value;
  let i;
  while ((i = buffer.indexOf("\\n\\n")) >= 0) {
    const block = buffer.slice(0, i);
    buffer = buffer.slice(i + 2);
    const type = /^event: (.*)$/m.exec(block)?.[1];
    const data = /^data: (.*)$/m.exec(block)?.[1];
    if (type && data) console.log(type, JSON.parse(data));
  }
}`

export default function RunMode() {
  return (
    <article>
      <DocHeader slug="run-mode" />

      <H2 id="what">What run mode shows</H2>
      <P>
        Run mode is a live console for one application. While it’s open, every tap and every delivery attempt streams in as it happens — you
        see the event the phone reported, the exact JSON the platform sent to your endpoint, the response status, latency and any error ref,
        plus the sandbox’s signature verdict when your endpoint is a sandbox.
      </P>
      <Table
        head={['Stream event', 'When', 'Shows']}
        rows={[
          [<C key="e">event.received</C>, 'A phone reported a tap', 'Card ID, type, technologies, device, delivery mode'],
          [<C key="e">delivery.attempt</C>, 'Each delivery attempt (relay or direct)', 'Attempt #, URL, success, status, latency, error ref, response excerpt, request payload'],
          [<C key="e">sandbox.request</C>, 'Your endpoint is a sandbox', 'Signature verdict, failed checks, response status'],
          [<C key="e">business.tap</C>, 'Business applications', 'Card name, assignee, result, action'],
        ]}
      />

      <H2 id="start">Start a session</H2>
      <OL>
        <li>
          Open the <B>Sandbox</B> in the dashboard and switch on <B>Run mode</B> for the application you’re testing.
        </li>
        <li>Tap a card on a paired phone, or click <B>Send test event</B>.</li>
        <li>Watch the event and its attempts appear; click an attempt to see the request payload and the response.</li>
      </OL>
      <Figure shot="sandbox" caption="The sandbox inspector: incoming requests, signature verdict and checks — run mode streams these live." />

      <H2 id="events">Stream events</H2>
      <CodeBlock language="text" title="text/event-stream" code={stream} />

      <H2 id="reading">Reading a delivery attempt</H2>
      <UL>
        <li>
          <C>success: true</C> means your endpoint answered <C>2xx</C>. Otherwise <C>error_code</C> / <C>error_ref</C> explain why (timeouts,
          TLS, DNS, 4xx/5xx, blocked redirects…) — see <DocLink to="/docs/errors">Error codes</DocLink>.
        </li>
        <li>
          <C>request_payload</C> is the exact JSON that was signed and sent; <C>response_excerpt</C> holds up to 2 KB of what you answered.
        </li>
        <li>
          Only <C>content-type</C> and <C>content-length</C> of the response headers are included.
        </li>
      </UL>

      <H2 id="api">Live API (SSE)</H2>
      <P>
        <C>GET /live/applications/{'{id}'}</C> returns <C>text/event-stream</C> for the application owner, or a business member with{' '}
        <C>api.view</C>. It uses the normal <C>Authorization</C> header, so read it with <C>fetch</C> (the browser <C>EventSource</C> API can’t
        send headers). A heartbeat comment arrives every 15 s.
      </P>
      <CodeBlock language="javascript" title="Reading the stream" code={client} />

      <H2 id="fallback">Limits & fallback</H2>
      <UL>
        <li>
          Reconnect with <C>?since=&lt;ISO timestamp&gt;</C> to replay up to 100 events from the last 10 minutes.
        </li>
        <li>
          Up to 5 concurrent streams per user; more → <C>429 too_many_streams</C>.
        </li>
        <li>
          If live streaming is unavailable the API answers <C>503 live_unavailable</C>; the dashboard then falls back to polling events and
          deliveries.
        </li>
      </UL>
      <Callout tone="note">Run mode only observes — it never changes how events are delivered.</Callout>
      <PrevNext slug="run-mode" />
    </article>
  )
}

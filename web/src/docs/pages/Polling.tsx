import { CodeBlock, CodeTabs } from '../components/Code'
import { requestSamples } from '../samples'
import { B, C, Callout, DocHeader, DocLink, H2, P, PrevNext, Table, UL } from '../components/Prose'

const tapResponse = `{
  "items": [
    {
      "id": "7f1c2d3e-5a6b-4c8d-9e0f-1a2b3c4d5e6f",
      "application_id": "c3d4e5f6-…",
      "application_name": "Front desk check-in",
      "device_id": "5b0e7c1a-…",
      "device_name": "Front desk Pixel",
      "event_type": "card.detected",
      "card_id": "04A1B2C3D4E5",
      "card_type": "mifare_ultralight",
      "card_technologies": ["NfcA", "MifareUltralight"],
      "authenticated": false,
      "delivery_mode": "relay",
      "status": "logged",
      "attempts": 0,
      "detected_at": "2026-09-25T08:30:21Z",
      "received_at": "2026-09-25T08:30:21Z",
      "delivered_at": null
    }
  ],
  "next_cursor": "MjAyNi0wOS0yNVQwODozMDoyMSswMDowMHw3ZjFjMmQzZQ",
  "has_more": false
}`

const tailLoop = `# Tail new taps forever. Start with no cursor to establish a tail point,
# then keep passing the cursor the previous call returned.
API='nfc_YOUR_API_KEY'
CURSOR=$(curl -s -H "Authorization: Bearer $API" \\
  "https://api.example.com/api/v1/taps" | jq -r .next_cursor)

while true; do
  RESP=$(curl -s -H "Authorization: Bearer $API" \\
    "https://api.example.com/api/v1/taps?cursor=$CURSOR")
  echo "$RESP" | jq -c '.items[] | {card_id, received_at}'
  CURSOR=$(echo "$RESP" | jq -r .next_cursor)   # advance
  [ "$(echo "$RESP" | jq -r .has_more)" = "true" ] || sleep 3   # only sleep when caught up
done`

export default function Polling() {
  return (
    <article>
      <DocHeader slug="polling" />

      <H2 id="when">When to use polling</H2>
      <P>
        Taps are delivered <B>push-first</B> as signed <DocLink to="/docs/webhooks">webhooks</DocLink> — that is the model to build for in
        production. Polling exists for one job: letting you build and test your integration <B>before you can receive webhooks</B>, for example
        on a laptop with no public URL and no tunnel. You pull your application’s taps with your API key instead of standing up a receiver.
      </P>
      <Callout tone="note" title="Prefer webhooks in production">
        Polling adds latency and burns requests against your <DocLink to="/docs/rate-limits">rate limit</DocLink>. Once you can accept inbound
        HTTPS, switch to a webhook endpoint — you verify one signature and taps arrive in real time.
      </Callout>

      <H2 id="list">List recent taps</H2>
      <P>
        Authenticate with your application <B>API key</B> (<C>Authorization: Bearer nfc_…</C>) — the same key you use to register devices. The
        response only ever contains taps for that key’s application.
      </P>
      <CodeTabs title="GET /taps" samples={requestSamples({ method: 'GET', path: '/taps', auth: 'nfc_YOUR_API_KEY' })} />
      <CodeBlock title="200 OK" language="json" code={tapResponse} />
      <P>
        Each item is the same shape a webhook delivers (see <DocLink to="/docs/webhooks">Webhooks</DocLink> for every field). With no{' '}
        <C>cursor</C>, the call returns the most recent taps newest-first and a <C>next_cursor</C> positioned at the newest one — your starting
        point for tailing.
      </P>

      <H2 id="cursor">Tailing with a cursor</H2>
      <P>
        Pass the <C>next_cursor</C> from the previous response back as <C>?cursor=</C>. Each cursored call returns taps that arrived{' '}
        <B>after</B> that point, oldest-first, and a fresh <C>next_cursor</C> to use next time — so you never miss or duplicate a tap. The cursor
        is opaque; don’t parse it.
      </P>
      <CodeBlock title="Poll loop" language="bash" code={tailLoop} />
      <P>
        <C>has_more</C> is <C>true</C> when more taps are already waiting beyond this page — fetch the next page immediately instead of sleeping.
        When it’s <C>false</C> you’re caught up; wait a few seconds before polling again.
      </P>

      <H2 id="filters">Filters &amp; limits</H2>
      <Table
        head={['Query param', 'Meaning']}
        rows={[
          [<C>cursor</C>, <>Opaque keyset cursor from a previous <C>next_cursor</C>. Returns taps after it, oldest-first.</>],
          [<C>since</C>, <>ISO-8601 date/datetime to start tailing from (ignored when <C>cursor</C> is set).</>],
          [<C>limit</C>, <>Max taps per page, 1–100 (default 50).</>],
          [<C>card_id</C>, <>Only taps of a specific card UID.</>],
          [<C>status</C>, <>Filter by delivery status: <C>pending</C>, <C>delivered</C>, <C>retrying</C>, <C>failed</C>, <C>logged</C>.</>],
        ]}
      />
      <UL>
        <li>
          Taps with no webhook endpoint configured are stored with <C>status: "logged"</C> — that is not an error, just “received, nothing to
          deliver to”. Polling returns them all the same.
        </li>
        <li>Polling counts toward your request rate limit; see <DocLink to="/docs/rate-limits">Rate limits</DocLink>.</li>
      </UL>

      <H2 id="single">Get one tap</H2>
      <P>Fetch a single tap by id (scoped to your application):</P>
      <CodeTabs title="GET /taps/{id}" samples={requestSamples({ method: 'GET', path: '/taps/7f1c2d3e-…', auth: 'nfc_YOUR_API_KEY' })} />

      <PrevNext slug="polling" />
    </article>
  )
}

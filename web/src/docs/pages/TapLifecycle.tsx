import { B, C, Callout, DocHeader, DocLink, H2, H3, OL, P, PrevNext, Table, UL } from '../components/Prose'
import { Figure } from '../components/Figure'
import { RelayDirectDiagram, TapFlowDiagram } from '../components/Diagrams'
import { BackgroundNotificationMock, BusinessResultMock, DeveloperResultMock } from '../components/PhoneMocks'

export default function TapLifecycle() {
  return (
    <article>
      <DocHeader slug="tap-lifecycle" />

      <H2 id="three-paths">Three kinds of tap</H2>
      <Table
        head={['Who taps', 'What reads the card', 'What happens']}
        rows={[
          ['A developer’s reader', 'NFC Terminal registered to a developer application', <>A signed <C>card.detected</C> webhook reaches your endpoint</>],
          ['A business’s reader', 'NFC Terminal registered to a business', 'The card is looked up and the result shown on the phone (and optionally sent to a webhook)'],
          ['A customer', 'Any phone’s built-in NFC (no app)', <>The card’s link <C>/t/{'{code}'}</C> opens and its action runs</>],
        ]}
      />
      <Figure scroll caption="Customer phones open a card’s link; business reader devices look the card up and show the result.">
        <TapFlowDiagram />
      </Figure>

      <H2 id="developer-device">Developer device</H2>
      <OL>
        <li>
          The phone reads the card’s UID in reader mode (the same UID is ignored for 1.5 s), vibrates and creates an event with a new{' '}
          <C>event_id</C>.
        </li>
        <li>
          <B>Relay</B> (default): it sends <C>POST /device/events</C>; the platform stores the event, signs it with your webhook secret and
          makes the first delivery attempt right away. <B>Direct</B>: the phone signs the payload with its per-device key, posts it to your
          endpoint itself, then reports the outcome.
        </li>
        <li>
          Your endpoint answers <C>2xx</C> → the phone shows <B>Delivered</B> with the status code and latency. Anything else → <B>Failed</B> or{' '}
          <B>Retrying</B>.
        </li>
        <li>The event appears in <B>NFC Events</B> with every delivery attempt; run mode shows it live.</li>
      </OL>
      <Figure narrow caption="What the phone shows after a relayed delivery.">
        <DeveloperResultMock />
      </Figure>
      <Figure scroll caption="Relay vs direct: who signs, who retries.">
        <RelayDirectDiagram />
      </Figure>

      <H2 id="business-device">Business device</H2>
      <P>
        A phone paired to a business works the same way, but the platform also resolves the UID against the business’s cards, records a{' '}
        <C>reader</C> tap and returns a <C>business</C> result the app shows prominently:
      </P>
      <div className="my-6 grid gap-5 sm:grid-cols-3">
        <Figure caption={<><B>Recognized</B> (green): name, assignee and an Open button for the card’s action.</>}>
          <BusinessResultMock state="recognized" />
        </Figure>
        <Figure caption={<><B>Inactive</B> (amber): deactivated card or employee.</>}>
          <BusinessResultMock state="inactive" />
        </Figure>
        <Figure caption={<><B>Unknown</B> (neutral): offer to register the card.</>}>
          <BusinessResultMock state="unknown" />
        </Figure>
      </div>
      <UL>
        <li>
          <B>Open</B> launches the card’s action URL (for example the employee profile).
        </li>
        <li>
          <B>Register this card</B> appears for unknown cards when the device has the <C>cards.register</C> capability.
        </li>
        <li>
          If the card’s action is <C>developer_webhook</C>, a signed <C>card.tapped</C> event is sent to that application’s endpoint.
        </li>
        <li>
          With no endpoint configured, the event is simply <C>logged</C> — that is not an error.
        </li>
      </UL>

      <H2 id="customer-phone">Customer phone</H2>
      <P>
        A programmed card holds an NDEF link to <C>{'{PUBLIC_API_URL}/t/{public_code}'}</C>. When a customer taps it, their phone opens the link
        in the browser — no app needed. The platform records a <C>web</C> tap (device type, browser; no raw IP) and runs the action: a redirect
        (website, WhatsApp, maps…), a page (Wi-Fi, phone call, profile) or a vCard download. Unknown or inactive cards open a neutral “unavailable”
        page. Link-preview bots are recorded but excluded from analytics.
      </P>
      <Figure shot="profile" narrow caption="A business profile opened from a card tap on a customer’s phone." />

      <H2 id="background">When the app is closed</H2>
      <P>
        Android only delivers NFC tags to apps while the screen is <B>on and unlocked</B>. With NFC Terminal closed or in the background, a tap
        opens the app, runs the same read → deliver pipeline, shows a notification in the “Card reads” channel and returns you to the previous
        app (it waits up to about 8 s; failed deliveries stay queued).
      </P>
      <Figure caption="After a background read you stay in your current app; a notification confirms the result.">
        <BackgroundNotificationMock />
      </Figure>

      <H2 id="failures">When something fails</H2>
      <H3 id="failures-relay">Relay</H3>
      <P>
        The platform retries server-side (10 s, 60 s, 300 s…) and the phone shows <B>Retrying</B> — it does not retry on its own.
      </P>
      <H3 id="failures-direct">Direct and offline</H3>
      <P>
        The phone retries network errors, timeouts, <C>408</C>, <C>429</C> and <C>5xx</C> after 5 s, 30 s, 2 min, then every 10 min. Offline
        events wait in a queue without using up attempts.
      </P>
      <Callout tone="tip">
        Every failure carries an error ref — e.g. <C>NFC-5001</C> for a timeout or <C>MOB-…</C> for phone-side problems. Look it up in{' '}
        <DocLink to="/docs/errors">Error codes</DocLink>, or watch attempts live in <DocLink to="/docs/run-mode">run mode</DocLink>.
      </Callout>
      <PrevNext slug="tap-lifecycle" />
    </article>
  )
}

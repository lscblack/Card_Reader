import { CodeBlock } from '../components/Code'
import { B, C, Callout, DocHeader, DocLink, H2, OL, P, PrevNext, Table, UL } from '../components/Prose'
import { Figure } from '../components/Figure'
import { PairingSequenceDiagram, ProgrammingDiagram } from '../components/Diagrams'
import { BackgroundNotificationMock, DeveloperResultMock } from '../components/PhoneMocks'
import { DownloadApp } from '@/marketing/components/DownloadApp'

export default function MobileApp() {
  return (
    <article>
      <DocHeader slug="mobile-app" />
      <P>
        <B>NFC Terminal</B> is a generic reader app: tap a card → read its UID → deliver the event. It has no business logic and never decides
        what a card means.
      </P>

      <H2 id="download">Download the Android app</H2>
      <P>
        Install the latest published build directly — scan the QR code with the phone, or download the APK and open it. Android may ask
        you to allow installing apps from your browser the first time.
      </P>
      <DownloadApp className="my-5" />

      <H2 id="requirements">Requirements</H2>
      <UL>
        <li>A physical Android phone with NFC, Android 7.0 (API 24) or newer. Emulators have no NFC hardware.</li>
        <li>
          Network access to the platform. Release builds require <C>https://</C> (plain http only for <C>localhost</C>, <C>127.0.0.1</C> and{' '}
          <C>10.0.2.2</C>).
        </li>
        <li>NFC turned on in Android settings — the app links you there when it&apos;s off.</li>
      </UL>

      <H2 id="setup">Setup</H2>
      <P>Two ways to register a phone to an application:</P>
      <OL>
        <li>
          <B>QR pairing (recommended)</B> — see below.
        </li>
        <li>
          <B>Manual</B> — enter the server URL, paste an API key (<C>nfc_…</C>) and confirm the device name (pre-filled from the phone model),
          then tap <B>Register device</B>. A <C>…/api/v1</C> suffix on the URL is accepted and stripped.
        </li>
      </OL>
      <P>
        Either way the app calls <C>POST /device/register</C> and keeps <B>only</B> the device token (<C>nfcd_…</C>), the server URL and an
        installation ID, in Android Keystore-backed secure storage. The API key is never stored.
      </P>

      <H2 id="qr-pairing">QR pairing</H2>
      <OL>
        <li>
          In the dashboard click <B>Pair a phone</B> (Devices, an application&apos;s Devices tab, or the Overview checklist), pick the
          application and optionally preset a device name.
        </li>
        <li>
          On the phone open <B>NFC Terminal → Scan QR code</B> (scanning with the system camera also opens the app). It shows the server host
          — tap <B>Pair this device</B>.
        </li>
        <li>
          The dashboard polls every 2 seconds and shows <B>Paired ✓</B> with the device name and model. The phone shows the server host and
          application name.
        </li>
      </OL>
      <CodeBlock language="text" title="QR payload" code="nfcterminal://pair?v=1&server=http%3A%2F%2F192.168.1.74%3A8000&code=nfcp_…&name=Front%20desk" />
      <Figure scroll caption="QR pairing: the phone registers with a single-use code and keeps only its own device token.">
        <PairingSequenceDiagram />
      </Figure>
      <UL>
        <li>
          Codes are <B>single use</B>, <B>expire after 10 minutes</B> and are stored only as a SHA-256 hash. The app never stores the code.
        </li>
        <li>Closing the dialog cancels a pending code. A preset device name overrides the name the phone sends.</li>
        <li>The device counts towards your plan limit when the code is redeemed, not when it&apos;s created.</li>
        <li>
          <C>server</C> is the platform&apos;s <C>DEVICE_SERVER_URL</C>; it must be reachable from the phone (a LAN address or public host, not{' '}
          <C>localhost</C>).
        </li>
      </UL>

      <H2 id="reading">Reading cards</H2>
      <UL>
        <li>
          <B>Reader mode</B> starts automatically once registered and NFC is on. It polls NfcA/B/F/V (ISO-DEP and MIFARE are found through A/B)
          and skips NDEF, so no other app pops up when a card is tapped.
        </li>
        <li>The same UID is ignored for 1.5 s (debounce). The phone vibrates on each read and the screen stays on while the reader is active.</li>
        <li>
          The card type is a best-effort guess: <C>mifare_classic</C>, <C>mifare_ultralight</C>, <C>ntag</C>, <C>iso_dep</C>, <C>felica</C>,{' '}
          <C>iso15693</C> or <C>null</C>.
        </li>
        <li>
          Every read is labelled <B>Card detected · UID only (not authenticated)</B>.
        </li>
      </UL>
      <Table
        head={['Screen', 'What it does']}
        rows={[
          ['Setup', 'Server URL, API key or QR pairing, device name'],
          ['Reader', 'Status (Ready / Reading / Sending / Delivered / Failed / NFC off / Offline), start/stop, last card, connection panel'],
          ['History', 'Local log of the last 1000 events with filters, details and Retry now'],
          ['Program card', 'Business devices: pick a card and write its tap link'],
          ['Settings', 'Device and connection info, re-sync config, background reading, unregister'],
        ]}
      />

      <Figure caption="After a read: status, card UID and the UID-only label.">
        <DeveloperResultMock />
      </Figure>

      <H2 id="background">Background reading limits</H2>
      <Callout tone="warning" title="Screen on and unlocked">
        Android only hands NFC tags to apps while the screen is <B>on and unlocked</B>. No app or service can read tags with the screen off or
        on the lock screen.
      </Callout>
      <P>With the screen unlocked, the app covers the rest:</P>
      <UL>
        <li>
          <B>App open</B> — reader mode runs; it restarts when the app resumes and when NFC is switched back on.
        </li>
        <li>
          <B>App closed or in the background</B> — tapping a card opens the app, the read goes through the same pipeline, a notification is
          shown and the app returns you to what you were doing (it gives up waiting after about 8 s; failed deliveries stay queued).
        </li>
        <li>
          Toggle this with <B>Settings → Read cards when app is closed</B> (on by default). On Android 13+ it asks for notification permission —
          reading still works without it. If another NFC app is installed, Android may ask which app to use: choose NFC Terminal and “Always”.
        </li>
      </UL>

      <Figure caption="A background read: a notification confirms the result and you stay in your current app.">
        <BackgroundNotificationMock />
      </Figure>

      <H2 id="offline">Offline queue &amp; retries</H2>
      <UL>
        <li>
          Network errors, timeouts, <C>408</C>, <C>429</C> and <C>5xx</C> are retried after 5 s, 30 s, 2 min, then every 10 min, up to{' '}
          <C>max_retries</C> from the config.
        </li>
        <li>While the phone is offline, events wait without using up attempts; the queue runs again when the network returns.</li>
        <li>
          In relay mode, when the platform answers <C>retrying</C>, the phone does <B>not</B> retry too — the server owns retries.
        </li>
        <li>
          Config is refreshed at start, every 5 minutes, on resume and on pull-to-refresh; a heartbeat is sent every 60 s in the foreground.
        </li>
      </UL>

      <H2 id="business-devices">Business devices</H2>
      <P>
        Phones registered to a business show the business name and logo. On each read they display the result prominently — card name,
        assignee and a status colour (recognised = green, inactive = amber, unknown = neutral) — with an <B>Open</B> button for the card&apos;s
        action. With the <C>cards.register</C> capability, an unknown card can be registered on the spot. Errors show a message and a ref
        (e.g. <C>NFC-1003</C>, or <C>MOB-…</C> for local failures) — look it up in <DocLink to="/docs/errors">Error codes</DocLink>.
      </P>

      <H2 id="programming">Programming cards</H2>
      <OL>
        <li>
          Open <B>Program card</B> and search for the card (needs the <C>cards.program</C> capability, enabled by the business setting “devices
          can register cards”).
        </li>
        <li>Hold a writable card or tag to the phone. The app writes an NDEF URI record with the card&apos;s tap URL (and, for Wi-Fi actions, optionally a native Wi-Fi record).</li>
        <li>The app confirms and reports it as programmed, binding the UID if the card had none.</li>
      </OL>
      <Figure scroll caption="Programming a card: pick, hold, write, report.">
        <ProgrammingDiagram />
      </Figure>
      <Callout tone="note">
        The app never makes a tag read-only. Because the tag only stores a link, changing the action or profile later never requires
        rewriting it.
      </Callout>
      <PrevNext slug="mobile-app" />
    </article>
  )
}

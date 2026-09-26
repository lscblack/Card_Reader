import { CardRender } from '@/marketing/components/digital/CardRender'
import { templates } from '@/marketing/components/digital/data'
import { TemplateShowcaseGrid } from '@/personal/components/TemplateShowcase'
import { BusinessIssuedCard, IphoneWebPage, PrivacyPanel } from '@/marketing/components/digital/Showcase'
import { PhoneExchange } from '@/marketing/components/digital/Exchange'
import { CodeBlock, CodeTabs } from '../components/Code'
import { ExchangeDiagram } from '../components/Diagrams'
import { Figure } from '../components/Figure'
import { B, C, Callout, DocHeader, DocLink, H2, H3, OL, P, PrevNext, Table, UL } from '../components/Prose'
import { requestSamples } from '../samples'

const devicePayload = `{
  "event_id": "0d6f6f1e-7f0b-4a55-9d5c-3f0c2b1a9e11",
  "card_id": "3F2A9C0E7B1D44E6A8C9F0B1D2E3F4A5",
  "card_technologies": ["IsoDep"],
  "card_type": "digital_card",
  "detected_at": "2026-09-25T08:30:21Z",
  "digital_card_token": "AT8qnA57HUTmqMnwsdLj9KUAAAABaQ7m7Xn2…",
  "direct_delivery": null
}`

const webhookPayload = `{
  "event_id": "0d6f6f1e-…",
  "event": "card.detected",
  "card_id": "3F2A9C0E7B1D44E6A8C9F0B1D2E3F4A5",
  "card": { "uid": "3F2A9C0E7B1D44E6A8C9F0B1D2E3F4A5", "technologies": ["IsoDep"], "type": "digital_card" },
  "digital_card": {
    "id": "3f2a9c0e-7b1d-44e6-a8c9-f0b1d2e3f4a5",
    "verified": true,
    "full_name": "Amara Okafor",
    "headline": "Designing calm products",
    "company": "Studio North",
    "job_title": "Product Designer",
    "photo_url": "https://…/media/cards/….webp",
    "public_url": "https://…/p/amara-okafor"
  },
  "security": { "authenticated": false, "level": "signed_token" },
  …
}`

const tokenLayout = `SELECT  00 A4 04 00 07 F0 4E 46 43 44 43 01 00      (digital-card AID F04E4643444301)
answer  "NFCDC" ‖ token_bytes (41) ‖ 90 00

token_bytes = 0x01                      version
            ‖ share_id                 16 bytes (UUID, big-endian)
            ‖ key_id                   uint32 BE
            ‖ issued_at                uint32 BE, unix seconds
            ‖ mac                      first 16 bytes of HMAC_SHA256(share key, first 25 bytes)
text form   = base64url without padding (55 chars) → digital_card_token`

export default function DigitalCards() {
  return (
    <article>
      <DocHeader slug="digital-cards" />
      <P>
        A <B>digital card</B> is a business card that lives on your phone. You design it on the web or in the app, share it by holding your
        phone near another phone or reader, and collect the cards of the people you meet. Businesses can also issue branded cards to their
        employees.
      </P>
      <Figure caption="Two phones touch: each person receives the other’s card (mutual exchange).">
        <PhoneExchange />
      </Figure>

      <H2 id="create">Create your card</H2>
      <OL>
        <li>
          Register and choose <B>Personal</B> (name, email, password). A first card is created for you from the <C>modern</C> template on the
          free <B>Personal</B> plan. You land on <C>/me</C>.
        </li>
        <li>
          Edit your card: template, colours, background, font, corners, photo/cover/logo, and the fields you want (phones, emails, websites,
          socials, custom links…).
        </li>
        <li>
          Install NFC Terminal on your Android phone (<DocLink to="/docs/mobile-app#download">download</DocLink>) and choose <B>Personal digital
          card</B>. Sign in with your password, or scan the <B>Sign in on your phone</B> QR from the web (single use, valid 5 minutes).
        </li>
      </OL>
      <Figure shot="me" caption="Your personal dashboard: views, exchanges and leads, your primary card and ways to share it." />
      <P>A phone can be signed in to your personal account and be a developer or business reader at the same time — the app shows both spaces.</P>

      <H2 id="templates">Templates & design</H2>
      <P>Shape templates (business cards and vertical ID badges, front and back) — arrange blocks by dragging them between a template’s areas:</P>
      <TemplateShowcaseGrid />
      <P>Classic layouts:</P>
      <div className="my-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {templates
          .filter((t) => t.layout !== 'compact')
          .slice(0, 4)
          .map((t) => (
            <figure key={t.id} className="min-w-0">
              <CardRender t={t} />
              <figcaption className="mt-2 text-center text-[12.5px] text-subtle">
                {t.name} · <C>{t.layout}</C>
              </figcaption>
            </figure>
          ))}
      </div>
      <Table
        head={['Layout', 'What it looks like']}
        rows={[
          [<C key="l">centered</C>, 'Round photo at the top, name and headline centred, a row of action buttons, then fields'],
          [<C key="l">left</C>, 'Photo to the left of the name block, left-aligned text, a divider, then fields'],
          [<C key="l">split</C>, 'A coloured panel with photo and name, fields on the other panel'],
          [<C key="l">hero_photo</C>, 'Full-width photo or cover on top with a gradient and the name over it'],
          [<C key="l">banner</C>, 'Cover banner with an overlapping round photo and the name below'],
          [<C key="l">compact</C>, 'Physical business-card ratio (1.75:1) with name, title, company, logo and QR'],
        ]}
      />
      <P>
        Templates are data-driven and render identically on the web and in the app. Design options: primary, background, text and accent
        colours; background style (<C>solid</C>, <C>gradient</C>, <C>glass</C>, <C>pattern</C>); font (<C>sans</C>, <C>serif</C>, <C>mono</C>,{' '}
        <C>display</C>); corner radius; show QR.
      </P>

      <Figure shot="me-editor" caption="The card editor: fields with per-field visibility and a live preview (Public / Contacts view)." />

      <H2 id="share-scan">Share vs scan</H2>
      <Table
        head={['', 'Share', 'Scan']}
        rows={[
          ['What you do', 'Keep your phone on the My Card screen and hold it near the other device', 'Tap Scan and hold your phone near the other phone'],
          ['What happens', 'Your phone acts like an NFC card and hands over a fresh signed token (works offline)', 'Your phone reads their token and asks the platform for their card'],
          ['You get', 'Their card too, if they have the app and exchange is mutual', 'Their card, saved to your contacts'],
        ]}
      />
      <Callout tone="warning" title="Limits of phone-as-card">
        <p>
          Sharing works while the screen is <B>on</B> and, on most phones, <B>unlocked</B>. While your own phone is <B>scanning</B>, Android
          suspends card emulation — a phone can’t share and scan at the same moment, so the app makes the roles explicit.
        </p>
      </Callout>

      <H2 id="exchange">Mutual exchange</H2>
      <P>
        When A scans B, A receives B’s card and — if B has <C>auto_exchange</C> on (the default) — B automatically receives A’s primary card and a
        notification. With auto-exchange off, A only gets B’s public fields. Exchanging again updates the existing contacts instead of creating
        duplicates. You can’t exchange with yourself.
      </P>
      <Figure scroll caption="Mutual exchange: the scanner redeems the token; both people get a contact.">
        <ExchangeDiagram />
      </Figure>
      <Table
        head={['Scanner gets', 'When']}
        rows={[
          [<>Fields marked <C>public</C> and <C>contacts</C></>, 'Mutual exchange (the other person has auto-exchange on)'],
          [<>Only <C>public</C> fields</>, 'The other person turned auto-exchange off'],
        ]}
      />
      <P>
        Contacts keep a snapshot of the card and stay <B>live</B> while you’re connected: when the other person edits their card, your copy updates.
        Add notes, tags and favourites; export everything as vCard or CSV.
      </P>
      <Figure shot="me-contacts" caption="Contacts from exchanges, QR scans and the “share your details back” form." />

      <H2 id="no-app">iPhones & phones without the app</H2>
      <P>
        Besides its own card protocol, a sharing phone also presents a standard NFC Forum Type 4 tag with one link:{' '}
        <C>{'{PUBLIC_WEB_URL}/p/{slug}?via=nfc'}</C>. iPhones and Android phones without the app simply open it — your public card page, with
        <B> Save contact</B>, <B>Share your details back</B> (a short lead form) and a link to get their own card. Only <C>public</C> fields are
        shown. Turn the web page off in share settings to disable this.
      </P>
      <div className="my-6 grid items-start gap-6 sm:grid-cols-2">
        <Figure caption="What an iPhone without the app shows after tapping your phone.">
          <IphoneWebPage />
        </Figure>
        <Figure shot="card-page" narrow caption="The public card page (real screen)." />
      </div>

      <H2 id="qr">QR fallback</H2>
      <UL>
        <li>
          <B>Exchange QR</B> — the app can show a short-lived QR (<C>nfcterminal://card?v=1&amp;t=&lt;token&gt;</C>, 10 minutes) that another app
          user scans to exchange exactly like NFC.
        </li>
        <li>
          <B>Public link QR</B> — a QR of your public page for anyone with a camera.
        </li>
      </UL>

      <H2 id="privacy">Privacy & visibility</H2>
      <div className="my-6 grid items-start gap-6 md:grid-cols-[1fr_1.1fr]">
        <Figure caption="Every field has its own visibility.">
          <PrivacyPanel />
        </Figure>
        <Table
          minWidth={320}
          head={['Visibility', 'Who sees it']}
          rows={[
            [<C key="v">public</C>, 'Anyone: your public page, no-app taps, readers/terminals'],
            [<C key="v">contacts</C>, 'People you exchange with (mutual exchanges)'],
            [<C key="v">hidden</C>, 'Nobody but you'],
          ]}
        />
      </div>
      <P>
        Defaults: name, headline, company, job title, photo, socials and websites are <C>public</C>; phones and emails are <C>contacts</C>; address
        is <C>hidden</C>. Share settings: auto-exchange, web page, lead capture and NFC sharing can each be switched off. Rotating your card’s share
        link makes old tokens and QR codes stop working.
      </P>

      <H2 id="business-issued">Cards issued by a business</H2>
      <div className="my-6 grid items-center gap-6 sm:grid-cols-[auto_1fr]">
        <Figure caption="A branded employee card with locked fields.">
          <BusinessIssuedCard />
        </Figure>
        <UL>
          <li>
            A business member with <C>people.manage</C> invites an employee by email; the employee accepts from their personal account (or signs
            up from the invite).
          </li>
          <li>The card carries the company’s template and branding; fields the business locks (e.g. company, job title) can’t be edited.</li>
          <li>
            Deactivating the employee — or the business being suspended — makes the card <C>inactive</C>: shares fail with{' '}
            <C>card_unavailable</C> and the public page shows a neutral message.
          </li>
          <li>The business sees taps and exchanges of linked cards in its analytics, by employee.</li>
        </UL>
      </div>

      <H2 id="limits">Plans & limits</H2>
      <Table
        head={['Plan', 'Digital cards', 'Contacts', 'Extras']}
        rows={[
          ['Personal (free)', '3', '1,000', 'NFC & QR sharing, mutual exchange, public page'],
          ['Personal Pro', '20', 'Unlimited', 'Premium templates, lead capture export'],
        ]}
      />
      <P>
        Going over a limit returns <C>402 plan_limit_reached</C>. Current prices are on the <DocLink to="/#pricing">pricing</DocLink> section.
      </P>

      <H2 id="developers">For developers: reading digital cards</H2>
      <P>
        Every NFC Terminal (developer or business) recognises digital cards automatically: on any ISO-DEP tag it first sends the digital-card
        SELECT; a phone that answers <C>NFCDC</C> is treated as a digital card, anything else goes through the normal UID flow. If you build your
        own reader client, use the same exchange:
      </P>
      <CodeBlock language="text" title="APDU exchange & token layout" code={tokenLayout} />
      <H3 id="dev-report">Reporting the read</H3>
      <P>
        Send the token with the event. <C>card_type</C> is <C>digital_card</C> and <C>card_id</C> must be the card’s <C>share_id</C> as 32
        uppercase hex characters without dashes (otherwise <C>422 card_id_mismatch</C>).
      </P>
      <CodeBlock language="json" title="POST /device/events" code={devicePayload} />
      <CodeTabs
        title="POST /device/events"
        samples={requestSamples({ method: 'POST', path: '/device/events', auth: 'nfcd_YOUR_DEVICE_TOKEN', body: JSON.parse(devicePayload.replace('…', '')) })}
      />
      <H3 id="dev-payload">What your endpoint receives</H3>
      <CodeBlock language="json" title="card.detected with a digital card" code={webhookPayload} />
      <UL>
        <li>
          The platform verifies the token (MAC, session key, <C>issued_at</C> within −10 / +2 minutes). You can’t verify it yourself — rely on{' '}
          <C>digital_card.verified</C>.
        </li>
        <li>
          Only fields with visibility <C>public</C> are included, and only if the owner has NFC sharing enabled. The owner’s activity shows that
          a terminal of your application read the card (no device details).
        </li>
        <li>
          An invalid or expired token still creates the event, with <C>digital_card.verified = false</C>, no personal data, and an{' '}
          <C>error_code</C> in the response (<C>invalid_card_token</C>, <C>card_token_expired</C>, <C>card_unavailable</C>) so you can debug.
        </li>
        <li>
          Business devices get <C>business.result = &quot;digital_card&quot;</C> with the person as assignee — or <C>recognized</C> with the
          employee, if the card was issued by this business.
        </li>
      </UL>
      <Callout tone="danger" title="A signed token, not strong authentication">
        Tokens are short-lived and signed, which stops simple copying and replay after ten minutes — but a live relay attack is possible. Events
        carry <C>security.level = &quot;signed_token&quot;</C> and <C>authenticated = false</C>. Treat a digital card as a convenient identifier,
        not as proof of identity.
      </Callout>
      <PrevNext slug="digital-cards" />
    </article>
  )
}

import { B, C, Callout, DocHeader, DocLink, H2, OL, P, PrevNext, UL } from '../components/Prose'
import { Figure } from '../components/Figure'
import { ProgrammingDiagram } from '../components/Diagrams'

export default function QuickstartBusinesses() {
  return (
    <article>
      <DocHeader slug="quickstart-businesses" />
      <P>
        No code needed. You&apos;ll create a workspace, publish your profile, add cards, choose what a tap does and write the cards with an
        Android phone.
      </P>

      <H2 id="register">1. Create a business account</H2>
      <P>
        Sign up and choose <B>Business</B>. Enter your business name, email, phone, country and category. This creates your workspace, makes
        you its <B>owner</B>, creates your business profile and a default <B>Business Terminal</B> application for reader phones, on the free{' '}
        <B>Starter</B> plan.
      </P>
      <Callout tone="note" title="Verify your email">
        Until your email is verified, public profile and tap pages show a neutral “This business hasn&apos;t been verified yet” page. You can
        configure everything in the meantime.
      </Callout>

      <H2 id="profile">2. Publish your profile</H2>
      <P>
        Your business profile lives at <C>/b/your-slug</C>. Add sections — about, contact, opening hours, social links, services, products, a
        menu, buttons, a gallery or free text — pick an accent colour and publish. Employee profiles are generated for each employee and can be
        edited too.
      </P>

      <Figure shot="profile" narrow caption="Your public business profile as customers see it on their phone." />

      <H2 id="cards">3. Register cards &amp; tags</H2>
      <UL>
        <li>
          A <B>card</B> is held by a person — an employee business card or a customer loyalty card — or by the company itself (a shared
          front-desk or events card). Assign it to an employee, a customer or the company.
        </li>
        <li>
          A <B>tag</B> is placed on a thing — a table, product, poster or door.
        </li>
      </UL>
      <P>
        Cards are registered <B>on a phone</B>, so the platform learns each chip&apos;s unique ID without any typing: open <B>nexTap</B> on a
        paired business phone → <B>Reader</B> → <B>Register cards</B>, then tap each card. It appears in the dashboard instantly, and the phone
        can assign it to a person or mark it as a company card on the spot. A reader that taps an unknown card also offers{' '}
        <B>Register this card</B>.
      </P>
      <P>
        You can also <B>prepare</B> a card in the dashboard (NFC Cards → Register cards → “Prepare a card here”) with its name, holder and
        action. It shows a <B>Not linked</B> badge until you tap it with nexTap → <B>Program card</B>, which binds the chip and writes the tap
        link. Each card gets a short, unguessable tap link like <C>{'{PUBLIC_API_URL}/t/Ab3dE5gH7k'}</C> — it is not the card&apos;s UID.
      </P>

      <Figure shot="card" caption="A card’s detail page: holder, action, tap statistics and the tap link with its QR code." />

      <H2 id="actions">4. Choose what a tap does</H2>
      <P>
        Pick an action per card, or set a business-wide default: website, business or employee profile, a custom profile, save contact
        (vCard), WhatsApp, phone call, email, maps, social link, digital menu, product info, Wi-Fi, or a developer webhook. With no action,
        a tap opens your business profile. See the <DocLink to="/docs/business-guide#actions">actions table</DocLink>.
      </P>
      <Callout tone="tip">Changing an action or editing a profile never requires reprogramming the card.</Callout>

      <H2 id="program">5. Program the cards</H2>
      <OL>
        <li>
          Add a phone as a reader device: <B>Devices → Add device</B> and scan the pairing QR with the <B>nexTap</B> app.
        </li>
        <li>
          In the app open <B>Program card</B>, search for the card, and hold a blank card or tag to the phone. The app writes an NDEF link
          with the card&apos;s tap URL and confirms.
        </li>
        <li>The card shows as programmed in the dashboard. The app never makes a tag read-only, so you can rewrite it later.</li>
      </OL>

      <Figure scroll caption="Programming writes the card’s link; the tag is never locked.">
        <ProgrammingDiagram />
      </Figure>

      <H2 id="share">6. Tap, share &amp; measure</H2>
      <P>
        Customers just tap with their phone — no app required. Every tap is recorded: total taps, unique visitors, top cards and employees,
        device types and busiest hours in <B>Analytics</B>. Invite your team with the right <DocLink to="/docs/business-guide#roles">role</DocLink>{' '}
        and deactivate a card (or an employee) instantly when needed.
      </P>
      <Figure shot="analytics" caption="Analytics: taps, unique visitors, web vs reader taps and trends." />
      <PrevNext slug="quickstart-businesses" />
    </article>
  )
}

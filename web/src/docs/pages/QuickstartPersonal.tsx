import { B, C, Callout, DocHeader, DocLink, H2, OL, P, PrevNext, UL } from '../components/Prose'
import { Figure } from '../components/Figure'

export default function QuickstartPersonal() {
  return (
    <article>
      <DocHeader slug="quickstart-personal" />
      <P>
        No code and no hardware needed. You&apos;ll create a personal account, design your card, decide what people can see and share it from
        your phone. The <DocLink to="/docs/personal-guide">Personal guide</DocLink> covers each step in more detail.
      </P>

      <H2 id="register">1. Create a personal account</H2>
      <P>
        Sign up and choose <B>Personal</B> (name, email, password). A first card is created for you from a template and you land on your
        dashboard at <C>/me</C>: Overview, My Cards, Contacts, Activity, Share, Business invites and Settings.
      </P>

      <H2 id="card">2. Make your card</H2>
      <P>
        Open <B>My Cards</B> and click your card to open the editor. It autosaves as you go. Work through the tabs on the left (at the bottom on
        a phone):
      </P>
      <UL>
        <li>
          <B>Templates</B> — pick a look. Previews use your own details, and switching keeps everything you&apos;ve entered.
        </li>
        <li>
          <B>Design</B> — palette, colours, background, fonts, icons, corner radius and whether to show a QR code.
        </li>
        <li>
          <B>Content</B> — photo and logo, name, headline, company, phones, emails, websites, social profiles and address.
        </li>
      </UL>
      <Figure shot="me-editor" caption="The card editor: tabs, the panel and a live preview of your card." />

      <H2 id="privacy">3. Choose who sees what</H2>
      <P>
        Every detail has its own visibility: <C>public</C> (anyone with your link), <C>contacts</C> (people you exchange cards with) or{' '}
        <C>hidden</C>. Use <B>View as → Public / Contact</B> above the preview to check both. New cards start from the defaults in{' '}
        <B>Settings → Privacy defaults</B>.
      </P>

      <H2 id="phone">4. Sign in on your phone</H2>
      <OL>
        <li>
          Install nexTap on your Android phone (<DocLink to="/docs/mobile-app#download">download</DocLink>) and choose <B>Personal digital
          card</B>.
        </li>
        <li>
          On the web, open <B>Share → Sign in on your phone</B> and scan the QR code with the app. The code works once, for 5 minutes. You can
          also sign in with your password.
        </li>
      </OL>
      <Callout tone="note" title="No Android phone?">
        You can still share your card with its link and QR code. Anyone can open it in a browser, including on an iPhone.
      </Callout>

      <H2 id="share">5. Share &amp; collect contacts</H2>
      <UL>
        <li>
          <B>NFC</B> — open nexTap, choose <B>Share</B> and hold your phone near another phone or reader. Your phone shares your <B>primary</B> card.
        </li>
        <li>
          <B>Link &amp; QR</B> — <B>Share → Public link &amp; QR</B>. Print it, add it to your email signature or LinkedIn.
        </li>
        <li>
          <B>Exchange QR</B> — for phones without NFC: they scan it in nexTap and you both get each other&apos;s card.
        </li>
      </UL>
      <P>
        People you exchange with land in <B>Contacts</B>, and <B>Activity</B> shows views, NFC taps, exchanges and leads. See{' '}
        <DocLink to="/docs/digital-cards#exchange">Mutual exchange</DocLink> for how exchanges work.
      </P>
      <PrevNext slug="quickstart-personal" />
    </article>
  )
}

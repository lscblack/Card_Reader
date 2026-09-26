import { B, C, Callout, DocHeader, DocLink, H2, OL, P, PrevNext, Table, UL } from '../components/Prose'
import { Figure } from '../components/Figure'

export default function PersonalGuide() {
  return (
    <article>
      <DocHeader slug="personal-guide" />
      <P>
        This guide walks through the personal dashboard task by task. For how sharing, exchange, privacy and plans work under the hood, see{' '}
        <DocLink to="/docs/digital-cards">Digital cards</DocLink>.
      </P>

      <H2 id="account">Your account &amp; dashboard</H2>
      <P>
        Sign up and choose <B>Personal</B>. You get a first card straight away and land on <C>/me</C>. The sidebar has:
      </P>
      <Table
        head={['Page', 'What it is for']}
        rows={[
          ['Overview', 'Your primary card, your public link, the last 30 days (views, NFC taps, exchanges, leads) and recent activity'],
          ['My Cards', 'All your cards: create, edit, duplicate, set as primary, delete'],
          ['Contacts', 'Everyone you exchanged cards with, people who shared their details back, and contacts you added'],
          ['Activity', 'Views, NFC taps, exchanges and leads over time, and how people opened your card'],
          ['Share', 'Public link & QR, exchange QR, and the QR that signs the app in as you'],
          ['Business invites', 'Company-issued cards waiting for you to accept'],
          ['Settings', 'Profile, password, phones signed in and privacy defaults'],
        ]}
      />
      <Figure shot="me" caption="The personal Overview: your primary card, your link and the last 30 days." />
      <P>A short tour runs the first time you visit. Replay it from your user menu.</P>

      <H2 id="first-card">Make your first card</H2>
      <P>
        Your first card is ready to edit under <B>My Cards</B>. You can keep several — for work, personal life or an event. Your phone always
        shares the <B>primary</B> one.
      </P>
      <OL>
        <li>
          <B>My Cards → New card</B>. Give it a label (only you see it, e.g. “Work”) and pick a template. Your details are copied from your
          primary card.
        </li>
        <li>
          <B>Create card</B> opens the editor. Changes save automatically about a second after you stop typing — watch for{' '}
          <B>All changes saved</B> at the top. Undo and redo with <C>Ctrl/Cmd+Z</C> and <C>Ctrl/Cmd+Shift+Z</C>.
        </li>
        <li>
          Back in My Cards, use a card&apos;s <B>⋯</B> menu to <B>Set as primary</B>, <B>Duplicate</B> or <B>Delete</B> it.
        </li>
      </OL>

      <H2 id="templates">Choose a template</H2>
      <P>
        The <B>Templates</B> tab lists every template, previewed with your own details: business cards and vertical ID badges, some with a
        back side. Switching template keeps everything you&apos;ve entered and moves blocks to matching places, so you can try several.
      </P>
      <Callout tone="note">
        If your company issued the card and set its template, the Templates tab says so and the design is managed for you.
      </Callout>

      <H2 id="design">Design</H2>
      <UL>
        <li>
          <B>Palette</B> — one-click colour sets, or pull colours from your photo or logo.
        </li>
        <li>
          <B>Colours</B> — primary, secondary, background, text and accent. Text on coloured shapes turns white when needed for readability.
        </li>
        <li>
          <B>Background</B> — style (solid, gradient, glass, pattern) and an optional background image with opacity.
        </li>
        <li>
          <B>Fonts</B>, <B>icons</B>, <B>corner radius</B>, template <B>variant</B> and <B>Show QR code</B>.
        </li>
      </UL>

      <H2 id="content">Content &amp; visibility</H2>
      <P>
        The <B>Content</B> tab holds your details: photo and logo (PNG, JPEG or WebP up to 3 MB, with a crop step), name, headline, company,
        job title, bio, phones, emails, websites, social profiles, address and, for ID badges, badge details such as an ID number and barcode.
      </P>
      <P>
        Each detail has a visibility: <C>public</C>, <C>contacts</C> or <C>hidden</C>. Switch <B>View as</B> between <B>Public</B> and{' '}
        <B>Contact</B> above the preview to see what each audience gets. Details are explained in{' '}
        <DocLink to="/docs/digital-cards#privacy">Privacy &amp; visibility</DocLink>.
      </P>
      <Figure shot="me-editor" caption="Editing content with per-field visibility and a live preview." />

      <H2 id="arrange">Arrange blocks</H2>
      <P>
        Templates with areas have an <B>Arrange</B> tab. Drag blocks (name, photo, contact rows, QR…) between areas, or use a block&apos;s{' '}
        <B>⋯</B> menu. Click an area on the card preview to jump to it. Blocks you remove go to <B>Hidden blocks</B>, where you can put them
        back. For two-sided templates, switch between <B>Front</B> and <B>Back</B> or <B>Flip</B> the preview.
      </P>

      <H2 id="full-screen">Full-screen editing</H2>
      <P>
        Click the full-screen button next to undo/redo to hide the sidebar and top bar and give the editor the whole window. Press{' '}
        <C>Esc</C> or click the button again to exit; leaving the editor exits too. Zoom the preview with <B>−</B> and <B>+</B> (50–160%).
      </P>

      <H2 id="share">Share your card</H2>
      <Table
        head={['Way', 'How', 'Good for']}
        rows={[
          ['NFC', 'Open nexTap, choose Share and hold your phone near theirs or a reader', 'Meeting someone in person; works offline'],
          ['Link', <><B key="b">Share → Public link &amp; QR</B>, or <C key="c">/p/your-link</C></>, 'Email signature, LinkedIn, messages'],
          ['QR code', 'Same page; download or print it', 'Printed material, screens, iPhones'],
          ['Exchange QR', 'Share → Exchange QR; they scan it in nexTap', 'Phones without NFC — you both get each other’s card'],
        ]}
      />
      <P>
        Per card, the editor&apos;s <B>Share</B> tab controls the rest: your link (3–48 lowercase letters, numbers or dashes), the{' '}
        <B>Public web page</B>, <B>Automatic exchange</B>, <B>Let visitors share back</B> (a short form on your page), <B>Two-sided card</B>,
        and <B>Card is active</B>. <B>Rotate codes</B> stops old QR codes, exchange codes and NFC tokens for that card immediately; your link
        stays the same.
      </P>
      <P>
        To share over NFC, sign the app in first: <B>Share → Sign in on your phone</B> and scan the QR with nexTap (single use, valid 5
        minutes). See <DocLink to="/docs/digital-cards#share-scan">Share vs scan</DocLink> for what works with the screen off or locked.
      </P>

      <H2 id="contacts">Contacts</H2>
      <UL>
        <li>
          Contacts arrive on their own from NFC and QR exchanges and from the share-back form on your page (<B>Web lead</B>). Add others by hand
          with <B>Add contact</B>.
        </li>
        <li>Exchanged contacts update automatically when the other person edits their card.</li>
        <li>Search by name, company, email or notes, and filter by tag, source or favourites.</li>
        <li>
          Open a contact to add notes and tags, star it as a favourite, <B>Save vCard</B> or delete it. Deleting only removes them from your
          list — exchanging again adds them back.
        </li>
        <li>
          Export everything as <B>vCard</B> or <B>CSV</B> from the top of the page.
        </li>
      </UL>
      <Figure shot="me-contacts" caption="Contacts with search, tags, sources and favourites." />

      <H2 id="activity">Activity</H2>
      <P>
        Pick 7, 30 or 90 days. You get totals for views, NFC taps, exchanges and leads, a daily chart, a breakdown of how people opened your
        card (NFC, QR code, link…) and a timeline. Your QR adds <C>?via=qr</C> so QR visits are counted separately.
      </P>

      <H2 id="invites">Business invites</H2>
      <P>
        An employer can issue you a branded company card. It shows up under <B>Business invites</B> (with a badge in the sidebar) —{' '}
        <B>Accept</B> to add it next to your own cards, or <B>Decline</B>. You need a verified email to see invites.
      </P>
      <P>
        A company card may have locked fields (like the company name) and a locked template; the editor shows what is managed for you. You
        can&apos;t delete it yourself. See <DocLink to="/docs/digital-cards#business-issued">Cards issued by a business</DocLink>.
      </P>

      <H2 id="settings">Settings</H2>
      <UL>
        <li>
          <B>Profile</B> — your account name and phone. Each card has its own details; edit those in My Cards. To change your account email,
          contact support.
        </li>
        <li>
          <B>Password</B> — change your password.
        </li>
        <li>
          <B>Phones signed in</B> — every phone running nexTap as you. Sign out a phone you lost or no longer use; it stops sharing your card
          immediately.
        </li>
        <li>
          <B>Privacy defaults</B> — default visibility for phones, emails and address on new cards, and <B>Automatic exchange</B>.
        </li>
      </UL>

      <H2 id="theme">Light &amp; dark theme</H2>
      <P>
        Use the theme button in the top bar to choose <B>Light</B>, <B>Dark</B> or <B>System</B> (follows your device). On a desktop, collapse
        the sidebar to icons with the button at its top or <C>Ctrl/Cmd+B</C>; the choice is remembered.
      </P>
      <PrevNext slug="personal-guide" />
    </article>
  )
}

import { Check, Minus } from 'lucide-react'
import { B, C, Callout, DocHeader, DocLink, H2, H3, OL, P, PrevNext, Table, UL } from '../components/Prose'
import { Figure } from '../components/Figure'
import { ProgrammingDiagram, TapFlowDiagram } from '../components/Diagrams'
import { BusinessResultMock } from '../components/PhoneMocks'

const yes = <Check className="h-4 w-4 text-emerald-500" aria-label="Yes" />
const no = <Minus className="h-4 w-4 text-subtle" aria-label="No" />

const perms: [string, string, boolean, boolean | 'partial', boolean, boolean][] = [
  ['business.view', 'Overview; read cards, tags, employees, customers, taps, profiles', true, true, true, true],
  ['cards.manage', 'Cards, tags, actions, assignments', true, true, true, false],
  ['people.manage', 'Employees and customers', true, true, true, false],
  ['profiles.manage', 'Public profiles', true, true, true, false],
  ['devices.manage', 'Reader devices and pairing', true, true, true, false],
  ['analytics.view', 'Analytics', true, true, true, false],
  ['api.view / api.manage', 'Applications, keys, webhooks, sandbox, request logs', true, true, false, false],
  ['team.manage', 'Members and invitations', true, 'partial', false, false],
  ['settings.manage', 'Business settings', true, true, false, false],
  ['billing.manage, business.delete, ownership.transfer', 'Owner-only', true, false, false, false],
]

export default function BusinessGuide() {
  return (
    <article>
      <DocHeader slug="business-guide" />

      <H2 id="cards-vs-tags">Cards vs tags</H2>
      <P>
        Both are the same thing technically — an NFC chip with a tap link — and share one model with a <C>kind</C>:
      </P>
      <Table
        head={['', 'Card', 'Tag']}
        rows={[
          ['Held by', 'A person (employee or customer)', 'A thing: table, product, poster, door, shelf'],
          ['Typical actions', 'Employee profile, save contact, WhatsApp, loyalty', 'Menu, product info, Wi-Fi, website, reviews'],
          ['Assignment', 'Assign / unassign to an employee or customer (history kept)', 'Usually unassigned'],
        ]}
      />
      <UL>
        <li>
          Each card has a <C>public_code</C> (10 random characters) and a <C>tap_url</C> <C>{'{PUBLIC_API_URL}/t/{public_code}'}</C>. The
          code is unguessable and is <B>not</B> the chip&apos;s UID.
        </li>
        <li>
          The UID is optional and bound when a reader device registers or programs the card; it&apos;s unique per business.
        </li>
        <li>
          <B>Effective status</B> combines several states: <C>active</C>, <C>inactive</C>, <C>inactive_owner</C> (its employee was
          deactivated), <C>unassigned</C>, <C>business_suspended</C>.
        </li>
        <li>Create cards in bulk (1–500 at a time, with a name prefix) for a print batch; they start unprogrammed.</li>
      </UL>

      <Figure shot="card" caption="Card detail: the holder, the tap action, statistics and the printable tap-link QR code." />

      <H2 id="actions">Tap actions</H2>
      <P>
        An action decides what happens when someone taps. Set one per card, or a business-wide default; with neither, the tap opens your
        business profile. Forms in the dashboard are generated from <C>GET /actions/types</C>.
      </P>
      <Table
        minWidth={640}
        head={['Type', 'Config', 'Tap result']}
        rows={[
          [<C key="t">website</C>, <C key="c">{'{ url }'}</C>, 'Redirect to the URL (https)'],
          [<C key="t">custom_url</C>, <C key="c">{'{ url }'}</C>, 'Redirect to the URL'],
          [<C key="t">business_profile</C>, <C key="c">{'{}'}</C>, <>Redirect to <C>/b/{'{slug}'}</C></>],
          [<C key="t">employee_profile</C>, <C key="c">{'{ employee_id? }'}</C>, "Employee's profile (default: the card's assignee)"],
          [<C key="t">profile</C>, <C key="c">{'{ profile_id }'}</C>, 'A custom, menu or product profile page'],
          [<C key="t">share_contact</C>, <C key="c">{'{ employee_id? }'}</C>, 'Downloads a vCard (assignee or business)'],
          [<C key="t">whatsapp</C>, <C key="c">{'{ phone, message? }'}</C>, <>Opens <C>wa.me</C> chat, optional pre-filled message</>],
          [<C key="t">phone_call</C>, <C key="c">{'{ phone }'}</C>, 'Page with a call button (browsers block direct tel: redirects)'],
          [<C key="t">email</C>, <C key="c">{'{ to, subject?, body? }'}</C>, 'Opens a mailto: link'],
          [<C key="t">maps</C>, <C key="c">{'{ query? | lat, lng }'}</C>, 'Opens Google Maps'],
          [<C key="t">social</C>, <C key="c">{'{ platform, url }'}</C>, 'Redirect to the social profile'],
          [<C key="t">digital_menu</C>, <C key="c">{'{ profile_id? | url? }'}</C>, 'Menu profile page or external menu URL'],
          [<C key="t">product_info</C>, <C key="c">{'{ profile_id? | url? }'}</C>, 'Product profile page or URL'],
          [<C key="t">wifi</C>, <C key="c">{'{ ssid, password?, security, hidden? }'}</C>, 'Page with network name, copy-password button and a Wi-Fi QR code'],
          [<C key="t">developer_webhook</C>, <C key="c">{'{ application_id, then? }'}</C>, <>Signed <C>card.tapped</C> delivery to the app&apos;s endpoint, then the <C>then</C> action or profile</>],
        ]}
      />
      <UL>
        <li>
          Phone numbers use E.164 (<C>+447700900123</C>). URLs must be <C>https://</C>. Invalid configs return{' '}
          <C>422 invalid_action_config</C> (<C>NFC-6010</C>) with field details.
        </li>
        <li>
          Preview any action before saving with <C>POST /businesses/{'{id}'}/actions/preview</C>.
        </li>
        <li>Unknown or inactive cards open a neutral “unavailable” page; link-preview bots are recorded but excluded from analytics.</li>
      </UL>

      <Figure scroll caption="Customer phones open the tap link; reader devices look the card up.">
        <TapFlowDiagram />
      </Figure>

      <H2 id="profiles">Profiles</H2>
      <P>
        Profiles are public pages at <C>/b/{'{business_slug}'}</C> and <C>/b/{'{business_slug}'}/{'{profile_slug}'}</C>. Types:{' '}
        <C>business</C> (one per business), <C>employee</C> (generated per employee), and any number of <C>custom</C>, <C>menu</C> and{' '}
        <C>product</C> profiles. Each has an accent colour, optional cover image and a list of sections:
      </P>
      <Table
        head={['Section', 'Content']}
        rows={[
          [<C key="s">about</C>, 'Text'],
          [<C key="s">contact</C>, 'Phone, email, website, address'],
          [<C key="s">hours</C>, 'Opening hours per day'],
          [<C key="s">social</C>, 'Social links'],
          [<C key="s">services</C>, 'Title, description, optional price'],
          [<C key="s">products</C>, 'Title, description, price, image, link'],
          [<C key="s">menu</C>, 'Categories with items, prices and tags'],
          [<C key="s">buttons</C>, 'Buttons that run any action'],
          [<C key="s">gallery</C>, 'Images'],
          [<C key="s">text</C>, 'Markdown'],
        ]}
      />
      <P>
        Publish or unpublish any time; updating a profile never requires reprogramming a card. Every profile also offers a vCard download.
        Unpublished, inactive, suspended or unverified profiles show a neutral page. Changing your slug keeps the old one redirecting for
        90 days.
      </P>

      <Figure shot="profile" narrow caption="A published business profile on a customer’s phone." />

      <H2 id="employees">Employees &amp; customers</H2>
      <UL>
        <li>
          <B>Employees</B> have a name, photo, position, department, contact details, social links and an optional public profile.
        </li>
        <li>
          <B>Deactivating</B> an employee immediately disables their cards (<C>inactive_owner</C>) and unpublishes their profile; reactivating
          restores both.
        </li>
        <li>
          <B>Customers</B> have contact details, company, notes and tags — useful for loyalty or membership cards.
        </li>
        <li>Both show their cards, total taps and last tap. Search by name, email, phone or position.</li>
      </UL>

      <H2 id="roles">Team roles &amp; permissions</H2>
      <div className="my-5 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[640px] border-collapse text-left text-[13.5px]">
          <caption className="sr-only">Permissions by role</caption>
          <thead className="bg-surface-2">
            <tr>
              {['Permission', 'Allows', 'Owner', 'Admin', 'Manager', 'Staff'].map((h) => (
                <th key={h} scope="col" className="border-b border-border px-3.5 py-2.5 text-[12px] font-semibold tracking-wide text-subtle uppercase">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {perms.map(([p, desc, ...cells]) => (
              <tr key={p} className="border-b border-border last:border-0">
                <th scope="row" className="px-3.5 py-2.5 text-left align-top font-mono text-[12.5px] font-medium text-fg">
                  {p}
                </th>
                <td className="px-3.5 py-2.5 align-top text-muted">{desc}</td>
                {cells.map((c, i) => (
                  <td key={i} className="px-3.5 py-2.5 align-top">
                    {c === 'partial' ? <span className="text-[12px] text-muted">✓ (not owners)</span> : c ? yes : no}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <UL>
        <li>
          Owners and admins can grant extra permissions to a member (never billing, delete or ownership transfer).
        </li>
        <li>
          Only owners change owners; there is always at least one active owner (<C>409 last_owner</C>); nobody edits their own role.
        </li>
        <li>
          Invitations are emailed and expire after 7 days. The invited email must match the account that accepts (
          <C>403 invitation_email_mismatch</C>).
        </li>
        <li>
          The UI hides what you can&apos;t do, and the API enforces it: <C>403 insufficient_permissions</C> (<C>NFC-6003</C>) with{' '}
          <C>details.required</C>.
        </li>
      </UL>

      <H2 id="analytics">Analytics</H2>
      <P>
        Every tap — from a customer&apos;s browser (<C>web</C>) or a reader device (<C>reader</C>) — is recorded. Analytics cover 7, 30, 90 or
        365 days, optionally per card or employee:
      </P>
      <UL>
        <li>Total taps and unique visitors, web vs reader, compared with the previous period</li>
        <li>Timeline, top cards, top employees, actions used</li>
        <li>Device types, countries and taps by hour of day</li>
      </UL>
      <Figure shot="analytics" caption="Business analytics for the last 30 days." />
      <Callout tone="note" title="Privacy">
        Unique visitors are counted with a hash that uses a daily-rotating salt. Raw IP addresses are not stored, there is no GeoIP lookup, and
        country is only taken from a trusted proxy header when available.
      </Callout>

      <H2 id="programming">Programming cards</H2>
      <OL>
        <li>Pair a phone to your business (Devices → Add device, scan the QR code with NFC Terminal).</li>
        <li>
          In the app open <B>Program card</B>, search for the card, hold a writable card or tag to the phone.
        </li>
        <li>
          The app writes an NDEF URI record with the tap URL (optionally a native Wi-Fi record for <C>wifi</C> actions), then marks the card
          programmed and binds its UID.
        </li>
      </OL>
      <Figure scroll caption="Programming a card from a business reader device.">
        <ProgrammingDiagram />
      </Figure>
      <P>
        This requires the business setting <B>Devices can register cards</B> (on by default), which grants devices the{' '}
        <C>cards.register</C> and <C>cards.program</C> capabilities. Tags are never locked, so they can be rewritten.
      </P>

      <H2 id="reader-devices">Reader devices</H2>
      <P>
        A phone running NFC Terminal and paired to your business becomes a front-desk reader. When a card is tapped on it, the app shows
        whether it&apos;s recognised, who it belongs to and its status, and offers to open its action. Unknown cards can be registered on the
        spot. Devices can be assigned to an employee; the dashboard shows which are online and their recent activity.
      </P>
      <div className="my-6 grid gap-5 sm:grid-cols-3">
        <Figure caption="Recognized card">
          <BusinessResultMock state="recognized" />
        </Figure>
        <Figure caption="Inactive card">
          <BusinessResultMock state="inactive" />
        </Figure>
        <Figure caption="Unknown card">
          <BusinessResultMock state="unknown" />
        </Figure>
      </div>
      <Callout tone="warning" title="Reader devices identify cards, they don't authenticate them">
        Recognising a card by UID is convenient for check-ins and lookups, but a UID can be cloned. See{' '}
        <DocLink to="/docs/security#uid">Security</DocLink>.
      </Callout>

      <H2 id="developers">Webhooks for businesses</H2>
      <P>
        Businesses get the full developer platform too: applications, API keys, endpoints, signed webhooks, sandbox and request logs (needs{' '}
        <C>api.view</C> / <C>api.manage</C>). Use the <C>developer_webhook</C> action to send taps to your own system — the event is{' '}
        <C>card.tapped</C>, signed exactly like <DocLink to="/docs/webhooks">card.detected</DocLink>.
      </P>
      <H3 id="business-api">Business API</H3>
      <P>
        All business routes live under <C>/businesses/{'{business_id}'}/…</C> and require membership. See the{' '}
        <DocLink to="/docs/api-reference#businesses">REST API reference</DocLink>.
      </P>

      <H2 id="plans">Plans &amp; limits</H2>
      <Table
        head={['Plan', 'Cards & tags', 'Reader devices', 'Members', 'Taps / month']}
        rows={[
          ['Starter (free)', '50', '3', '5', '10,000'],
          ['Growth', '1,000', '25', '25', '250,000'],
          ['Enterprise', 'Unlimited', 'Unlimited', 'Unlimited', 'Unlimited'],
        ]}
      />
      <P>
        Going over a limit returns <C>402 plan_limit_reached</C> (<C>NFC-7001</C>) with <C>details.limit</C>. Current usage is under{' '}
        <B>Billing</B>.
      </P>
      <PrevNext slug="business-guide" />
    </article>
  )
}

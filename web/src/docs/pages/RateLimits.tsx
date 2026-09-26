import { CodeBlock } from '../components/Code'
import { B, C, DocHeader, DocLink, H2, P, PrevNext, Table, UL } from '../components/Prose'

const response429 = `HTTP/1.1 429 Too Many Requests
Retry-After: 30
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1790325081

{ "error": { "code": "rate_limited", "message": "Too many requests", "ref": "…", "request_id": "…" } }`

export default function RateLimits() {
  return (
    <article>
      <DocHeader slug="rate-limits" />

      <H2 id="request-limits">Request rate limits</H2>
      <P>
        Requests are limited per client with a sliding window (Redis). The default limit is configured by the platform operator (
        <C>RATE_LIMIT_REQUESTS</C> per <C>RATE_LIMIT_WINDOW_SECONDS</C>, adjustable in the admin console). Some routes are stricter:
      </P>
      <Table
        head={['Route', 'Limit']}
        rows={[
          ['Auth endpoints (login, register, password reset…)', '10 requests per minute per IP'],
          [<>Public tap links <C>/t/{'{code}'}</C> and profiles</>, 'Rate limited per client; profiles are cached up to 60 s'],
          [<>Sandbox receiver <C>/sandbox/{'{token}'}</C></>, 'Rate limited per token'],
          ['Everything else', 'Platform default'],
        ]}
      />
      <P>Every response carries the current state:</P>
      <Table
        head={['Header', 'Meaning']}
        rows={[
          [<C key="h">X-RateLimit-Limit</C>, 'Requests allowed in the window'],
          [<C key="h">X-RateLimit-Remaining</C>, 'Requests left in the current window'],
          [<C key="h">X-RateLimit-Reset</C>, 'When the window resets'],
          [<C key="h">Retry-After</C>, 'On 429 only: seconds to wait'],
        ]}
      />

      <H2 id="handling-429">Handling 429</H2>
      <CodeBlock language="http" title="429 response" code={response429} />
      <UL>
        <li>
          Wait at least <C>Retry-After</C> seconds, then retry with backoff and jitter. Don&apos;t retry in a tight loop.
        </li>
        <li>
          The nexTap app treats <C>429</C> as retryable and queues the event (5 s, 30 s, 2 min, then every 10 min).
        </li>
        <li>
          Your webhook endpoint can also answer <C>429</C> — the platform treats it as a failed attempt and retries later (relay).
        </li>
      </UL>

      <H2 id="plan-limits">Plan limits</H2>
      <P>
        Plan limits are separate from rate limits. Exceeding your monthly events, applications or devices (developers) or cards, devices,
        members or monthly taps (businesses) returns <C>402 plan_limit_reached</C> (<C>NFC-7001</C>), with <C>details.limit</C> naming the
        limit. See <B>Usage</B> or <B>Billing</B> in the dashboard, and <DocLink to="/#pricing">pricing</DocLink>.
      </P>
      <Table
        head={['Developer plan', 'Events / month', 'Applications', 'Devices']}
        rows={[
          ['Free', '10,000', '3', '5'],
          ['Pro', '250,000', '20', '100'],
          ['Business', '5,000,000', 'Unlimited', 'Unlimited'],
        ]}
        minWidth={460}
      />
      <P>
        A pairing code counts towards the device limit when it is redeemed, not when it is created.
      </P>
      <PrevNext slug="rate-limits" />
    </article>
  )
}

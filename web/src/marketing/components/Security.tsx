import { Link } from 'react-router'
import { ArrowRight, Fingerprint, Globe2, ScrollText, ShieldCheck, TriangleAlert, type LucideIcon } from 'lucide-react'
import { GlowCard } from './GlowCard'
import { Reveal, SectionHeading } from './Reveal'

const items: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: ShieldCheck,
    title: 'HMAC-SHA256 signatures',
    body: 'Every delivery carries v1= HMAC-SHA256 over timestamp, nonce and the raw body. In relay mode the webhook secret never leaves our servers; in direct mode phones hold only a per-device derived key.',
  },
  {
    icon: Fingerprint,
    title: 'Replay & duplicate protection',
    body: 'A timestamp and a random nonce on every attempt let you reject stale or replayed requests. Retries reuse the event ID so you can process each tap exactly once.',
  },
  {
    icon: Globe2,
    title: 'Endpoint allowlists & SSRF guard',
    body: 'Restrict each application to the domains you own. HTTPS is enforced and private, loopback and metadata addresses are blocked outside development.',
  },
  {
    icon: ScrollText,
    title: 'Audit & request logs',
    body: 'Sensitive actions are audited, and every request is logged with a request ID — without bodies, secrets or raw IP addresses.',
  },
]

export function Security() {
  return (
    <section id="security" className="scroll-mt-20 py-20 sm:py-28" aria-labelledby="security-title">
      <div className="mx-auto w-11/12">
        <SectionHeading
          id="security-title"
          eyebrow="Security"
          title="Secure delivery, honest about what NFC can prove"
          subtitle="We sign and log everything we send. We are also upfront about the limits of reading a card's ID."
        />
        <div className="mt-14 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <ul className="grid gap-4 sm:grid-cols-2">
            {items.map((it, i) => (
              <Reveal as="li" key={it.title} delay={(i % 2) * 0.06}>
                <GlowCard className="h-full" tilt={3}>
                  <div className="p-5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
                      <it.icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <h3 className="mt-3 text-[15.5px] font-semibold text-fg">{it.title}</h3>
                    <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{it.body}</p>
                  </div>
                </GlowCard>
              </Reveal>
            ))}
          </ul>
          <Reveal className="relative overflow-hidden rounded-2xl border border-accent/40 bg-accent-soft p-6 sm:p-7">
            <TriangleAlert className="h-6 w-6 text-accent" aria-hidden="true" />
            <h3 className="mt-3 text-xl font-semibold text-fg">A card UID is not proof of identity</h3>
            <p className="mt-3 text-[14.5px] leading-relaxed text-muted">
              A UID identifies a card; it doesn't authenticate it. Many UIDs can be read by anyone nearby, cloned or randomised. Every event
              says so explicitly:
            </p>
            <pre className="mt-4 overflow-x-auto rounded-lg bg-code-bg p-3 text-[12.5px] text-code-fg">
              <code>{'"security": {\n  "authenticated": false,\n  "level": "uid_only"\n}'}</code>
            </pre>
            <p className="mt-4 text-[14px] leading-relaxed text-muted">
              Great for attendance, check-ins, loyalty, lookups and business cards. Don't use the UID alone for payments, high-security doors or
              anything where impersonation matters — pair it with a PIN, a person or your own checks.
            </p>
            <Link to="/docs/security" className="group mt-5 inline-flex items-center gap-1.5 text-[14px] font-semibold text-accent">
              Security model <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

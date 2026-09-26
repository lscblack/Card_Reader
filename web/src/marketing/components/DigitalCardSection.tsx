import { ArrowRight, Info, QrCode, Radio, Repeat2, ShieldCheck, Smartphone, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router'
import { useDashboardPath, useIsLoggedIn } from '../lib'
import { GlowCard } from './GlowCard'
import { PrimaryLink } from './MarketingNav'
import { Reveal, SectionHeading } from './Reveal'
import { PhoneExchange } from './digital/Exchange'
import { BusinessIssuedCard, IphoneWebPage, PrivacyPanel, TemplatesCarousel } from './digital/Showcase'

const points: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Radio, title: 'Share with a tap', body: 'Hold your phone near another phone or reader. Your primary card goes across over NFC.' },
  { icon: Repeat2, title: 'Mutual exchange', body: 'When someone scans you, you get their card back automatically — unless you turn auto-exchange off.' },
  { icon: Smartphone, title: 'No app on the other side', body: 'iPhones and other phones without the app open your card as a web page, straight from the tap.' },
  { icon: QrCode, title: 'QR when NFC isn’t there', body: 'Show a short-lived exchange QR or your public link QR instead.' },
]

export function DigitalCardSection() {
  const loggedIn = useIsLoggedIn()
  const dashboardPath = useDashboardPath()
  return (
    <section id="digital-card" className="relative scroll-mt-20 overflow-hidden py-20 sm:py-28" aria-labelledby="digital-title">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-1/2 -z-10 h-[480px] w-[min(1000px,140%)] -translate-x-1/2 opacity-30 blur-3xl dark:opacity-40"
        style={{ background: 'radial-gradient(closest-side, color-mix(in oklab, var(--accent-solid) 35%, transparent), transparent)' }}
      />
      <div className="mx-auto w-11/12">
        <SectionHeading
          id="digital-title"
          eyebrow="Digital card · for individuals"
          title="Your business card, now on your phone"
          subtitle="Design a card, tap phones to swap details, and keep every contact you meet — with you in control of what each person sees."
        />

        <div className="mt-14 grid items-center gap-12 lg:grid-cols-2">
          <div>
            <ul className="grid gap-5 sm:grid-cols-2">
              {points.map((p, i) => (
                <Reveal as="li" key={p.title} delay={i * 0.06} className="flex gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <p.icon className="h-4.5 w-4.5" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-[15px] font-semibold text-fg">{p.title}</span>
                    <span className="mt-0.5 block text-[14px] leading-relaxed text-muted">{p.body}</span>
                  </span>
                </Reveal>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <PrimaryLink to={loggedIn ? dashboardPath : '/register?type=personal'} size="lg">
                {loggedIn ? 'Go to dashboard' : 'Create your free card'}
              </PrimaryLink>
              <Link to="/docs/digital-cards" className="group inline-flex items-center gap-1.5 text-[14px] font-semibold text-accent">
                How digital cards work <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            </div>
          </div>
          <Reveal>
            <PhoneExchange />
          </Reveal>
        </div>

        <Reveal className="mt-20">
          <h3 className="text-center text-xl font-semibold text-fg">Templates for every style</h3>
          <p className="mx-auto mt-2 max-w-xl text-center text-[14.5px] text-muted">Pick a layout, then make it yours — colours, background, font and corners. Your card looks the same on the web and in the app.</p>
          <div className="mt-8">
            <TemplatesCarousel />
          </div>
        </Reveal>

        <div className="mt-16 grid gap-4 md:grid-cols-3">
          <Reveal>
            <GlowCard className="h-full" tilt={2}>
              <div className="flex h-full flex-col p-6">
                <h3 className="text-[16px] font-semibold text-fg">What the other person sees</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">No app? Their phone reads a link from yours and opens your card page — save the contact or share details back.</p>
                <div className="mt-5 flex-1">
                  <IphoneWebPage />
                </div>
              </div>
            </GlowCard>
          </Reveal>
          <Reveal delay={0.06}>
            <GlowCard className="h-full" tilt={2}>
              <div className="flex h-full flex-col p-6">
                <h3 className="text-[16px] font-semibold text-fg">Privacy, field by field</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">Choose what’s public, what only people you exchange with get, and what stays hidden.</p>
                <div className="mt-5 flex-1">
                  <PrivacyPanel />
                </div>
              </div>
            </GlowCard>
          </Reveal>
          <Reveal delay={0.12}>
            <GlowCard className="h-full" tilt={2}>
              <div className="flex h-full flex-col p-6">
                <h3 className="text-[16px] font-semibold text-fg">Cards issued by your employer</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">Businesses can give employees a branded digital card that lives in their personal account.</p>
                <div className="mt-5 flex-1">
                  <BusinessIssuedCard />
                </div>
              </div>
            </GlowCard>
          </Reveal>
        </div>

        <Reveal className="mx-auto mt-10 flex max-w-3xl gap-3 rounded-2xl border border-border bg-surface-2/60 p-4 text-[13px] leading-relaxed text-muted">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <p>
            <ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-accent" aria-hidden="true" />A digital card shares a signed, short-lived token — an
            identifier, not strong authentication. Sharing needs the screen on (and on most phones unlocked), and pauses while your own phone is
            scanning.
          </p>
        </Reveal>
      </div>
    </section>
  )
}

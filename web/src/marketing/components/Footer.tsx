import { Link } from 'react-router'
import { Logo } from '@/components/Logo'
import { useDashboardPath, POWERED_BY_URL, useIsLoggedIn, useProductName } from '../lib'
import { DownloadApp } from './DownloadApp'
import { PrimaryLink, SecondaryLink } from './MarketingNav'
import { Reveal } from './Reveal'

export function FinalCta() {
  const loggedIn = useIsLoggedIn()
  const dashboardPath = useDashboardPath()
  return (
    <section className="py-20 sm:py-24" aria-labelledby="cta-title">
      <div className="mx-auto w-11/12">
        <Reveal className="relative overflow-hidden rounded-3xl border border-border-strong bg-surface px-6 py-14 text-center sm:px-12 sm:py-20">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{ background: 'radial-gradient(60% 80% at 50% 0%, color-mix(in oklab, var(--accent-solid) 28%, transparent), transparent 70%)' }}
          />
          <h2 id="cta-title" className="relative mx-auto max-w-2xl text-3xl font-semibold tracking-tight text-balance text-fg sm:text-4xl">
            Your next tap could already be doing something useful.
          </h2>
          <p className="relative mx-auto mt-4 max-w-xl text-[15.5px] text-muted">
            Create a free account, pair a phone and tap your first card in a few minutes.
          </p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            {loggedIn ? (
              <PrimaryLink to={dashboardPath} size="lg">
                Go to dashboard
              </PrimaryLink>
            ) : (
              <>
                <PrimaryLink to="/register?type=business" size="lg">
                  Start as a business
                </PrimaryLink>
                <SecondaryLink to="/register">Start as a developer</SecondaryLink>
              </>
            )}
          </div>
        </Reveal>
        <Reveal className="mt-6" delay={0.05}>
          <div id="download" className="scroll-mt-24">
            <DownloadApp />
          </div>
        </Reveal>
      </div>
    </section>
  )
}

const columns: { title: string; links: { label: string; to: string; external?: boolean }[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'How it works', to: '/#product' },
      { label: 'For businesses', to: '/#businesses' },
      { label: 'For developers', to: '/#developers' },
      { label: 'Digital card', to: '/#individuals' },
      { label: 'Pricing', to: '/#pricing' },
    ],
  },
  {
    title: 'Developers',
    links: [
      { label: 'Quick start', to: '/docs/quickstart-developers' },
      { label: 'Webhooks & signatures', to: '/docs/webhooks' },
      { label: 'Sandbox', to: '/docs/sandbox' },
      { label: 'Error codes', to: '/docs/errors' },
      { label: 'REST API reference', to: '/docs/api-reference' },
    ],
  },
  {
    title: 'Businesses',
    links: [
      { label: 'Quick start', to: '/docs/quickstart-businesses' },
      { label: 'Business guide', to: '/docs/business-guide' },
      { label: 'Download the Android app', to: '/docs/mobile-app#download' },
      { label: 'Security', to: '/docs/security' },
    ],
  },
]

export function Footer() {
  const name = useProductName()
  return (
    <footer className="border-t border-border py-14">
      <div className="mx-auto grid w-11/12 gap-10 md:grid-cols-[1.3fr_repeat(3,1fr)]">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-[13.5px] leading-relaxed text-muted">
            NFC detection → card ID → secure delivery. Turn any NFC Android phone into a programmable card reader.
          </p>
        </div>
        {columns.map((c) => (
          <nav key={c.title} aria-label={c.title}>
            <h2 className="text-[12.5px] font-semibold tracking-wider text-subtle uppercase">{c.title}</h2>
            <ul className="mt-3 space-y-2 text-[13.5px]">
              {c.links.map((l) => (
                <li key={l.label}>
                  {l.external ? (
                    <a href={l.to} target="_blank" rel="noreferrer" className="text-muted transition-colors hover:text-fg">
                      {l.label}
                    </a>
                  ) : (
                    <Link to={l.to} className="text-muted transition-colors hover:text-fg">
                      {l.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="mx-auto mt-12 flex w-11/12 flex-wrap items-center justify-between gap-3 border-t border-border pt-6 text-[12.5px] text-subtle">
        <p>
          © {new Date().getFullYear()} {name} ·{' '}
          <a href={POWERED_BY_URL} target="_blank" rel="noopener" className="font-medium text-muted transition-colors hover:text-accent">
            Powered by Nexventures
          </a>
        </p>
        <p>A card UID is an identifier, not proof of identity.</p>
      </div>
    </footer>
  )
}

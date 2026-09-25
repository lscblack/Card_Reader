import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'motion/react'
import { BookOpen, ShieldCheck, Smartphone, Zap } from 'lucide-react'
import { DASHBOARD_PATH, useIsLoggedIn, useReducedMotionPref } from '../lib'
import { PrimaryLink, SecondaryLink } from './MarketingNav'
import { HeroVisual } from './HeroVisual'

export function Hero() {
  const loggedIn = useIsLoggedIn()
  const reduce = useReducedMotionPref()
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const visualY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : 60])
  const glowY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : -80])

  const fade = (delay: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 16 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] as const },
        }

  return (
    <section ref={ref} className="relative overflow-hidden pt-10 pb-16 sm:pt-16 sm:pb-24" aria-labelledby="hero-title">
      {/* Backdrop: soft grid + glow */}
      <motion.div aria-hidden="true" style={{ y: glowY }} className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              'linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
            maskImage: 'radial-gradient(ellipse 70% 60% at 50% 30%, #000 40%, transparent 100%)',
            WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 30%, #000 40%, transparent 100%)',
          }}
        />
        <div
          className="absolute top-[-20%] left-1/2 h-[520px] w-[min(900px,120%)] -translate-x-1/2 rounded-full opacity-25 blur-3xl dark:opacity-40"
          style={{ background: 'radial-gradient(closest-side, color-mix(in oklab, var(--accent-solid) 55%, transparent), transparent)' }}
        />
      </motion.div>

      <div className="mx-auto grid w-11/12 items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-10">
        <div className="min-w-0">
          <motion.p
            {...fade(0)}
            className="inline-flex items-center gap-2 rounded-full border border-border-strong bg-surface/70 px-3 py-1 text-[12.5px] font-medium text-muted backdrop-blur"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
            New: Business accounts, NFC business cards &amp; no-code tap actions
          </motion.p>
          <motion.h1
            id="hero-title"
            {...fade(0.05)}
            className="mt-5 text-[40px] leading-[1.05] font-semibold tracking-tight text-balance text-fg sm:text-6xl"
          >
            Every NFC tap,{' '}
            <span className="bg-gradient-to-r from-accent to-[color-mix(in_oklab,var(--accent)_55%,var(--fg))] bg-clip-text text-transparent">
              delivered
            </span>{' '}
            where it matters.
          </motion.h1>
          <motion.p {...fade(0.12)} className="mt-5 max-w-xl text-[16px] leading-relaxed text-pretty text-muted sm:text-lg">
            Turn any NFC-enabled Android phone into a programmable card reader. Developers get every tap as a signed webhook.
            Businesses get NFC business cards, tags and profiles that do something useful on tap — no code required.
          </motion.p>
          <motion.div {...fade(0.2)} className="mt-8 flex flex-wrap gap-3">
            {loggedIn ? (
              <PrimaryLink to={DASHBOARD_PATH} size="lg">
                Go to dashboard
              </PrimaryLink>
            ) : (
              <PrimaryLink to="/register" size="lg">
                Get started free
              </PrimaryLink>
            )}
            <SecondaryLink to="/docs">
              <BookOpen className="h-4 w-4" aria-hidden="true" /> Read the docs
            </SecondaryLink>
          </motion.div>
          <motion.ul {...fade(0.28)} className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-muted">
            <li className="inline-flex items-center gap-1.5">
              <Smartphone className="h-4 w-4 text-accent" aria-hidden="true" /> No reader hardware to buy
            </li>
            <li className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-accent" aria-hidden="true" /> HMAC-SHA256 signed
            </li>
            <li className="inline-flex items-center gap-1.5">
              <Zap className="h-4 w-4 text-accent" aria-hidden="true" /> Free plan, no credit card
            </li>
          </motion.ul>
        </div>

        <motion.div style={{ y: visualY }} className="mx-auto w-full max-w-[560px] min-w-0">
          <HeroVisual />
        </motion.div>
      </div>
    </section>
  )
}

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useInView, useScroll, useTransform } from 'motion/react'
import { BarChart3, CreditCard, FlaskConical, LayoutDashboard, ListChecks, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useReducedMotionPref } from '../lib'
import type { ScreenName } from '../assets/screens'
import { Reveal, SectionHeading } from './Reveal'
import { Screenshot } from './Screenshot'

const tabs: { id: ScreenName; label: string; icon: LucideIcon; url: string; caption: string }[] = [
  { id: 'dashboard', label: 'Overview', icon: LayoutDashboard, url: '/dashboard', caption: 'Applications, devices, events today and delivery success at a glance.' },
  { id: 'events', label: 'Events', icon: ListChecks, url: '/dashboard/events', caption: 'Every tap with its card ID, device, delivery status and attempts.' },
  { id: 'sandbox', label: 'Sandbox', icon: FlaskConical, url: '/dashboard/sandbox', caption: 'See exactly what was sent, with a signature verdict and checks.' },
  { id: 'analytics', label: 'Analytics', icon: BarChart3, url: '/business/…/analytics', caption: 'Taps, unique visitors and web vs reader taps for businesses.' },
  { id: 'card', label: 'Card detail', icon: CreditCard, url: '/business/…/cards/…', caption: 'Who holds a card, what a tap does, and its tap link.' },
]

const INTERVAL = 5500

/** Browser-framed product screenshots that auto-advance while visible (pauses on hover/focus). */
export function ProductPreview() {
  const reduce = useReducedMotionPref()
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { margin: '-20% 0px -20% 0px' })
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const phoneY = useTransform(scrollYProgress, [0, 1], [60, -60])
  const frameRotate = useTransform(scrollYProgress, [0, 0.45], [8, 0])

  const auto = !reduce && inView && !paused
  useEffect(() => {
    if (!auto) return
    const t = window.setTimeout(() => setI((x) => (x + 1) % tabs.length), INTERVAL)
    return () => window.clearTimeout(t)
  }, [auto, i])

  const tab = tabs[i]

  return (
    <section id="preview" className="relative scroll-mt-20 overflow-hidden py-20 sm:py-28" aria-labelledby="preview-title">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-1/3 -z-10 h-[520px] opacity-40 blur-3xl dark:opacity-50"
        style={{ background: 'radial-gradient(50% 50% at 50% 50%, color-mix(in oklab, var(--accent-solid) 30%, transparent), transparent)' }}
      />
      <div className="mx-auto w-11/12">
        <SectionHeading
          id="preview-title"
          eyebrow="The product"
          title="One dashboard for every reader, card and tap"
          subtitle="Real screens from the app — developers and businesses share the same fast, clean workspace, in light or dark."
        />

        <div
          ref={ref}
          className="relative mx-auto mt-12 max-w-6xl"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          <div role="tablist" aria-label="Product screens" className="mb-5 flex flex-wrap justify-center gap-2">
            {tabs.map((t, k) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`pv-tab-${t.id}`}
                aria-selected={k === i}
                aria-controls="pv-panel"
                onClick={() => setI(k)}
                className={cn(
                  'relative inline-flex items-center gap-1.5 overflow-hidden rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors',
                  k === i ? 'border-accent/60 bg-accent-soft text-accent' : 'border-border bg-surface text-muted hover:text-fg',
                )}
              >
                <t.icon className="h-3.5 w-3.5" aria-hidden="true" />
                {t.label}
                {k === i && auto && (
                  <motion.span
                    key={`p-${i}`}
                    aria-hidden="true"
                    className="absolute bottom-0 left-0 h-0.5 bg-accent"
                    initial={{ width: '0%' }}
                    animate={{ width: '100%' }}
                    transition={{ duration: INTERVAL / 1000, ease: 'linear' }}
                  />
                )}
              </button>
            ))}
          </div>

          <motion.div style={reduce ? undefined : { rotateX: frameRotate, transformPerspective: 1400 }} className="origin-bottom">
            <div className="overflow-hidden rounded-2xl border border-border-strong bg-surface shadow-[0_40px_120px_-50px_rgba(0,0,0,0.55)] ring-1 ring-black/5">
              <div className="flex items-center gap-3 border-b border-border bg-surface-2 px-4 py-2.5">
                <div className="flex gap-1.5" aria-hidden="true">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#ef4444]/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#f59e0b]/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#10b981]/70" />
                </div>
                <div className="mx-auto hidden min-w-0 max-w-md flex-1 truncate rounded-md border border-border bg-bg px-3 py-1 text-center font-mono text-[11.5px] text-subtle sm:block">
                  app{tab.url}
                </div>
              </div>
              <div id="pv-panel" role="tabpanel" aria-labelledby={`pv-tab-${tab.id}`} className="relative aspect-[1280/800] bg-bg">
                <AnimatePresence initial={false}>
                  <motion.div
                    key={tab.id}
                    className="absolute inset-0"
                    initial={reduce ? false : { opacity: 0, scale: 1.015 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={reduce ? undefined : { opacity: 0 }}
                    transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <Screenshot name={tab.id} />
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </motion.div>

          {/* Floating phone with the public profile */}
          <motion.div
            style={reduce ? undefined : { y: phoneY }}
            className="absolute -right-2 -bottom-10 hidden w-[180px] md:block lg:-right-10 lg:w-[210px]"
            aria-hidden="true"
          >
            <div className="rounded-[2rem] border-4 border-border-strong bg-surface-2 p-1 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]">
              <div className="overflow-hidden rounded-[1.6rem]">
                <Screenshot name="profile" />
              </div>
            </div>
          </motion.div>

          <Reveal className="mt-6 text-center text-[14px] text-muted md:pr-48">
            <p aria-live="polite">{tab.caption}</p>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

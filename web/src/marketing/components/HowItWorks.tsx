import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useInView, useScroll, useSpring } from 'motion/react'
import { MousePointerClick, QrCode, Radio, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useReducedMotionPref } from '../lib'
import { SectionHeading } from './Reveal'
import { DecideVisual, PairVisual, WatchVisual } from './StepVisuals'

const steps: { icon: LucideIcon; title: string; body: string; detail: string; Visual: typeof PairVisual }[] = [
  {
    icon: QrCode,
    title: 'Pair a phone in seconds',
    body: 'Install the nexTap app on any NFC Android phone and scan the pairing QR from your dashboard. No API keys typed on a tiny keyboard — the phone only ever keeps its own revocable token.',
    detail: 'Single-use pairing code · expires in 10 minutes',
    Visual: PairVisual,
  },
  {
    icon: MousePointerClick,
    title: 'Decide what a tap does',
    body: 'Developers point taps at their HTTPS endpoint — relayed with server-side retries or sent directly from the phone. Businesses pick a no-code action: a profile, WhatsApp, a menu, Wi-Fi, a contact card and more.',
    detail: 'Signed webhook or no-code action — or both',
    Visual: DecideVisual,
  },
  {
    icon: Radio,
    title: 'Tap and watch it land',
    body: 'Every read shows up live: delivery status, latency and signature verdicts for developers; taps, unique visitors and top cards for businesses.',
    detail: 'Events, request logs and analytics',
    Visual: WatchVisual,
  },
]

/** Sticky storytelling on large screens: the visual stays pinned while the steps scroll past. */
export function HowItWorks() {
  const reduce = useReducedMotionPref()
  const trackRef = useRef<HTMLDivElement>(null)
  const stepRefs = useRef<(HTMLLIElement | null)[]>([])
  const [active, setActive] = useState(0)
  const inView = useInView(trackRef, { margin: '0px 0px -20% 0px' })
  const { scrollYProgress } = useScroll({ target: trackRef, offset: ['start 60%', 'end 60%'] })
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 30, restDelta: 0.001 })

  // The step whose block crosses the middle of the viewport is the active one.
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.step))
        }
      },
      { rootMargin: '-45% 0px -50% 0px' },
    )
    stepRefs.current.forEach((el) => el && obs.observe(el))
    return () => obs.disconnect()
  }, [])

  const ActiveVisual = steps[active].Visual

  return (
    <section id="product" className="scroll-mt-20 py-20 sm:py-28" aria-labelledby="how-title">
      <div className="mx-auto w-11/12">
        <SectionHeading
          id="how-title"
          eyebrow="How it works"
          title="From card tap to action in three steps"
          subtitle="The phone reads the card's ID. The platform delivers it — signed — to your code, or runs the action you chose. What the ID means is up to you."
        />

        <div ref={trackRef} className="relative mt-14 grid gap-10 lg:mt-20 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
          {/* Steps */}
          <div className="relative">
            <div aria-hidden="true" className="absolute top-3 bottom-3 left-[23px] w-px bg-border" />
            <motion.div
              aria-hidden="true"
              className="absolute top-3 bottom-3 left-[23px] w-px origin-top bg-gradient-to-b from-accent to-accent/40"
              style={{ scaleY: reduce ? 1 : progress }}
            />
            <ol className="relative space-y-12 lg:space-y-0">
              {steps.map((s, i) => (
                <li
                  key={s.title}
                  ref={(el) => {
                    stepRefs.current[i] = el
                  }}
                  data-step={i}
                  className="relative flex gap-5 sm:gap-7 lg:min-h-[62vh] lg:items-center"
                >
                  <div className="lg:self-center">
                    <div
                      className={cn(
                        'relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border bg-surface shadow-sm transition-all duration-500',
                        active === i ? 'scale-110 border-accent text-accent shadow-[0_0_0_6px] shadow-accent-solid/10' : 'border-border-strong text-subtle',
                      )}
                    >
                      <s.icon className="h-5 w-5" aria-hidden="true" />
                    </div>
                  </div>
                  <div className={cn('min-w-0 transition-opacity duration-500', active === i ? 'opacity-100' : 'lg:opacity-45')}>
                    <p className="text-[12px] font-semibold tracking-wider text-subtle uppercase">Step {i + 1}</p>
                    <h3 className="mt-1 text-xl font-semibold text-fg sm:text-2xl">{s.title}</h3>
                    <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted">{s.body}</p>
                    <p className="mt-3 inline-flex rounded-md bg-accent-soft px-2 py-1 text-[12px] font-medium text-accent">{s.detail}</p>
                    {/* Inline visual on small screens */}
                    <div className="mt-6 lg:hidden">
                      <s.Visual playing={!reduce && active === i && inView} />
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* Pinned visual on large screens */}
          <div className="hidden lg:block">
            <div className="sticky top-[18vh]">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={active}
                  initial={reduce ? false : { opacity: 0, y: 24, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduce ? undefined : { opacity: 0, y: -16, scale: 0.98 }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                >
                  <ActiveVisual playing={!reduce && inView} />
                </motion.div>
              </AnimatePresence>
              <div className="mt-5 flex justify-center gap-2" aria-hidden="true">
                {steps.map((s, i) => (
                  <span key={s.title} className={cn('h-1.5 rounded-full transition-all duration-500', active === i ? 'w-8 bg-accent' : 'w-1.5 bg-border-strong')} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

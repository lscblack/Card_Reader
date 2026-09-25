import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { AnimatePresence, motion, useInView } from 'motion/react'
import { ArrowRight, Check } from 'lucide-react'
import { receiverSamples } from '@/docs/verifySamples'
import { CodeTabs } from '@/docs/components/Code'
import { cn } from '@/lib/cn'
import { useReducedMotionPref } from '../lib'
import { Reveal, SectionHeading } from './Reveal'

const steps = [
  { title: 'Create an application', body: 'Get an API key and a webhook secret (shown once). New accounts come with a sandbox endpoint.' },
  { title: 'Verify the signature', body: 'HMAC-SHA256 over the raw body, compared in constant time. Copy the snippet for your stack.' },
  { title: 'Handle the event', body: 'Dedupe on the event ID, map the card ID to your data, answer 2xx. Retries are automatic.' },
]

const lines = [
  { t: '→', text: 'POST /api/nfc/card', tone: 'muted' },
  { t: '·', text: 'X-NFC-Event-Id 7f1c2d3e…', tone: 'muted' },
  { t: '·', text: 'X-NFC-Signature v1=5d41…', tone: 'muted' },
  { t: '✓', text: 'signature valid (relay)', tone: 'ok' },
  { t: '✓', text: 'timestamp fresh · nonce unused', tone: 'ok' },
  { t: '←', text: '204 No Content · 38 ms', tone: 'ok' },
]

function Terminal() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { margin: '-10% 0px' })
  const reduce = useReducedMotionPref()
  const [n, setN] = useState(reduce ? lines.length : 0)
  useEffect(() => {
    if (reduce || !inView) return
    const t = window.setInterval(() => setN((x) => (x >= lines.length + 4 ? 0 : x + 1)), 550)
    return () => window.clearInterval(t)
  }, [inView, reduce])
  const shown = reduce ? lines.length : Math.min(n, lines.length)
  return (
    <div ref={ref} className="rounded-xl border border-white/10 bg-code-bg p-4 font-mono text-[12px] leading-6 text-code-fg" aria-label="Example of a verified delivery">
      <p className="mb-1 text-[11px] text-[#8f8888]">your-server.log</p>
      <ul className="min-h-[9rem]">
        <AnimatePresence initial={false}>
          {lines.slice(0, shown).map((l) => (
            <motion.li key={l.text} initial={reduce ? false : { opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <span className={cn('mr-2', l.tone === 'ok' ? 'text-[#86efac]' : 'text-[#8f8888]')}>{l.t}</span>
              <span className={l.tone === 'ok' ? 'text-[#86efac]' : ''}>{l.text}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  )
}

export function Integration() {
  return (
    <section id="integrate" className="relative scroll-mt-20 border-y border-border bg-surface-2/40 py-20 sm:py-28" aria-labelledby="integrate-title">
      <div className="mx-auto grid w-11/12 items-start gap-12 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <SectionHeading
            id="integrate-title"
            center={false}
            eyebrow="Integrate"
            title="From first tap to production in an afternoon"
            subtitle="A small, well-documented surface: one signed POST per tap. Works with any language that can compute an HMAC."
          />
          <ol className="mt-10 space-y-6">
            {steps.map((s, i) => (
              <Reveal as="li" key={s.title} delay={i * 0.08} className="flex gap-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-solid text-[13px] font-bold text-accent-fg">{i + 1}</span>
                <div>
                  <p className="text-[15.5px] font-semibold text-fg">{s.title}</p>
                  <p className="mt-1 text-[14px] leading-relaxed text-muted">{s.body}</p>
                </div>
              </Reveal>
            ))}
          </ol>
          <ul className="mt-8 flex flex-wrap gap-2 text-[12.5px] font-medium text-muted">
            {['Node.js', 'Python', 'PHP', 'Go', 'Ruby', 'Java', '.NET', 'Rust'].map((l) => (
              <li key={l} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1">
                <Check className="h-3 w-3 text-accent" aria-hidden="true" />
                {l}
              </li>
            ))}
          </ul>
          <Link to="/docs/webhooks" className="group mt-8 inline-flex items-center gap-1.5 text-[14px] font-semibold text-accent">
            Webhooks &amp; signatures guide <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        </div>
        <Reveal className="min-w-0 space-y-4" delay={0.1}>
          <CodeTabs samples={receiverSamples} title="verify" className="!my-0 max-h-[430px] overflow-hidden [&_pre]:max-h-[380px] [&_pre]:overflow-auto" />
          <Terminal />
        </Reveal>
      </div>
    </section>
  )
}

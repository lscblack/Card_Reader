import { useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { useReducedMotionPref } from '../lib'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/cn'
import { SectionHeading } from './Reveal'

const faqs: { q: string; a: ReactNode }[] = [
  {
    q: 'Do I need special reader hardware?',
    a: 'No. Any Android phone with NFC (Android 7.0 or newer) runs the free NFC Terminal app and becomes a reader. iPhones can still tap business cards and tags as customers — they just open the tap link in the browser.',
  },
  {
    q: 'Can the phone read cards in the background?',
    a: "Partly. Android only hands NFC tags to apps while the screen is on and unlocked — no app can read with the screen off. With the app closed or in the background, a tap still opens the app, delivers the event and returns you to what you were doing.",
  },
  {
    q: 'Is a card UID enough to identify a person?',
    a: 'No. A UID is an identifier, not proof of identity: many can be read by anyone nearby and cloned. Every event is marked authenticated: false, level: "uid_only". Use it for lookups, attendance, loyalty and business cards — not on its own for payments or high-security access.',
  },
  {
    q: 'What is the difference between relay and direct delivery?',
    a: 'Relay (the default) sends the tap through the platform, which signs it with your webhook secret, logs it and retries server-side. Direct sends it straight from the phone to your endpoint for the lowest latency, signed with a per-device key derived from your secret; the phone retries and reports the outcome for logging.',
  },
  {
    q: 'Do I need to write code for business cards and tags?',
    a: 'No. Pick an action — website, WhatsApp, call, email, maps, social link, menu, product info, Wi-Fi, save contact or a profile page — and write the card once with the app. You can change the action any time without reprogramming the card.',
  },
  {
    q: 'How do I test my webhook without a phone?',
    a: (
      <>
        Use the built-in sandbox endpoint or “Send test event” from the dashboard. The sandbox shows every header and body, checks the
        signature and can reply with any status code, body or delay so you can test retries and timeouts. See the{' '}
        <Link to="/docs/sandbox" className="font-medium text-accent hover:underline">
          sandbox guide
        </Link>
        .
      </>
    ),
  },
  {
    q: 'What do customers need to tap a business card?',
    a: 'Just a phone with NFC turned on. The card holds a short link; tapping opens it in the browser, where the chosen action runs. No app is needed on the customer side.',
  },
]

function Item({ q, a, open, onToggle }: { q: string; a: ReactNode; open: boolean; onToggle: () => void }) {
  const id = useId()
  const reduce = useReducedMotionPref()
  return (
    <li className="border-b border-border">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-a`}
          id={`${id}-q`}
          onClick={onToggle}
          className="flex w-full items-center justify-between gap-4 py-5 text-left text-[15.5px] font-semibold text-fg transition-colors hover:text-accent"
        >
          {q}
          <Plus className={cn('h-5 w-5 shrink-0 text-subtle transition-transform duration-200', open && 'rotate-45 text-accent')} aria-hidden="true" />
        </button>
      </h3>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={`${id}-a`}
            role="region"
            aria-labelledby={`${id}-q`}
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduce ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <p className="pb-5 text-[14.5px] leading-relaxed text-muted">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  )
}

export function Faq() {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <section id="faq" className="scroll-mt-20 py-20 sm:py-28" aria-labelledby="faq-title">
      <div className="mx-auto grid w-11/12 gap-10 lg:grid-cols-[1fr_1.6fr]">
        <SectionHeading
          id="faq-title"
          center={false}
          eyebrow="FAQ"
          title="Questions, answered"
          subtitle={
            <>
              Can't find what you need? The{' '}
              <Link to="/docs" className="font-medium text-accent hover:underline">
                documentation
              </Link>{' '}
              covers every endpoint, header and error code.
            </>
          }
        />
        <ul className="border-t border-border">
          {faqs.map((f, i) => (
            <Item key={f.q} q={f.q} a={f.a} open={open === i} onToggle={() => setOpen(open === i ? null : i)} />
          ))}
        </ul>
      </div>
    </section>
  )
}

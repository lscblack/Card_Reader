import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { AnimatePresence, motion, useInView } from 'motion/react'
import { useReducedMotionPref } from '../lib'
import {
  ArrowRight,
  BarChart3,
  Briefcase,
  CheckCircle2,
  Code2,
  ContactRound,
  Globe,
  MessageCircle,
  Route,
  TestTubeDiagonal,
  TriangleAlert,
  UtensilsCrossed,
  Users,
  Wifi,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { GlowCard } from './GlowCard'
import { SectionHeading } from './Reveal'

export type AudienceTab = 'businesses' | 'developers'

function Bullet({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-[14.5px] font-semibold text-fg">{title}</p>
        <p className="mt-0.5 text-[14px] leading-relaxed text-muted">{children}</p>
      </div>
    </li>
  )
}

function MockFrame({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <GlowCard tilt={3} className={cn('border-border-strong shadow-[0_20px_60px_-34px_rgba(0,0,0,0.45)]', className)}>
      <div className="flex items-center gap-1.5 border-b border-border px-3.5 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-surface-3" />
        <span className="h-2.5 w-2.5 rounded-full bg-surface-3" />
        <span className="h-2.5 w-2.5 rounded-full bg-surface-3" />
        <span className="ml-2 truncate text-[12px] font-medium text-subtle">{title}</span>
      </div>
      <div className="p-4">{children}</div>
    </GlowCard>
  )
}

/** Bars that grow when scrolled into view. */
function GrowBars({ values }: { values: number[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' })
  const reduce = useReducedMotionPref()
  return (
    <div ref={ref} className="mt-3 flex h-14 items-end gap-1" aria-hidden="true">
      {values.map((h, i) => (
        <motion.span
          key={i}
          className="flex-1 origin-bottom rounded-sm bg-gradient-to-t from-accent/60 to-accent"
          style={{ height: `${h + 20}%` }}
          initial={reduce ? false : { scaleY: 0 }}
          animate={reduce || inView ? { scaleY: 1 } : { scaleY: 0 }}
          transition={{ duration: 0.6, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
        />
      ))}
    </div>
  )
}

const actions: { icon: LucideIcon; label: string; hint: string }[] = [
  { icon: Globe, label: 'Website', hint: 'acme.cafe' },
  { icon: MessageCircle, label: 'WhatsApp', hint: '+44 20 7946 0000' },
  { icon: UtensilsCrossed, label: 'Digital menu', hint: 'Lunch menu' },
  { icon: Wifi, label: 'Wi-Fi', hint: 'Acme-Guest' },
  { icon: ContactRound, label: 'Save contact', hint: 'vCard' },
]

const bars = [22, 30, 26, 38, 34, 48, 44, 58, 52, 66, 61, 74]

function BusinessPanel() {
  return (
    <div className="grid items-start gap-10 lg:grid-cols-2">
      <div>
        <h3 className="text-2xl font-semibold tracking-tight text-fg">NFC cards and tags that do something on tap</h3>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          Give every employee a smart business card, stick tags on tables and products, and choose what happens when a customer taps
          with their phone. Change it any time — the card never needs reprogramming.
        </p>
        <ul className="mt-7 space-y-5">
          <Bullet icon={Briefcase} title="No-code tap actions">
            Website, WhatsApp, call, email, maps, social, digital menu, product info, Wi-Fi, save contact (vCard) or a profile page.
          </Bullet>
          <Bullet icon={Users} title="Employee cards & public profiles">
            Assign cards to staff, publish their profile page, and deactivate a leaver's card instantly.
          </Bullet>
          <Bullet icon={BarChart3} title="Analytics that respect privacy">
            Taps, unique visitors, top cards and employees, device types and busiest hours — no raw IPs stored.
          </Bullet>
          <Bullet icon={CheckCircle2} title="Team roles & reader devices">
            Owner, admin, manager and staff roles. Use your own Android phones to recognise cards at the front desk.
          </Bullet>
        </ul>
        <Link to="/docs/quickstart-businesses" className="group mt-8 inline-flex items-center gap-1.5 text-[14px] font-semibold text-accent">
          Business quick start <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </Link>
      </div>

      <div className="relative grid min-w-0 gap-4 sm:grid-cols-[1.1fr_1fr]">
        <MockFrame title="Card · Front desk — Jane" className="sm:row-span-2">
          <p className="text-[12px] font-medium text-subtle">When tapped</p>
          <ul className="mt-2 space-y-1.5">
            {actions.map((a, i) => (
              <li
                key={a.label}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-[13px] transition-colors',
                  i === 1 ? 'border-accent bg-accent-soft' : 'border-border hover:border-border-strong',
                )}
              >
                <a.icon className={cn('h-4 w-4 shrink-0', i === 1 ? 'text-accent' : 'text-subtle')} aria-hidden="true" />
                <span className="font-medium text-fg">{a.label}</span>
                <span className="ml-auto truncate text-[11.5px] text-subtle">{a.hint}</span>
              </li>
            ))}
          </ul>
        </MockFrame>
        <MockFrame title="/b/acme-cafe/jane-doe">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[13px] font-bold text-accent">JD</span>
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold text-fg">Jane Doe</p>
              <p className="truncate text-[12px] text-muted">Sales Manager · Acme Café</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] font-semibold">
            <span className="rounded-md bg-accent-solid py-1.5 text-center text-accent-fg">Save contact</span>
            <span className="rounded-md border border-border-strong py-1.5 text-center text-fg">WhatsApp</span>
          </div>
        </MockFrame>
        <MockFrame title="Analytics · last 30 days">
          <div className="flex items-baseline gap-2">
            <p className="text-2xl font-semibold text-fg tabular-nums">1,284</p>
            <p className="text-[12px] font-medium text-emerald-500">+18%</p>
          </div>
          <p className="text-[12px] text-subtle">taps · 902 unique visitors</p>
          <GrowBars values={bars} />
        </MockFrame>
      </div>
    </div>
  )
}


const sandboxRows: { code: string; tone: 'ok' | 'warn' | 'bad'; sig: string; note: string }[] = [
  { code: '200', tone: 'ok', sig: 'valid', note: 'card.detected · relay' },
  { code: '500', tone: 'bad', sig: 'valid', note: 'simulated failure → retry' },
  { code: 'timeout', tone: 'warn', sig: 'valid', note: 'delay 12 s > timeout' },
  { code: '401', tone: 'bad', sig: 'invalid', note: 'wrong secret' },
]

function FlowLane({ label, hops, note }: { label: string; hops: string[]; note: string }) {
  const reduce = useReducedMotionPref()
  return (
    <div className="rounded-xl border border-border bg-bg p-3">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-semibold text-fg">{label}</p>
        <p className="text-[11px] text-subtle">{note}</p>
      </div>
      <div className="relative mt-3 flex items-center justify-between gap-2">
        <div aria-hidden="true" className="absolute inset-x-6 top-1/2 h-px -translate-y-1/2 border-t border-dashed border-border-strong" />
        {!reduce && (
          <motion.span
            aria-hidden="true"
            className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_10px_var(--accent)]"
            animate={{ left: ['6%', '94%'], opacity: [0, 1, 1, 0] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut', repeatDelay: 0.4 }}
          />
        )}
        {hops.map((h) => (
          <span key={h} className="relative z-10 rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-medium whitespace-nowrap text-muted">
            {h}
          </span>
        ))}
      </div>
    </div>
  )
}

function DeliveryFlow() {
  return (
    <div className="space-y-2.5">
      <FlowLane label="Relay" note="server-side retries" hops={['Phone', 'Platform', 'Your API']} />
      <FlowLane label="Direct" note="lowest latency" hops={['Phone', 'Your API']} />
      <p className="pt-1 font-mono text-[11px] leading-relaxed text-subtle">
        X-NFC-Signature: v1=HMAC_SHA256(key, ts.nonce.body)
      </p>
    </div>
  )
}

function DeveloperPanel() {
  const reduce = useReducedMotionPref()
  return (
    <div className="grid items-start gap-10 lg:grid-cols-2">
      <div>
        <h3 className="text-2xl font-semibold tracking-tight text-fg">A card reader API you can trust in production</h3>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          Every tap becomes a <code className="rounded bg-surface-2 px-1 py-0.5 text-[13px] text-fg">card.detected</code> event,
          delivered to your HTTPS endpoint and signed with HMAC-SHA256. Verify it in a few lines, in any language.
        </p>
        <ul className="mt-7 space-y-5">
          <Bullet icon={Route} title="Relay or direct delivery">
            Relay through the platform with server-side retries, or deliver straight from the phone for the lowest latency — signed with a
            per-device derived key.
          </Bullet>
          <Bullet icon={TestTubeDiagonal} title="Sandbox with every status code">
            A hosted test endpoint that shows exactly what was sent, checks the signature, and replies with any status, body or delay.
          </Bullet>
          <Bullet icon={TriangleAlert} title="Errors you can look up">
            Every error carries a stable reference like <span className="font-mono text-fg">NFC-1003</span> and a request ID, documented with a
            fix.
          </Bullet>
          <Bullet icon={Code2} title="A small, documented device API">
            Build your own reader client on four endpoints: register, config, heartbeat, events. Idempotent by design.
          </Bullet>
        </ul>
        <Link to="/docs/quickstart-developers" className="group mt-8 inline-flex items-center gap-1.5 text-[14px] font-semibold text-accent">
          Developer quick start <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </Link>
      </div>

      <div className="min-w-0 space-y-4">
        <MockFrame title="Delivery modes">
          <DeliveryFlow />
        </MockFrame>
        <MockFrame title="Sandbox · sbx_7Qk… · live requests">
          <ul className="divide-y divide-border">
            {sandboxRows.map((r, i) => (
              <motion.li
                key={r.note}
                initial={reduce ? false : { opacity: 0, x: 12 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.15 + i * 0.12, duration: 0.4 }}
                className="flex items-center gap-3 py-2 text-[12.5px]"
              >
                <span
                  className={cn(
                    'w-16 shrink-0 rounded-md px-1.5 py-0.5 text-center font-mono font-semibold',
                    r.tone === 'ok' && 'bg-emerald-500/15 text-emerald-500',
                    r.tone === 'warn' && 'bg-amber-500/15 text-amber-500',
                    r.tone === 'bad' && 'bg-accent-soft text-accent',
                  )}
                >
                  {r.code}
                </span>
                <span className="min-w-0 truncate text-muted">{r.note}</span>
                <span className={cn('ml-auto shrink-0 font-medium', r.sig === 'valid' ? 'text-emerald-500' : 'text-accent')}>
                  sig {r.sig}
                </span>
              </motion.li>
            ))}
          </ul>
        </MockFrame>
      </div>
    </div>
  )
}

const tabs: { id: AudienceTab; label: string }[] = [
  { id: 'businesses', label: 'For businesses' },
  { id: 'developers', label: 'For developers' },
]

export function Audience({ tab, onTab }: { tab: AudienceTab; onTab: (t: AudienceTab) => void }) {
  const reduce = useReducedMotionPref()
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const next = (i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length
    onTab(tabs[next].id)
    refs.current[next]?.focus()
  }

  return (
    <section id="audience" className="relative scroll-mt-20 py-20 sm:py-28" aria-labelledby="audience-title">
      {/* anchors for nav deep links */}
      <span id="businesses" className="absolute -top-20" aria-hidden="true" />
      <span id="developers" className="absolute -top-20" aria-hidden="true" />
      <div className="mx-auto w-11/12">
        <SectionHeading
          id="audience-title"
          eyebrow="Built for both"
          title="No-code for businesses. Real APIs for developers."
          subtitle="Same readers, same cards, same secure pipeline — pick the side you need, or use both."
        />
        <div className="mt-10 flex justify-center">
          <div role="tablist" aria-label="Audience" className="relative inline-flex rounded-xl border border-border bg-surface-2 p-1">
            {tabs.map((t, i) => (
              <button
                key={t.id}
                ref={(el) => {
                  refs.current[i] = el
                }}
                id={`aud-tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                aria-controls="aud-panel"
                tabIndex={tab === t.id ? 0 : -1}
                onClick={() => onTab(t.id)}
                onKeyDown={(e) => onKey(e, i)}
                className={cn(
                  'relative z-10 rounded-lg px-4 py-2 text-[14px] font-semibold transition-colors sm:px-6',
                  tab === t.id ? 'text-fg' : 'text-muted hover:text-fg',
                )}
              >
                {tab === t.id && (
                  <motion.span
                    layoutId="aud-pill"
                    className="absolute inset-0 -z-10 rounded-lg bg-surface shadow-sm ring-1 ring-border-strong"
                    transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 34 }}
                  />
                )}
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div id="aud-panel" role="tabpanel" aria-labelledby={`aud-tab-${tab}`} className="mt-12">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              {tab === 'businesses' ? <BusinessPanel /> : <DeveloperPanel />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  )
}

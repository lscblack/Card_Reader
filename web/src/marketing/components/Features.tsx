import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { animate, motion, useInView } from 'motion/react'
import {
  Activity,
  CalendarClock,
  ContactRound,
  FileSearch,
  Globe,
  KeyRound,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  RefreshCw,
  Share2,
  ShieldCheck,
  Smartphone,
  TestTubeDiagonal,
  UserRound,
  UsersRound,
  UtensilsCrossed,
  Webhook,
  Wifi,
  Package,
  Store,
  Link2,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { useReducedMotionPref } from '../lib'
import { GlowCard } from './GlowCard'
import { Reveal, SectionHeading } from './Reveal'

function useLive(ref: RefObject<HTMLElement | null>) {
  const inView = useInView(ref, { margin: '-10% 0px -10% 0px' })
  const reduce = useReducedMotionPref()
  return { playing: inView && !reduce, reduce }
}

function Tile({ icon: Icon, title, body, className, children }: { icon: LucideIcon; title: string; body: string; className?: string; children?: ReactNode }) {
  return (
    <GlowCard className={cn('flex flex-col', className)} tilt={2}>
      <div className="flex h-full flex-col p-6">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <h3 className="mt-4 text-[16.5px] font-semibold text-fg">{title}</h3>
        <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{body}</p>
        {children && <div className="mt-5 flex-1">{children}</div>}
      </div>
    </GlowCard>
  )
}

/** Big tile visual: a phone with pulsing rings and the card technologies it reads. */
function ReaderArt() {
  const ref = useRef<HTMLDivElement>(null)
  const { playing } = useLive(ref)
  const techs = ['NfcA', 'NfcB', 'NfcF', 'NfcV', 'ISO-DEP', 'MIFARE Classic', 'Ultralight', 'NTAG']
  return (
    <div ref={ref} className="relative flex h-full min-h-[220px] items-center justify-center overflow-hidden rounded-xl border border-border bg-bg">
      {[0, 1, 2].map((k) => (
        <motion.span
          key={k}
          aria-hidden="true"
          className="absolute h-40 w-40 rounded-full border border-accent/40"
          initial={false}
          animate={playing ? { scale: [0.6, 1.9], opacity: [0.7, 0] } : { scale: 1 + k * 0.35, opacity: 0.25 }}
          transition={playing ? { duration: 2.8, repeat: Infinity, delay: k * 0.9, ease: 'easeOut' } : { duration: 0 }}
        />
      ))}
      <div className="relative z-10 flex h-36 w-20 flex-col items-center justify-center gap-1 rounded-[18px] border-2 border-border-strong bg-surface shadow-lg">
        <Smartphone className="h-5 w-5 text-accent" aria-hidden="true" />
        <span className="text-[9px] font-semibold text-muted">Reader</span>
      </div>
      <ul className="absolute inset-x-3 bottom-3 flex flex-wrap justify-center gap-1.5">
        {techs.map((t) => (
          <li key={t} className="rounded-md border border-border bg-surface px-1.5 py-0.5 font-mono text-[10.5px] text-muted">
            {t}
          </li>
        ))}
      </ul>
    </div>
  )
}

const HEX = '0123456789abcdef'
function SignatureArt() {
  const ref = useRef<HTMLDivElement>(null)
  const { playing } = useLive(ref)
  const [sig, setSig] = useState('9f2c6a1be0d44c7f81a3')
  useEffect(() => {
    if (!playing) return
    const t = window.setInterval(() => {
      setSig((s) => s.split('').map((c) => (Math.random() < 0.3 ? HEX[Math.floor(Math.random() * 16)] : c)).join(''))
    }, 140)
    return () => window.clearInterval(t)
  }, [playing])
  return (
    <div ref={ref} className="rounded-xl border border-border bg-code-bg p-3 font-mono text-[11.5px] leading-relaxed text-code-fg">
      <p className="text-[#8f8888]">{'// {timestamp}.{nonce}.{raw_body}'}</p>
      <p className="truncate">
        v1=<span className="text-[#fca5a5]">{sig}</span>…
      </p>
      <p className="mt-1 inline-flex items-center gap-1 text-[#86efac]">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> constant-time match
      </p>
    </div>
  )
}

function SandboxArt() {
  const ref = useRef<HTMLDivElement>(null)
  const { playing } = useLive(ref)
  const codes = ['200', '201', '401', '429', '500', '503', 'timeout']
  const [k, setK] = useState(0)
  useEffect(() => {
    if (!playing) return
    const t = window.setInterval(() => setK((x) => (x + 1) % codes.length), 900)
    return () => window.clearInterval(t)
  }, [playing, codes.length])
  return (
    <div ref={ref} className="flex flex-wrap gap-1.5">
      {codes.map((c, i) => (
        <span
          key={c}
          className={cn(
            'rounded-md border px-2 py-1 font-mono text-[11.5px] font-semibold transition-all duration-300',
            i === k ? 'scale-110 border-accent bg-accent-soft text-accent' : 'border-border text-subtle',
          )}
        >
          {c}
        </span>
      ))}
    </div>
  )
}

const actionIcons: LucideIcon[] = [Globe, Store, UserRound, Link2, ContactRound, MessageCircle, Phone, Mail, MapPin, Share2, UtensilsCrossed, Package, Wifi, Webhook]

function ActionsArt() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' })
  const reduce = useReducedMotionPref()
  return (
    <div ref={ref} className="grid grid-cols-7 gap-2">
      {actionIcons.map((Icon, i) => (
        <motion.span
          key={i}
          className="flex aspect-square items-center justify-center rounded-lg border border-border bg-bg text-muted transition-colors hover:border-accent/50 hover:text-accent"
          initial={reduce ? false : { opacity: 0, scale: 0.6 }}
          animate={reduce || inView ? { opacity: 1, scale: 1 } : undefined}
          transition={{ delay: i * 0.04, type: 'spring', stiffness: 380, damping: 22 }}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </motion.span>
      ))}
    </div>
  )
}

function RetryArt() {
  const steps = ['now', '10 s', '60 s', '300 s']
  const ref = useRef<HTMLDivElement>(null)
  const { playing } = useLive(ref)
  return (
    <div ref={ref} className="relative pt-2">
      <div className="absolute top-[18px] right-3 left-3 h-px bg-border-strong" aria-hidden="true" />
      {playing && (
        <motion.div
          aria-hidden="true"
          className="absolute top-[18px] left-3 h-px bg-accent"
          animate={{ width: ['0%', '94%'] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut', repeatDelay: 0.6 }}
        />
      )}
      <ol className="relative flex justify-between">
        {steps.map((s, i) => (
          <li key={s} className="flex flex-col items-center gap-1.5">
            <span className={cn('h-5 w-5 rounded-full border-2 bg-surface', i === 3 ? 'border-emerald-500' : 'border-accent')} />
            <span className="font-mono text-[11px] text-subtle">{s}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-[12px] text-subtle">Phone: 5 s · 30 s · 2 min · every 10 min, queued while offline</p>
    </div>
  )
}

function LogsArt() {
  const rows = [
    ['200', 'POST /device/events', '184 ms', ''],
    ['401', 'POST /device/register', '12 ms', 'NFC-1003'],
    ['—', 'delivery attempt #2', 'timeout', 'NFC-5001'],
  ]
  return (
    <ul className="space-y-1.5 font-mono text-[11px]">
      {rows.map(([c, r, t, ref]) => (
        <li key={r} className="flex items-center gap-2 rounded-md border border-border bg-bg px-2 py-1.5">
          <span className={cn('w-8 shrink-0 font-semibold', c === '200' ? 'text-emerald-500' : 'text-accent')}>{c}</span>
          <span className="min-w-0 flex-1 truncate text-muted">{r}</span>
          {ref ? <span className="shrink-0 rounded bg-accent-soft px-1 text-accent">{ref}</span> : <span className="shrink-0 text-subtle">{t}</span>}
        </li>
      ))}
    </ul>
  )
}

function TeamArt() {
  const roles = [
    ['OW', 'Owner'],
    ['AD', 'Admin'],
    ['MA', 'Manager'],
    ['ST', 'Staff'],
  ]
  return (
    <div className="flex items-start gap-3">
      {roles.map(([i, r]) => (
        <div key={r} className="flex flex-col items-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-surface bg-surface-3 text-[11px] font-bold text-fg">{i}</span>
          <span className="mt-1 text-[10.5px] text-subtle">{r}</span>
        </div>
      ))}
    </div>
  )
}

function SparkArt() {
  const ref = useRef<SVGSVGElement>(null)
  const inView = useInView(ref, { once: true })
  const reduce = useReducedMotionPref()
  const d = 'M0 44 L20 38 L40 40 L60 30 L80 33 L100 22 L120 26 L140 14 L160 18 L180 6 L200 10'
  return (
    <svg ref={ref} viewBox="0 0 200 50" className="h-14 w-full" aria-hidden="true">
      <motion.path
        d={d}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? false : { pathLength: 0 }}
        animate={reduce || inView ? { pathLength: 1 } : undefined}
        transition={{ duration: 1.4, ease: 'easeInOut' }}
      />
      <path d={`${d} L200 50 L0 50 Z`} fill="var(--accent)" opacity="0.08" />
    </svg>
  )
}

export function Features() {
  return (
    <section className="py-20 sm:py-28" aria-labelledby="features-title">
      <div className="mx-auto w-11/12">
        <SectionHeading
          id="features-title"
          eyebrow="Everything included"
          title="The boring parts, done properly"
          subtitle="Pairing, signing, retries, logging and permissions are built in — so you can focus on what a tap means."
        />
        <div className="mt-14 grid auto-rows-auto gap-4 md:grid-cols-6">
          <Reveal className="md:col-span-4 md:row-span-2">
            <Tile
              className="h-full"
              icon={Smartphone}
              title="Any NFC Android phone is a reader"
              body="Android 7+ phones read the UID of NfcA/B/F/V, ISO-DEP and MIFARE cards and tags. No reader hardware, no drivers — pair with a QR code and go."
            >
              <ReaderArt />
            </Tile>
          </Reveal>
          <Reveal className="md:col-span-2" delay={0.05}>
            <Tile className="h-full" icon={ShieldCheck} title="Signed by default" body="HMAC-SHA256 over timestamp, nonce and raw body on every delivery.">
              <SignatureArt />
            </Tile>
          </Reveal>
          <Reveal className="md:col-span-2" delay={0.1}>
            <Tile className="h-full" icon={TestTubeDiagonal} title="Sandbox for every status" body="A hosted receiver that answers with any status, body or delay.">
              <SandboxArt />
            </Tile>
          </Reveal>
          <Reveal className="md:col-span-3">
            <Tile className="h-full" icon={ContactRound} title="14 no-code tap actions" body="Website, WhatsApp, call, email, maps, social, menu, product info, Wi-Fi, vCard, profiles — change them without touching the card.">
              <ActionsArt />
            </Tile>
          </Reveal>
          <Reveal className="md:col-span-3" delay={0.05}>
            <Tile className="h-full" icon={RefreshCw} title="Retries & offline queue" body="Relay retries server-side with backoff; phones queue taps while offline and send them when back.">
              <RetryArt />
            </Tile>
          </Reveal>
          <Reveal className="md:col-span-2">
            <Tile className="h-full" icon={FileSearch} title="Request logs & error refs" body="Every request logged without bodies or secrets, each error with a stable ref.">
              <LogsArt />
            </Tile>
          </Reveal>
          <Reveal className="md:col-span-2" delay={0.05}>
            <Tile className="h-full" icon={UsersRound} title="Teams & permissions" body="Four roles, granular permissions, invitations and an audit trail.">
              <TeamArt />
            </Tile>
          </Reveal>
          <Reveal className="md:col-span-2" delay={0.1}>
            <Tile className="h-full" icon={Activity} title="Live analytics" body="Taps, unique visitors, top cards and busiest hours — no raw IPs stored.">
              <SparkArt />
            </Tile>
          </Reveal>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Reveal>
            <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border-strong px-5 py-4 text-[13.5px] text-muted">
              <KeyRound className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
              Hashed API keys and device tokens, encrypted webhook secrets, one-click rotation and instant revoke.
            </div>
          </Reveal>
          <Reveal delay={0.05}>
            <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border-strong px-5 py-4 text-[13.5px] text-muted">
              <CalendarClock className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
              Single-use pairing codes that expire in 10 minutes and are stored only as a hash.
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

function Counter({ to, suffix = '' }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '0px 0px -15% 0px' })
  const reduce = useReducedMotionPref()
  const [value, setValue] = useState(0)

  useEffect(() => {
    if (!inView || reduce) return
    const controls = animate(0, to, { duration: 1.6, ease: [0.22, 1, 0.36, 1], onUpdate: (v) => setValue(Math.round(v)) })
    return () => controls.stop()
  }, [inView, reduce, to])

  return (
    <span ref={ref} className="tabular-nums">
      {(reduce ? to : value).toLocaleString('en-US')}
      {suffix}
    </span>
  )
}

const stats: { to: number; suffix?: string; label: string; note: string }[] = [
  { to: 14, label: 'no-code tap actions', note: 'website, WhatsApp, menu, Wi-Fi, vCard…' },
  { to: 300, suffix: ' s', label: 'replay window', note: 'older timestamps are rejected' },
  { to: 10, suffix: ' min', label: 'pairing code lifetime', note: 'single use, hashed at rest' },
  { to: 500, label: 'cards per bulk batch', note: 'create a print run in one request' },
]

export function Stats() {
  return (
    <section aria-label="Platform facts" className="relative py-6">
      <div className="mx-auto w-11/12">
        <dl className="grid grid-cols-2 overflow-hidden rounded-3xl border border-border bg-surface lg:grid-cols-4">
          {stats.map((s, i) => (
            <div
              key={s.label}
              className={cn('px-5 py-9 text-center', i % 2 === 1 && 'border-l border-border', i >= 2 && 'border-t border-border lg:border-t-0', i === 2 && 'lg:border-l')}
            >
              <dt className="sr-only">{s.label}</dt>
              <dd className="bg-gradient-to-b from-fg to-[color-mix(in_oklab,var(--fg)_55%,var(--accent))] bg-clip-text text-4xl font-semibold tracking-tight text-transparent sm:text-5xl">
                <Counter to={s.to} suffix={s.suffix} />
              </dd>
              <dd className="mt-2 text-[14px] font-medium text-fg">{s.label}</dd>
              <dd className="mt-1 text-[12.5px] text-subtle">{s.note}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}

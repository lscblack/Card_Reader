import { useEffect, useState } from 'react'
import { Activity, BadgeCheck, QrCode, ShieldCheck, Waypoints } from 'lucide-react'
import { useBranding } from '@/branding/context'
import { cn } from '@/lib/cn'
import { Logo } from '../Logo'

const HIGHLIGHTS = [
  {
    icon: ShieldCheck,
    title: 'Every tap, signed and delivered',
    body: 'Card taps reach your endpoint as HMAC-signed JSON in milliseconds, with retries and a full delivery log.',
    stat: '142 ms',
    statLabel: 'median relay latency',
  },
  {
    icon: QrCode,
    title: 'Pair a phone in seconds',
    body: 'Scan a QR code with nexTap, and any Android phone becomes a card reader. No typing API keys.',
    stat: '< 30 s',
    statLabel: 'from unboxing to first tap',
  },
  {
    icon: BadgeCheck,
    title: 'Smart cards for your team',
    body: 'Give employees NFC cards that open their profile, share contacts or check in, and change it anytime without reprogramming.',
    stat: '14',
    statLabel: 'no-code tap actions',
  },
  {
    icon: Activity,
    title: 'See everything, debug fast',
    body: 'Request logs, a hosted sandbox with signature checks, and error references that tell you exactly what to fix.',
    stat: '100%',
    statLabel: 'of requests traceable',
  },
]

const PATH_A = 'M150 118 C 205 70, 250 70, 300 86'
const PATH_B = 'M150 138 C 205 190, 250 196, 300 186'

/** Animated SVG: a card taps a phone, the event travels to an endpoint and a profile. */
function TapScene({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 420 250" className={className} role="img" aria-label="An NFC card taps a phone; the event is delivered to your endpoint and opens a profile.">
      <defs>
        <linearGradient id="av-phone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.14)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.04)" />
        </linearGradient>
        <linearGradient id="av-card" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="color-mix(in srgb, var(--accent-solid) 85%, white)" />
          <stop offset="100%" stopColor="var(--accent-solid)" />
        </linearGradient>
      </defs>

      {/* connection paths */}
      <path d={PATH_A} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.5" className="auth-dash" />
      <path d={PATH_B} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.5" className="auth-dash" />

      {/* phone */}
      <g>
        <rect x="62" y="48" width="88" height="160" rx="16" fill="url(#av-phone)" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
        <rect x="70" y="62" width="72" height="132" rx="9" fill="rgba(0,0,0,0.35)" />
        <rect x="96" y="54" width="20" height="3" rx="1.5" fill="rgba(255,255,255,0.35)" />
        {/* reader UI */}
        <rect x="78" y="74" width="40" height="6" rx="3" fill="rgba(255,255,255,0.35)" />
        <rect x="78" y="86" width="56" height="4" rx="2" fill="rgba(255,255,255,0.16)" />
        <g className="auth-screen-flash">
          <rect x="76" y="104" width="60" height="44" rx="7" fill="color-mix(in srgb, var(--accent-solid) 40%, transparent)" stroke="rgba(255,255,255,0.35)" />
          <path d="M96 126 l6 6 l12 -13" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <rect x="78" y="160" width="56" height="4" rx="2" fill="rgba(255,255,255,0.16)" />
        <rect x="78" y="170" width="38" height="4" rx="2" fill="rgba(255,255,255,0.12)" />
      </g>

      {/* NFC waves */}
      <g fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
        <path className="auth-wave" d="M40 112 q -8 16 0 32" />
        <path className="auth-wave w2" d="M30 104 q -13 24 0 48" />
        <path className="auth-wave w3" d="M20 96 q -18 32 0 64" />
      </g>

      {/* card */}
      <g className="auth-card">
        <rect x="-8" y="92" width="72" height="46" rx="7" fill="url(#av-card)" stroke="rgba(255,255,255,0.4)" />
        <rect x="2" y="102" width="12" height="9" rx="2" fill="rgba(255,255,255,0.75)" />
        <rect x="2" y="122" width="34" height="4" rx="2" fill="rgba(255,255,255,0.6)" />
        <path d="M46 104 q 4 5 0 10 M51 101 q 7 8 0 16" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      </g>

      {/* travelling events */}
      <circle r="5" fill="#fff" className="auth-packet" style={{ offsetPath: `path('${PATH_A}')` }} />
      <circle r="5" fill="#fff" className="auth-packet p2" style={{ offsetPath: `path('${PATH_B}')` }} />

      {/* endpoint node */}
      <g>
        <rect x="300" y="58" width="104" height="56" rx="10" fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.3)" />
        <text x="312" y="80" fill="rgba(255,255,255,0.65)" fontSize="9.5" fontFamily="var(--font-code)">POST /nfc/card</text>
        <text x="312" y="99" fill="#fff" fontSize="11" fontWeight="600" fontFamily="var(--font-body)">
          Your endpoint
        </text>
        <g className="auth-pop">
          <circle cx="392" cy="60" r="10" fill="#10b981" />
          <text x="392" y="64" fill="#fff" fontSize="10" fontWeight="700" textAnchor="middle" fontFamily="var(--font-body)">
            200
          </text>
        </g>
      </g>

      {/* profile node */}
      <g>
        <rect x="300" y="158" width="104" height="56" rx="10" fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.3)" />
        <circle cx="320" cy="186" r="10" fill="rgba(255,255,255,0.18)" />
        <rect x="336" y="178" width="52" height="6" rx="3" fill="rgba(255,255,255,0.55)" />
        <rect x="336" y="190" width="36" height="4" rx="2" fill="rgba(255,255,255,0.25)" />
        <g className="auth-pop late">
          <circle cx="392" cy="160" r="10" fill="var(--accent-solid)" stroke="#fff" strokeWidth="1.5" />
          <path d="M387 160 l3.5 3.5 l6 -7" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </g>
    </svg>
  )
}

function EventChip() {
  return (
    <div className="auth-chip inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/35 px-3 py-1.5 text-[11.5px] text-white/85 backdrop-blur">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
      <span className="font-mono">card.detected</span>
      <span className="text-white/40">·</span>
      <span className="font-mono">04A1…C3D4</span>
      <span className="rounded bg-amber-400/15 px-1 font-medium text-amber-200">UID only</span>
      <span className="text-white/40">·</span>
      <span>142 ms</span>
    </div>
  )
}

function useRotating(count: number, ms: number): [number, (i: number) => void] {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = setInterval(() => setI((x) => (x + 1) % count), ms)
    return () => clearInterval(t)
  }, [count, ms, i])
  return [i, setI]
}

/** Large visual panel for the auth pages (desktop). */
export function AuthVisualPanel() {
  const { branding } = useBranding()
  const [active, setActive] = useRotating(HIGHLIGHTS.length, 5500)
  const h = HIGHLIGHTS[active]
  return (
    <div className="auth-panel flex h-full flex-col justify-between p-10 xl:p-14">
      <div className="auth-grid" aria-hidden="true" />
      <div className="flex items-center justify-between">
        <span className="text-white">
          <Logo surface="dark" />
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11.5px] text-white/75">
          <Waypoints className="h-3.5 w-3.5" /> Tap → event → endpoint
        </span>
      </div>

      <div className="mx-auto w-full max-w-[520px]">
        <TapScene className="h-auto w-full drop-shadow-[0_20px_40px_rgba(0,0,0,0.35)]" />
        <div className="mt-2 flex justify-center">
          <EventChip />
        </div>
      </div>

      <div className="max-w-[520px]">
        <div key={active} className="auth-slide-enter min-h-[132px]" aria-live="polite">
          <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
            <h.icon className="h-4.5 w-4.5" />
          </div>
          <p className="font-display text-2xl font-semibold tracking-tight">{h.title}</p>
          <p className="mt-2 text-[14px] leading-relaxed text-white/70">{h.body}</p>
        </div>
        <div className="mt-6 flex items-end justify-between gap-6">
          <div key={`s-${active}`} className="auth-slide-enter">
            <p className="text-2xl font-semibold tabular-nums">{h.stat}</p>
            <p className="text-xs text-white/55">{h.statLabel}</p>
          </div>
          <div className="flex gap-1.5" role="tablist" aria-label="Highlights">
            {HIGHLIGHTS.map((x, i) => (
              <button
                key={x.title}
                role="tab"
                aria-selected={i === active}
                aria-label={x.title}
                onClick={() => setActive(i)}
                className={cn('h-1.5 rounded-full transition-all duration-500', i === active ? 'w-7 bg-white' : 'w-1.5 bg-white/35 hover:bg-white/60')}
              />
            ))}
          </div>
        </div>
        {branding.tagline && <p className="mt-8 text-xs tracking-wide text-white/40">{branding.tagline}</p>}
      </div>
    </div>
  )
}

/** Compact visual header for small screens. */
export function AuthVisualHeader() {
  return (
    <div className="auth-panel relative flex h-36 items-center justify-center overflow-hidden px-4">
      <div className="auth-grid" aria-hidden="true" />
      <TapScene className="h-32 w-auto max-w-full opacity-95" />
    </div>
  )
}

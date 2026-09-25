import { motion, type Transition } from 'motion/react'
import { useReducedMotionPref } from '../lib'

/**
 * Looping illustration: a card taps a phone, the phone reads the UID and the event flows to a
 * developer endpoint (signed webhook) and to a public business profile. Pure inline SVG + motion.
 */
const DURATION = 5.2

function loop(times: number[]): Transition {
  return { duration: DURATION, times, repeat: Infinity, ease: 'easeInOut' }
}

export function HeroVisual() {
  const reduce = !!useReducedMotionPref()

  // Helper: keyframes when animating, final value when reduced motion is on.
  const kf = <T,>(frames: T[], still: T) => (reduce ? still : frames)
  const tr = (times: number[]) => (reduce ? { duration: 0 } : loop(times))

  return (
    <div className="relative">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 rounded-[2rem] opacity-45 blur-3xl dark:opacity-70"
        style={{ background: 'radial-gradient(60% 50% at 40% 45%, color-mix(in oklab, var(--accent-solid) 35%, transparent), transparent 70%)' }}
      />
      <svg
        viewBox="0 0 480 400"
        className="h-auto w-full"
        role="img"
        aria-label="Illustration: an NFC card taps an Android phone; the card ID is delivered as a signed webhook to your endpoint and can open a business profile."
      >
        <defs>
          <linearGradient id="hv-card" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--accent-solid)" />
            <stop offset="1" stopColor="color-mix(in oklab, var(--accent-solid) 45%, #000)" />
          </linearGradient>
          <linearGradient id="hv-line" x1="0" x2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.1" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0.7" />
          </linearGradient>
        </defs>

        {/* Connectors */}
        <path d="M156 170 H196 V86 H214" fill="none" stroke="url(#hv-line)" strokeWidth="2" strokeDasharray="4 5" />
        <path d="M156 170 H196 V270 H214" fill="none" stroke="url(#hv-line)" strokeWidth="2" strokeDasharray="4 5" />

        {/* Phone */}
        <g>
          <rect x="26" y="36" width="130" height="268" rx="22" fill="var(--surface-2)" stroke="var(--border-strong)" strokeWidth="2" />
          <rect x="36" y="52" width="110" height="236" rx="14" fill="var(--bg)" />
          <rect x="72" y="42" width="38" height="5" rx="2.5" fill="var(--border-strong)" />
          <text x="91" y="78" textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--muted)">
            NFC Terminal
          </text>
          {/* status ring */}
          <circle cx="91" cy="140" r="34" fill="none" stroke="var(--border)" strokeWidth="6" />
          <motion.circle
            cx="91"
            cy="140"
            r="34"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="6"
            strokeLinecap="round"
            pathLength={1}
            style={{ rotate: -90, transformOrigin: '91px 140px' }}
            initial={false}
            animate={{ pathLength: kf([0, 0, 1, 1, 0], 1) }}
            transition={tr([0, 0.22, 0.42, 0.9, 1])}
          />
          <motion.g initial={false} animate={{ opacity: kf([1, 1, 0, 0, 1], 0) }} transition={tr([0, 0.2, 0.28, 0.92, 1])}>
            <text x="91" y="145" textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--fg)">
              Ready
            </text>
          </motion.g>
          <motion.g initial={false} animate={{ opacity: kf([0, 0, 1, 1, 0], 1) }} transition={tr([0, 0.4, 0.46, 0.9, 1])}>
            <path d="M79 140 l8 8 l16 -16" fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          </motion.g>
          <text x="91" y="196" textAnchor="middle" fontSize="10" fill="var(--subtle)">
            Last card
          </text>
          <text x="91" y="212" textAnchor="middle" fontSize="11.5" fontFamily="var(--font-mono)" fill="var(--fg)">
            04A1B2C3D4E5
          </text>
          <rect x="52" y="224" width="78" height="18" rx="9" fill="var(--surface-3)" />
          <text x="91" y="236" textAnchor="middle" fontSize="9" fill="var(--muted)">
            UID only
          </text>
        </g>

        {/* NFC waves */}
        {[0, 1, 2].map((i) => (
          <motion.path
            key={i}
            d={`M${66 - i * 12} ${284 - i * 7} q ${25 + i * 12} ${-12 - i * 5} ${50 + i * 24} 0`}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="3"
            strokeLinecap="round"
            initial={false}
            animate={{ opacity: kf([0, 0, 1, 0, 0], 0.55 - i * 0.12) }}
            transition={tr([0, 0.14 + i * 0.03, 0.24 + i * 0.03, 0.4 + i * 0.03, 1])}
          />
        ))}

        {/* Card */}
        <motion.g
          initial={false}
          animate={{ y: kf([90, 0, 0, 90], 0), rotate: kf([-10, -4, -4, -10], -4), opacity: kf([0, 1, 1, 0], 1) }}
          transition={tr([0, 0.18, 0.78, 0.95])}
          style={{ transformOrigin: '92px 330px' }}
        >
          <rect x="28" y="292" width="128" height="76" rx="10" fill="url(#hv-card)" />
          <rect x="42" y="308" width="22" height="16" rx="3" fill="#fbd38d" opacity="0.85" />
          <path d="M126 312 q6 10 0 20 M134 308 q9 14 0 28" fill="none" stroke="#fff" strokeOpacity="0.8" strokeWidth="2" strokeLinecap="round" />
          <text x="42" y="356" fontSize="10" fontWeight="600" fill="#fff" fillOpacity="0.9">
            ACME · STAFF
          </text>
        </motion.g>

        {/* Flowing dots */}
        {[
          { cx: [156, 196, 196, 214], cy: [170, 170, 86, 86] },
          { cx: [156, 196, 196, 214], cy: [170, 170, 270, 270] },
        ].map((p, i) => (
          <motion.circle
            key={i}
            r="5"
            fill="var(--accent)"
            initial={false}
            animate={
              reduce
                ? { opacity: 0 }
                : { cx: [156, ...p.cx, 214], cy: [170, ...p.cy, p.cy[3]], opacity: [0, 1, 1, 1, 1, 0] }
            }
            transition={reduce ? { duration: 0 } : loop([0, 0.36, 0.42, 0.47, 0.52, 0.56])}
          />
        ))}

        {/* Endpoint panel */}
        <g>
          <rect x="214" y="16" width="252" height="140" rx="14" fill="var(--surface)" stroke="var(--border-strong)" />
          <circle cx="232" cy="36" r="4" fill="var(--border-strong)" />
          <circle cx="245" cy="36" r="4" fill="var(--border-strong)" />
          <circle cx="258" cy="36" r="4" fill="var(--border-strong)" />
          <text x="274" y="40" fontSize="11" fontFamily="var(--font-mono)" fill="var(--muted)">
            POST /api/nfc/card
          </text>
          <text x="230" y="70" fontSize="11" fontFamily="var(--font-mono)" fill="var(--muted)">
            {'"card_id": '}
            <tspan fill="var(--fg)">{'"04A1B2C3D4E5"'}</tspan>
          </text>
          <text x="230" y="88" fontSize="11" fontFamily="var(--font-mono)" fill="var(--muted)">
            {'"level": '}
            <tspan fill="var(--fg)">{'"uid_only"'}</tspan>
          </text>
          <text x="230" y="106" fontSize="11" fontFamily="var(--font-mono)" fill="var(--muted)">
            {'X-NFC-Signature: '}
            <tspan fill="var(--fg)">v1=9f2c…</tspan>
          </text>
          <motion.g initial={false} animate={{ opacity: kf([0, 0, 1, 1, 0], 1) }} transition={tr([0, 0.5, 0.56, 0.9, 1])}>
            <rect x="230" y="120" width="96" height="22" rx="11" fill="color-mix(in oklab, #10b981 18%, transparent)" />
            <text x="278" y="135" textAnchor="middle" fontSize="11" fontWeight="600" fill="#10b981">
              200 OK · 184 ms
            </text>
            <rect x="334" y="120" width="116" height="22" rx="11" fill="var(--accent-soft)" />
            <text x="392" y="135" textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--accent)">
              signature valid
            </text>
          </motion.g>
        </g>

        {/* Profile panel */}
        <g>
          <rect x="214" y="196" width="252" height="150" rx="14" fill="var(--surface)" stroke="var(--border-strong)" />
          <rect x="214" y="196" width="252" height="40" rx="14" fill="var(--accent-soft)" />
          <rect x="214" y="222" width="252" height="14" fill="var(--accent-soft)" />
          <circle cx="248" cy="238" r="20" fill="var(--surface-3)" stroke="var(--surface)" strokeWidth="4" />
          <text x="248" y="243" textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--fg)">
            JD
          </text>
          <text x="276" y="258" fontSize="13" fontWeight="600" fill="var(--fg)">
            Jane Doe
          </text>
          <text x="276" y="274" fontSize="10.5" fill="var(--muted)">
            Sales Manager · Acme Café
          </text>
          <motion.g initial={false} animate={{ opacity: kf([0.35, 0.35, 1, 1, 0.35], 1) }} transition={tr([0, 0.52, 0.6, 0.9, 1])}>
            <rect x="230" y="292" width="104" height="30" rx="8" fill="var(--accent-solid)" />
            <text x="282" y="311" textAnchor="middle" fontSize="11" fontWeight="600" fill="#fff">
              Save contact
            </text>
            <rect x="342" y="292" width="108" height="30" rx="8" fill="var(--surface-2)" stroke="var(--border-strong)" />
            <text x="396" y="311" textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--fg)">
              WhatsApp
            </text>
          </motion.g>
        </g>

        <text x="340" y="176" textAnchor="middle" fontSize="10" fill="var(--subtle)">
          developer webhook · or · no-code action
        </text>
      </svg>
    </div>
  )
}

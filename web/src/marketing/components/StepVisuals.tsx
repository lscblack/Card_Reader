import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Globe, MessageCircle, Radio, UtensilsCrossed, Wifi, ContactRound } from 'lucide-react'
import { cn } from '@/lib/cn'

/** Ticks while `playing`, cycling 0..n-1. Frozen at `still` when not playing. */
function useCycle(n: number, ms: number, playing: boolean, still = 0) {
  const [i, setI] = useState(still)
  useEffect(() => {
    if (!playing) return
    const t = window.setInterval(() => setI((x) => (x + 1) % n), ms)
    return () => window.clearInterval(t)
  }, [n, ms, playing])
  return playing ? i : still
}

function Frame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('relative overflow-hidden rounded-3xl border border-border-strong bg-surface p-5 shadow-[0_30px_80px_-40px_rgba(0,0,0,0.45)] sm:p-7', className)}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full opacity-60 blur-3xl"
        style={{ background: 'radial-gradient(closest-side, color-mix(in oklab, var(--accent-solid) 30%, transparent), transparent)' }}
      />
      <div className="relative">{children}</div>
    </div>
  )
}

// Deterministic QR-looking pattern (decorative).
const QR = Array.from({ length: 121 }, (_, k) => ((k * 7919) % 13) % 3 === 0 || [0, 1, 2, 11, 13, 22, 23, 24].includes(k))

/** Step 1 — scanning the pairing QR from the dashboard. */
export function PairVisual({ playing }: { playing: boolean }) {
  const phase = useCycle(3, 1400, playing, 2) // 0 scanning, 1 pairing, 2 paired
  return (
    <Frame>
      <div className="grid grid-cols-[1fr_auto] items-center gap-5 sm:gap-8">
        <div className="min-w-0 rounded-2xl border border-border bg-bg p-4">
          <p className="text-[12px] font-semibold text-fg">Pair a phone</p>
          <p className="text-[11px] text-subtle">Front desk check-in</p>
          <div className="mt-3 grid aspect-square w-full max-w-[150px] grid-cols-11 gap-[2px] rounded-lg bg-white p-2">
            {QR.map((on, k) => (
              <span key={k} className={on ? 'bg-[#1c1717]' : 'bg-transparent'} />
            ))}
          </div>
          <p className="mt-3 inline-flex items-center gap-1.5 text-[11.5px] font-medium">
            {phase === 2 ? (
              <span className="inline-flex items-center gap-1 text-emerald-500">
                <Check className="h-3.5 w-3.5" aria-hidden="true" /> Paired · Pixel 8
              </span>
            ) : (
              <span className="text-subtle">Waiting for phone… expires in 9:52</span>
            )}
          </p>
        </div>
        <div className="relative h-[210px] w-[112px] rounded-[22px] border-2 border-border-strong bg-surface-2 p-2 sm:h-[240px] sm:w-[128px]">
          <div className="relative h-full overflow-hidden rounded-[14px] bg-[#0c0a0a]">
            <div className="absolute inset-4 rounded-lg border-2 border-white/70" />
            {playing && phase === 0 && (
              <motion.div
                className="absolute inset-x-4 h-0.5 bg-[var(--accent)] shadow-[0_0_12px_var(--accent)]"
                initial={{ top: '18%' }}
                animate={{ top: ['18%', '80%', '18%'] }}
                transition={{ duration: 1.4, ease: 'easeInOut' }}
              />
            )}
            <AnimatePresence>
              {phase === 2 && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0c0a0a]/90 text-center"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
                    <Check className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="px-2 text-[10.5px] font-semibold text-white">Paired</span>
                  <span className="px-2 text-[9.5px] text-white/60">192.168.1.10</span>
                </motion.div>
              )}
            </AnimatePresence>
            {phase === 1 && <p className="absolute inset-x-0 bottom-3 text-center text-[10px] text-white/80">Pair this device?</p>}
          </div>
        </div>
      </div>
    </Frame>
  )
}

const actions = [
  { icon: Globe, label: 'Website' },
  { icon: MessageCircle, label: 'WhatsApp' },
  { icon: UtensilsCrossed, label: 'Menu' },
  { icon: Wifi, label: 'Wi-Fi' },
  { icon: ContactRound, label: 'vCard' },
]

/** Step 2 — endpoint for developers, action picker for businesses. */
export function DecideVisual({ playing }: { playing: boolean }) {
  const sel = useCycle(actions.length, 1100, playing, 1)
  const mode = useCycle(2, 2200, playing, 0)
  return (
    <Frame>
      <div className="space-y-4">
        <div className="rounded-2xl border border-border bg-bg p-4">
          <p className="text-[11px] font-semibold tracking-wider text-subtle uppercase">Developer · endpoint</p>
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[12px] text-fg">
            <span className="text-emerald-500">https://</span>
            <span className="truncate">api.example.com/nfc/card</span>
          </div>
          <div className="mt-3 inline-flex rounded-lg border border-border bg-surface-2 p-0.5 text-[11.5px] font-semibold">
            {['Relay', 'Direct'].map((m, i) => (
              <span key={m} className={cn('relative rounded-md px-3 py-1', mode === i ? 'text-fg' : 'text-subtle')}>
                {mode === i && <motion.span layoutId="step2-mode" className="absolute inset-0 rounded-md bg-surface shadow-sm ring-1 ring-border-strong" />}
                <span className="relative">{m}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-bg p-4">
          <p className="text-[11px] font-semibold tracking-wider text-subtle uppercase">Business · when tapped</p>
          <div className="mt-2 grid grid-cols-5 gap-2">
            {actions.map((a, i) => (
              <div
                key={a.label}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-xl border px-1 py-2.5 text-[10.5px] font-medium transition-all duration-300',
                  sel === i ? 'scale-105 border-accent bg-accent-soft text-accent' : 'border-border text-muted',
                )}
              >
                <a.icon className="h-4 w-4" aria-hidden="true" />
                {a.label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Frame>
  )
}

const feed = [
  { card: '04A1B2C3D4E5', who: 'Front desk Pixel', status: 'Delivered', ms: 184 },
  { card: '04C9D1E27F10', who: 'Dock 3 handheld', status: 'Delivered', ms: 211 },
  { card: 'TAG · Table 12', who: 'Customer phone', status: 'Menu opened', ms: 0 },
  { card: '0477A0B3C6D1', who: 'Front desk Pixel', status: 'Retrying', ms: 0 },
  { card: 'CARD · Jane Doe', who: 'Customer phone', status: 'vCard saved', ms: 0 },
]

/** Step 3 — live feed of events and taps. */
export function WatchVisual({ playing }: { playing: boolean }) {
  const head = useCycle(feed.length, 1300, playing, 0)
  const rows = Array.from({ length: 4 }, (_, k) => ({ ...feed[(head + feed.length - k) % feed.length], key: head - k }))
  return (
    <Frame>
      <div className="flex items-center justify-between">
        <p className="inline-flex items-center gap-2 text-[13px] font-semibold text-fg">
          <Radio className="h-4 w-4 text-accent" aria-hidden="true" /> Live activity
        </p>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-500">
          <span className="relative flex h-2 w-2">
            {playing && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          streaming
        </span>
      </div>
      <ul className="mt-4 space-y-2">
        <AnimatePresence initial={false}>
          {rows.map((r) => (
            <motion.li
              key={r.key}
              layout={playing}
              initial={playing ? { opacity: 0, y: -16 } : false}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35 }}
              className="flex items-center gap-3 rounded-xl border border-border bg-bg px-3 py-2.5"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[12px] text-fg">{r.card}</span>
                <span className="block truncate text-[11px] text-subtle">{r.who}</span>
              </span>
              <span
                className={cn(
                  'shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold',
                  r.status === 'Retrying' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
                )}
              >
                {r.status}
                {r.ms ? ` · ${r.ms} ms` : ''}
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </Frame>
  )
}

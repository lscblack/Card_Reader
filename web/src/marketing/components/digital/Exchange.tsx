import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion, useInView } from 'motion/react'
import { Check, Radio } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useReducedMotionPref } from '../../lib'
import { CardRender } from './CardRender'
import { templates } from './data'

const A = templates[0]
const B = templates[1]

function PhoneShell({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="w-[150px] shrink-0 sm:w-[176px]" aria-label={label}>
      <div className="rounded-[30px] border-[3px] border-border-strong bg-surface-2 p-1.5 shadow-[0_24px_60px_-28px_rgba(0,0,0,0.55)]">
        <div className="relative flex aspect-[9/18] flex-col overflow-hidden rounded-[24px] bg-bg p-2.5 pt-6">
          <span aria-hidden="true" className="absolute top-2 left-1/2 h-1.5 w-10 -translate-x-1/2 rounded-full bg-border-strong" />
          {children}
        </div>
      </div>
    </div>
  )
}

/**
 * Two phones touch; an NFC ripple pulses between them and the cards swap (mutual exchange).
 * Phases: 0 apart · 1 touching + ripple · 2 cards crossing · 3 received. Static final state with reduced motion.
 */
export function PhoneExchange() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { margin: '-15% 0px' })
  const reduce = useReducedMotionPref()
  const playing = inView && !reduce
  const [phase, setPhase] = useState(3)

  useEffect(() => {
    if (!playing) return
    const seq = [0, 1, 2, 3]
    const dur = [1100, 1300, 1000, 2400]
    let i = 0
    let t: number
    const step = () => {
      setPhase(seq[i])
      t = window.setTimeout(() => {
        i = (i + 1) % seq.length
        step()
      }, dur[i])
    }
    step()
    return () => window.clearTimeout(t)
  }, [playing])

  const p = reduce ? 3 : phase
  const close = p === 1 || p === 2
  const received = p === 3

  return (
    <div ref={ref} className="relative mx-auto flex max-w-md items-center justify-center py-6" role="img" aria-label="Two phones touch and exchange digital cards: each person receives the other's card.">
      <motion.div animate={{ x: close ? 14 : 0, rotate: close ? 4 : 0 }} transition={{ type: 'spring', stiffness: 120, damping: 16 }}>
        <PhoneShell label="Amara's phone">
          <p className="mb-2 flex items-center gap-1 text-[9.5px] font-semibold text-muted">
            <Radio className="h-3 w-3 text-accent" aria-hidden="true" /> {received ? 'Card received' : 'Sharing…'}
          </p>
          <div className="relative flex-1">
            <motion.div className="absolute inset-x-0 top-0 mx-auto w-[86%]" animate={{ opacity: received ? 0 : 1, scale: received ? 0.9 : 1 }}>
              <CardRender t={A} label={false} />
            </motion.div>
            <motion.div className="absolute inset-x-0 top-0 mx-auto w-[86%]" initial={false} animate={{ opacity: received ? 1 : 0, y: received ? 0 : 12 }}>
              <CardRender t={B} label={false} />
            </motion.div>
          </div>
          <span className={cn('mt-2 flex items-center justify-center gap-1 rounded-lg py-1.5 text-[10px] font-semibold transition-colors', received ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-surface-2 text-subtle')}>
            {received && <Check className="h-3 w-3" aria-hidden="true" />}
            {received ? 'Lucas saved' : 'Hold near a phone'}
          </span>
        </PhoneShell>
      </motion.div>

      {/* Ripple + crossing cards */}
      <div className="relative z-10 -mx-2 flex w-10 items-center justify-center sm:w-14" aria-hidden="true">
        {[0, 1, 2].map((k) => (
          <motion.span
            key={k}
            className="absolute h-16 w-16 rounded-full border-2 border-accent"
            initial={false}
            animate={p === 1 && playing ? { scale: [0.3, 1.8], opacity: [0.9, 0] } : { scale: 0.3, opacity: 0 }}
            transition={p === 1 && playing ? { duration: 1.1, repeat: Infinity, delay: k * 0.35, ease: 'easeOut' } : { duration: 0.2 }}
          />
        ))}
        {p === 2 && playing && (
          <>
            <motion.span className="absolute h-7 w-5 rounded-[5px] shadow" style={{ background: A.design.primary }} initial={{ x: -40, y: -10 }} animate={{ x: 40, y: -10 }} transition={{ duration: 0.8, ease: 'easeInOut' }} />
            <motion.span className="absolute h-7 w-5 rounded-[5px] shadow" style={{ background: B.design.primary }} initial={{ x: 40, y: 12 }} animate={{ x: -40, y: 12 }} transition={{ duration: 0.8, ease: 'easeInOut' }} />
          </>
        )}
      </div>

      <motion.div animate={{ x: close ? -14 : 0, rotate: close ? -4 : 0 }} transition={{ type: 'spring', stiffness: 120, damping: 16 }}>
        <PhoneShell label="Lucas's phone">
          <p className="mb-2 flex items-center gap-1 text-[9.5px] font-semibold text-muted">
            <Radio className="h-3 w-3 text-accent" aria-hidden="true" /> {received ? 'Card received' : 'Scanning…'}
          </p>
          <div className="relative flex-1">
            <motion.div className="absolute inset-x-0 top-0 mx-auto w-[86%]" animate={{ opacity: received ? 0 : 1, scale: received ? 0.9 : 1 }}>
              <CardRender t={B} label={false} />
            </motion.div>
            <motion.div className="absolute inset-x-0 top-0 mx-auto w-[86%]" initial={false} animate={{ opacity: received ? 1 : 0, y: received ? 0 : 12 }}>
              <CardRender t={A} label={false} />
            </motion.div>
          </div>
          <span className={cn('mt-2 flex items-center justify-center gap-1 rounded-lg py-1.5 text-[10px] font-semibold transition-colors', received ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-surface-2 text-subtle')}>
            {received && <Check className="h-3 w-3" aria-hidden="true" />}
            {received ? 'Amara saved' : 'Tap to scan'}
          </span>
        </PhoneShell>
      </motion.div>
    </div>
  )
}

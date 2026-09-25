import { useRef, type ElementType, type PointerEvent, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { useReducedMotionPref } from '../lib'

/**
 * Card with a cursor-following accent glow and a subtle 3D tilt on hover (fine pointers only).
 * Updates CSS variables / transforms directly on the element, so hovering never re-renders React.
 */
export function GlowCard({
  children,
  className,
  tilt = 4,
  as: Comp = 'div',
}: {
  children: ReactNode
  className?: string
  /** Max tilt in degrees (0 = off). */
  tilt?: number
  as?: ElementType
}) {
  const ref = useRef<HTMLElement>(null)
  const reduce = useReducedMotionPref()

  const onMove = (e: PointerEvent<HTMLElement>) => {
    const el = ref.current
    if (!el || e.pointerType !== 'mouse') return
    const r = el.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    el.style.setProperty('--mx', `${x}px`)
    el.style.setProperty('--my', `${y}px`)
    if (tilt && !reduce) {
      const rx = ((y / r.height) - 0.5) * -2 * tilt
      const ry = ((x / r.width) - 0.5) * 2 * tilt
      el.style.transform = `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`
    }
  }
  const onLeave = () => {
    const el = ref.current
    if (el) el.style.transform = ''
  }

  return (
    <Comp
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className={cn(
        'group/glow relative overflow-hidden rounded-2xl border border-border bg-surface transition-[transform,border-color,box-shadow] duration-300 ease-out will-change-transform hover:border-border-strong hover:shadow-[0_24px_60px_-36px] hover:shadow-accent-solid/50',
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 opacity-0 transition-opacity duration-300 group-hover/glow:opacity-100"
        style={{
          background:
            'radial-gradient(420px circle at var(--mx, 50%) var(--my, 0%), color-mix(in oklab, var(--accent) 16%, transparent), transparent 45%)',
        }}
      />
      <div className="relative z-10 h-full">{children}</div>
    </Comp>
  )
}

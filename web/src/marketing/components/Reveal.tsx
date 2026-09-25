import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { useReducedMotionPref } from '../lib'

/** Fades/slides children in once when they scroll into view. Static when reduced motion is requested. */
export function Reveal({
  children,
  delay = 0,
  y = 18,
  className,
  as = 'div',
}: {
  children: ReactNode
  delay?: number
  y?: number
  className?: string
  as?: 'div' | 'li' | 'section'
}) {
  const reduce = useReducedMotionPref()
  const Comp = as === 'li' ? motion.li : as === 'section' ? motion.section : motion.div
  if (reduce) {
    const Static = as
    return <Static className={className}>{children}</Static>
  }
  return (
    <Comp
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </Comp>
  )
}

export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  center = true,
  id,
}: {
  eyebrow?: string
  title: ReactNode
  subtitle?: ReactNode
  center?: boolean
  id?: string
}) {
  return (
    <Reveal className={center ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'}>
      {eyebrow && <p className="text-[13px] font-semibold tracking-wider text-accent uppercase">{eyebrow}</p>}
      <h2 id={id} className="mt-2 text-[28px] leading-tight font-semibold tracking-tight text-balance text-fg sm:text-4xl">
        {title}
      </h2>
      {subtitle && <p className="mt-4 text-[15px] leading-relaxed text-pretty text-muted sm:text-base">{subtitle}</p>}
    </Reveal>
  )
}

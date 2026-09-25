import { useCallback, useEffect, useRef, useState } from 'react'
import { useInView } from 'motion/react'
import { Building2, ChevronLeft, ChevronRight, Eye, EyeOff, Lock, Share2, UserPlus, Users } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useReducedMotionPref } from '../../lib'
import { CardRender } from './CardRender'
import { templates, type CardTemplate } from './data'

/** Horizontally scrolling template gallery; auto-advances while visible (pauses on hover/focus). */
export function TemplatesCarousel() {
  const scroller = useRef<HTMLDivElement>(null)
  const inView = useInView(scroller, { margin: '-10% 0px' })
  const reduce = useReducedMotionPref()
  const [paused, setPaused] = useState(false)

  const step = useCallback((dir: 1 | -1) => {
    const el = scroller.current
    if (!el) return
    const card = el.querySelector<HTMLElement>('[data-slide]')
    const w = (card?.offsetWidth ?? 200) + 16
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4
    if (dir === 1 && atEnd) el.scrollTo({ left: 0, behavior: reduce ? 'auto' : 'smooth' })
    else el.scrollBy({ left: dir * w, behavior: reduce ? 'auto' : 'smooth' })
  }, [reduce])

  useEffect(() => {
    if (!inView || paused || reduce) return
    const t = window.setInterval(() => step(1), 2600)
    return () => window.clearInterval(t)
  }, [inView, paused, reduce, step])

  return (
    <div className="relative" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <div
        ref={scroller}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="list"
        aria-label="Digital card templates"
        tabIndex={0}
      >
        {templates.map((t: CardTemplate) => (
          <div key={t.id} data-slide role="listitem" className={cn('shrink-0 snap-start', t.layout === 'compact' ? 'w-[260px]' : 'w-[170px] sm:w-[190px]')}>
            <div className="transition-transform duration-300 hover:-translate-y-1">
              <CardRender t={t} />
            </div>
            <p className="mt-2 text-center text-[12.5px] font-medium text-muted">
              {t.name} <span className="text-subtle">· {t.layout.replace('_', ' ')}</span>
            </p>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-center gap-2">
        <button type="button" onClick={() => step(-1)} aria-label="Previous templates" className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-muted hover:text-fg">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => step(1)} aria-label="Next templates" className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-muted hover:text-fg">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

/** iPhone (no app) opening the public card page served over NFC as an NDEF link. */
export function IphoneWebPage() {
  const t = templates[0]
  const d = t.design
  return (
    <div className="mx-auto w-[210px]" role="img" aria-label="An iPhone without the app shows the public card page in Safari with Save contact and Share your details back buttons.">
      <div className="rounded-[34px] border-[3px] border-border-strong bg-surface-2 p-1.5 shadow-lg">
        <div className="overflow-hidden rounded-[28px] bg-white text-[#1c1717]">
          <div className="flex justify-center pt-2" aria-hidden="true">
            <span className="h-4 w-16 rounded-full bg-black" />
          </div>
          <div className="mx-2 mt-2 truncate rounded-lg bg-[#f1f1f3] px-2 py-1 text-center font-mono text-[9px] text-[#57524f]">…/p/amara-okafor?via=nfc</div>
          <div className="flex flex-col items-center px-3 pt-4 pb-4 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full text-[15px] font-bold text-white" style={{ background: d.primary }}>
              {t.person.initials}
            </span>
            <p className="mt-2 text-[13px] font-bold">{t.person.name}</p>
            <p className="text-[10px] text-[#57524f]">
              {t.person.title} · {t.person.company}
            </p>
            <span className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-[10.5px] font-semibold text-white" style={{ background: d.primary }}>
              <UserPlus className="h-3 w-3" aria-hidden="true" /> Save contact
            </span>
            <span className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-lg border border-[#e7e2e2] py-1.5 text-[10.5px] font-semibold">
              <Share2 className="h-3 w-3" aria-hidden="true" /> Share your details back
            </span>
            <p className="mt-3 text-[8.5px] text-[#8f8888]">Get your own digital card · Powered by Nexventures</p>
          </div>
        </div>
      </div>
    </div>
  )
}

const fields: { name: string; vis: 'public' | 'contacts' | 'hidden'; value: string }[] = [
  { name: 'Name & photo', vis: 'public', value: 'Amara Okafor' },
  { name: 'Job title & company', vis: 'public', value: 'Product Designer · Studio North' },
  { name: 'Socials & website', vis: 'public', value: 'studionorth.example' },
  { name: 'Phone', vis: 'contacts', value: '+44 7700 900123' },
  { name: 'Email', vis: 'contacts', value: 'amara@studionorth.example' },
  { name: 'Address', vis: 'hidden', value: '—' },
]

const visStyle = {
  public: { icon: Eye, label: 'Public', cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  contacts: { icon: Users, label: 'Contacts', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  hidden: { icon: EyeOff, label: 'Hidden', cls: 'bg-surface-3 text-subtle' },
}

/** Per-field visibility: who sees what. */
export function PrivacyPanel() {
  return (
    <ul className="space-y-2" aria-label="Field visibility example">
      {fields.map((f) => {
        const v = visStyle[f.vis]
        return (
          <li key={f.name} className="flex items-center gap-3 rounded-xl border border-border bg-bg px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-medium text-fg">{f.name}</span>
              <span className={cn('block truncate text-[11px]', f.vis === 'hidden' ? 'text-subtle' : 'text-muted')}>{f.value}</span>
            </span>
            <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', v.cls)}>
              <v.icon className="h-3 w-3" aria-hidden="true" /> {v.label}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** A business-issued employee card with company branding and locked fields. */
export function BusinessIssuedCard() {
  const t: CardTemplate = {
    ...templates[2],
    person: { name: 'Jane Doe', initials: 'JD', title: 'Sales Manager', company: 'Acme Café' },
    design: { ...templates[2].design, primary: '#b91c1c', accent: '#b91c1c', background: '#fff7f7', text: '#1c1717' },
  }
  return (
    <div className="mx-auto max-w-[220px]">
      <div className="relative">
        <CardRender t={t} />
        <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-[#1c1717] shadow">
          <Building2 className="h-3 w-3" aria-hidden="true" /> Issued by Acme Café
        </span>
      </div>
      <ul className="mt-3 space-y-1 text-[12px] text-muted">
        {['Company & job title', 'Template & colours'].map((x) => (
          <li key={x} className="flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5 text-accent" aria-hidden="true" /> {x} locked by the business
          </li>
        ))}
      </ul>
    </div>
  )
}

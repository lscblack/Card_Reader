import type { CSSProperties } from 'react'
import { AtSign, Globe, Mail, Phone, QrCode, UserPlus } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { CardDesign, CardPerson, CardTemplate } from './data'

/*
 * Illustrative renderer for Part 4 digital-card templates (marketing + docs). Follows the contract's layout
 * semantics (centered, left, split, hero_photo, banner, compact) with a simplified design object.
 */

const fontFamily: Record<CardDesign['font'], string> = {
  sans: 'var(--font-body, ui-sans-serif, system-ui)',
  serif: 'ui-serif, Georgia, "Times New Roman", serif',
  mono: 'var(--font-code, ui-monospace, monospace)',
  display: 'var(--font-heading-family, var(--font-body, ui-sans-serif))',
}

function surface(d: CardDesign): CSSProperties {
  switch (d.background_style) {
    case 'gradient':
      return { background: `linear-gradient(145deg, ${d.primary}, ${d.background})` }
    case 'glass':
      return { background: `radial-gradient(120% 80% at 0% 0%, ${d.primary}66, transparent 60%), ${d.background}` }
    case 'pattern':
      return {
        backgroundColor: d.background,
        backgroundImage: `radial-gradient(${d.primary}40 1px, transparent 1.4px)`,
        backgroundSize: '10px 10px',
      }
    default:
      return { background: d.background }
  }
}

function Avatar({ p, d, size, ring }: { p: CardPerson; d: CardDesign; size: number; ring?: string }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-bold"
      style={{ width: size, height: size, background: d.primary, color: '#fff', fontSize: size * 0.34, boxShadow: ring ? `0 0 0 3px ${ring}` : undefined }}
      aria-hidden="true"
    >
      {p.initials}
    </span>
  )
}

function Actions({ d, compact }: { d: CardDesign; compact?: boolean }) {
  const icons = [Phone, Mail, Globe, AtSign]
  return (
    <div className={cn('flex justify-center', compact ? 'gap-1' : 'gap-1.5')} aria-hidden="true">
      {icons.map((I, i) => (
        <span key={i} className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: `${d.accent}22`, color: d.accent }}>
          <I className="h-3 w-3" />
        </span>
      ))}
    </div>
  )
}

function Lines({ d, n = 2 }: { d: CardDesign; n?: number }) {
  return (
    <div className="space-y-1" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="block h-1.5 rounded-full" style={{ background: `${d.text}22`, width: `${80 - i * 18}%` }} />
      ))}
    </div>
  )
}

/** Renders one template at card size (fills its container width). */
export function CardRender({ t, className, label = true }: { t: CardTemplate; className?: string; label?: boolean }) {
  const { design: d, person: p, layout } = t
  const base: CSSProperties = { ...surface(d), color: d.text, fontFamily: fontFamily[d.font], borderRadius: d.corner_radius }
  const aria = label ? `${t.name} template: digital card for ${p.name}, ${p.title} at ${p.company}` : undefined
  const common = cn('relative overflow-hidden shadow-[0_18px_40px_-24px_rgba(0,0,0,0.55)] ring-1 ring-black/10', className)

  if (layout === 'compact') {
    return (
      <div role={label ? 'img' : undefined} aria-label={aria} className={cn(common, 'aspect-[1.75/1] p-4')} style={base}>
        <div className="flex h-full items-stretch justify-between gap-3">
          <div className="flex min-w-0 flex-col justify-between">
            <div>
              <p className="truncate text-[15px] font-bold">{p.name}</p>
              <p className="truncate text-[11px] opacity-75">{p.title}</p>
            </div>
            <p className="truncate text-[11px] font-semibold" style={{ color: d.accent }}>
              {p.company}
            </p>
          </div>
          <span className="flex aspect-square h-full max-h-16 items-center justify-center rounded-md bg-white text-[#111]" aria-hidden="true">
            <QrCode className="h-8 w-8" />
          </span>
        </div>
      </div>
    )
  }

  return (
    <div role={label ? 'img' : undefined} aria-label={aria} className={cn(common, 'aspect-[3/4]')} style={base}>
      {layout === 'centered' && (
        <div className="flex h-full flex-col items-center p-4 pt-6 text-center">
          <Avatar p={p} d={d} size={52} ring={`${d.accent}55`} />
          <p className="mt-3 text-[15px] leading-tight font-bold">{p.name}</p>
          <p className="text-[11px] opacity-75">{p.title}</p>
          <p className="text-[11px] font-semibold" style={{ color: d.accent }}>
            {p.company}
          </p>
          <div className="mt-3">
            <Actions d={d} />
          </div>
          <div className="mt-auto w-full">
            <span className="flex items-center justify-center gap-1 rounded-lg py-1.5 text-[10.5px] font-semibold text-white" style={{ background: d.primary }}>
              <UserPlus className="h-3 w-3" aria-hidden="true" /> Save contact
            </span>
          </div>
        </div>
      )}
      {layout === 'left' && (
        <div className="flex h-full flex-col p-4 pt-5">
          <div className="flex items-center gap-3">
            <Avatar p={p} d={d} size={44} />
            <div className="min-w-0">
              <p className="truncate text-[14px] font-bold">{p.name}</p>
              <p className="truncate text-[10.5px] opacity-75">
                {p.title} · {p.company}
              </p>
            </div>
          </div>
          <div className="my-3 h-px" style={{ background: `${d.text}22` }} />
          <Lines d={d} n={3} />
          <div className="mt-auto flex justify-start">
            <Actions d={d} compact />
          </div>
        </div>
      )}
      {layout === 'split' && (
        <div className="flex h-full flex-col">
          <div className="flex flex-col items-center px-4 pt-5 pb-4 text-center text-white" style={{ background: d.primary }}>
            <Avatar p={p} d={{ ...d, primary: '#ffffff33' }} size={46} />
            <p className="mt-2 text-[14px] font-bold">{p.name}</p>
            <p className="text-[10.5px] opacity-85">{p.title}</p>
          </div>
          <div className="flex flex-1 flex-col gap-2 p-4">
            <p className="text-[11px] font-semibold" style={{ color: d.accent }}>
              {p.company}
            </p>
            <Lines d={d} n={3} />
            <div className="mt-auto">
              <Actions d={d} compact />
            </div>
          </div>
        </div>
      )}
      {layout === 'hero_photo' && (
        <div className="flex h-full flex-col">
          <div className="relative h-[52%]" style={{ background: `linear-gradient(160deg, ${d.accent}, ${d.primary})` }}>
            <div className="absolute inset-0" style={{ background: `linear-gradient(to top, ${d.background}, transparent 65%)` }} />
            <div className="absolute inset-x-4 bottom-3">
              <p className="text-[16px] leading-tight font-bold">{p.name}</p>
              <p className="text-[10.5px] opacity-80">{p.title}</p>
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-2 p-4 pt-2">
            <p className="text-[11px] font-semibold" style={{ color: d.accent }}>
              {p.company}
            </p>
            <Lines d={d} />
            <div className="mt-auto">
              <Actions d={d} compact />
            </div>
          </div>
        </div>
      )}
      {layout === 'banner' && (
        <div className="flex h-full flex-col">
          <div className="h-[30%]" style={{ background: `linear-gradient(120deg, ${d.primary}, ${d.accent})` }} />
          <div className="-mt-7 flex flex-1 flex-col items-center px-4 pb-4 text-center">
            <Avatar p={p} d={d} size={52} ring={d.background} />
            <p className="mt-2 text-[14px] leading-tight font-bold">{p.name}</p>
            <p className="text-[10.5px] opacity-75">
              {p.title} · {p.company}
            </p>
            <div className="mt-3">
              <Actions d={d} />
            </div>
            <div className="mt-auto w-full">
              <Lines d={d} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

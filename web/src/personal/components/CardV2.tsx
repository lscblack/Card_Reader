import { useId, useLayoutEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react'
import { Globe, Mail, MapPin, Phone, RotateCw } from 'lucide-react'
import { QrCode } from '@/components/QrCode'
import { cn } from '@/lib/cn'
import type { Arrangement, BlockId, CardTemplateV2, RenderableCard, SideId, TemplateZone, VisibilityKey } from '../api/types'
import { encodeCode128, isCode128Printable } from '../lib/code128'
import { contrast, visibilityOf, withAlpha } from '../lib/design'
import { fontsFor, isExpired, resolveArrangement, resolveColor, sideSize, textOn } from '../lib/v2'
import type { CardAudience } from './cardTypes'

interface Props {
  card: RenderableCard
  template: CardTemplateV2
  audience?: CardAudience
  interactive?: boolean
  qrValue?: string | null
  /** Controlled side; when `onSideChange` is given the card flips on click and shows a flip button. */
  side?: SideId
  onSideChange?: (s: SideId) => void
  /** Editor mode: empty blocks show placeholders; zones can be highlighted. */
  editing?: boolean
  highlightZone?: string | null
  onZoneClick?: (side: SideId, zoneId: string) => void
  className?: string
}

/** Font sizes in template units (landscape/portrait). */
const SIZES = {
  landscape: { name: 86, sub: 41, company: 52, dept: 34, tagline: 38, row: 37, meta: 35, bio: 33 },
  portrait: { name: 82, sub: 44, company: 50, dept: 36, tagline: 40, row: 42, meta: 42, bio: 38 },
}

const u = (n: number) => `calc(var(--u) * ${n})`
const uf = (n: number) => `calc(var(--u) * ${n} * var(--fit, 1))`

const initials = (n: string) => {
  const p = n.trim().split(/\s+/).filter(Boolean)
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? (p[p.length - 1][0] ?? '') : '')).toUpperCase() || '•'
}
const bare = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return null
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}


function Barcode({ value, color, height }: { value: string; color: string; height: string }) {
  const widths = useMemo(() => (isCode128Printable(value) ? encodeCode128(value) : []), [value])
  const total = widths.reduce((a, b) => a + b, 0)
  if (!total) return null
  let x = 0
  const bars: ReactNode[] = []
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push(<rect key={i} x={x} y={0} width={w} height={40} fill={color} />)
    x += w
  })
  return (
    <svg viewBox={`0 0 ${total} 40`} preserveAspectRatio="none" style={{ width: '100%', height }} role="img" aria-label={`Barcode ${value}`}>
      {bars}
    </svg>
  )
}

/** A zone: stacks its blocks and shrinks text (via `--fit`) until the content fits the rect. */
function Zone({ zone, W, H, children, highlight, onClick }: { zone: TemplateZone; W: number; H: number; children: ReactNode; highlight?: boolean; onClick?: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [x, y, w, h] = zone.rect
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      let f = 1
      el.style.setProperty('--fit', '1')
      for (let i = 0; i < 12 && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) && f > 0.5; i++) {
        f *= 0.92
        el.style.setProperty('--fit', f.toFixed(3))
      }
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  })
  const justify = zone.valign === 'start' ? 'flex-start' : zone.valign === 'end' ? 'flex-end' : 'center'
  const items = zone.align === 'start' ? 'flex-start' : zone.align === 'end' ? 'flex-end' : 'center'
  return (
    <div
      ref={ref}
      data-zone={zone.id}
      onClick={onClick}
      className={cn('absolute flex flex-col overflow-hidden', highlight && 'outline-2 outline-offset-2 outline-dashed', onClick && 'cursor-pointer')}
      style={{
        left: `${(x / W) * 100}%`,
        top: `${(y / H) * 100}%`,
        width: `${(w / W) * 100}%`,
        height: `${(h / H) * 100}%`,
        justifyContent: justify,
        alignItems: items,
        textAlign: zone.align === 'end' ? 'right' : zone.align === 'center' ? 'center' : 'left',
        outlineColor: highlight ? 'currentColor' : undefined,
      }}
    >
      {children}
    </div>
  )
}

function Face({ card, template, sideId, audience, qrValue, editing, highlightZone, onZoneClick, arrangement }: { card: RenderableCard; template: CardTemplateV2; sideId: SideId; audience: CardAudience; qrValue?: string | null; editing?: boolean; highlightZone?: string | null; onZoneClick?: Props['onZoneClick']; arrangement: Arrangement }) {
  const uid = useId().replace(/:/g, '')
  const side = template.canvas[sideId]
  const d = card.design
  const f = card.fields
  const [W, H] = sideSize(template.format)
  const S = SIZES[template.format]
  const fonts = fontsFor(d.font)
  const variant = template.variants?.find((v) => v.id === d.decor_style)
  const layers = variant?.canvas[sideId]?.layers ?? side?.layers ?? []
  if (!side) return null
  const bg = resolveColor(side.background, d)
  const shown = (k: VisibilityKey) => (audience === 'all' ? card.visibility?.[k] !== 'hidden' : audience === 'public' ? visibilityOf(card, k) === 'public' : visibilityOf(card, k) !== 'hidden')
  const imgOpacity = (layerOpacity: number) => (d.background_image_opacity && d.background_image_opacity > 0 ? d.background_image_opacity : layerOpacity)

  const zoneBlocks = arrangement[sideId] ?? {}

  const renderBlock = (b: BlockId, zone: TemplateZone, count: number): ReactNode => {
    const on = resolveColor(zone.on === 'image' ? 'secondary' : zone.on, d)
    const fg = textOn(on, d.text)
    const muted = withAlpha(fg, 0.72)
    const accent = contrast(d.accent, on) >= 3 ? d.accent : fg
    const [, , zw, zh] = zone.rect
    const iconStyle = d.icon_style ?? 'filled'
    const icon = (I: typeof Phone) =>
      iconStyle === 'none' ? null : (
        <span
          className="inline-flex shrink-0 items-center justify-center rounded-full"
          style={{
            width: uf(S.row * 1.45),
            height: uf(S.row * 1.45),
            background: iconStyle === 'filled' ? accent : 'transparent',
            border: iconStyle === 'outline' ? `calc(var(--u) * 3) solid ${accent}` : undefined,
            color: iconStyle === 'filled' ? textOn(accent, d.text) : accent,
          }}
        >
          <I style={{ width: uf(S.row * 0.8), height: uf(S.row * 0.8) }} />
        </span>
      )
    const rowStyle: CSSProperties = { fontSize: uf(S.row), gap: uf(S.row * 0.5), lineHeight: 1.25, maxWidth: '100%', flexDirection: zone.align === 'end' ? 'row-reverse' : 'row' }
    const row = ({ icon: I, text, key }: { icon: typeof Phone; text: string; key: string }) => (
      <div key={key} className="flex min-w-0 items-center" style={rowStyle}>
        {icon(I)}
        <span className="min-w-0 truncate" style={{ color: fg }}>
          {text}
        </span>
      </div>
    )
    const ph = (text: string) => (editing ? <span style={{ fontSize: uf(S.row), color: withAlpha(fg, 0.45), fontStyle: 'italic' }}>{text}</span> : null)
    const single = count === 1

    switch (b) {
      case 'photo': {
        if (!shown('photo') && !editing) return null
        const size = Math.min(zw, zh) * (single ? 0.92 : 0.5)
        const shape = d.photo_shape ?? 'circle'
        const clip = shape === 'hexagon' ? 'polygon(50% 0, 93.3% 25%, 93.3% 75%, 50% 100%, 6.7% 75%, 6.7% 25%)' : undefined
        const radius = shape === 'circle' ? '50%' : shape === 'rounded' ? '18%' : shape === 'square' ? '4%' : 0
        const ringW = d.photo_ring ? size * 0.045 : 0
        const phBg = contrast(d.primary, on) >= 1.5 ? d.primary : (d.secondary ?? '#1C1717')
        const inner = card.photo_url ? (
          <img src={card.photo_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center font-semibold" style={{ background: phBg, color: textOn(phBg, d.text), fontSize: uf(size * 0.34), fontFamily: fonts.heading }}>
            {initials(f.full_name || '')}
          </span>
        )
        return (
          <div
            key="photo"
            className="shrink-0"
            style={{ width: uf(size), height: uf(size), padding: ringW ? uf(ringW) : 0, background: ringW ? d.accent : undefined, borderRadius: radius, clipPath: clip }}
          >
            <div className="h-full w-full overflow-hidden" style={{ borderRadius: radius, clipPath: clip, boxShadow: ringW ? `0 0 0 ${u(ringW * 0.35)} ${on}` : undefined }}>
              {inner}
            </div>
          </div>
        )
      }
      case 'name': {
        const sub = [shown('job_title') ? f.job_title : null, !f.job_title && shown('headline') ? f.headline : null].filter(Boolean)[0]
        const long = (f.full_name ?? '').length > 18
        return (
          <div key="name" className="min-w-0 max-w-full">
            <div className="truncate font-bold tracking-tight" style={{ fontSize: uf(S.name * (long ? 0.86 : 1)), lineHeight: 1.08, color: fg, fontFamily: fonts.heading }}>
              {f.full_name || 'Your name'}
            </div>
            {sub && (
              <div className="truncate font-medium" style={{ fontSize: uf(S.sub), marginTop: uf(8), color: accent, letterSpacing: '0.02em' }}>
                {sub}
              </div>
            )}
          </div>
        )
      }
      case 'company': {
        const c = shown('company') ? f.company || card.business?.name : null
        const dept = shown('department') ? f.department : null
        if (!c && !dept) return ph('Company')
        return (
          <div key="company" className="min-w-0 max-w-full">
            {c && (
              <div className="truncate font-bold tracking-wide uppercase" style={{ fontSize: uf(S.company), lineHeight: 1.1, color: fg, fontFamily: fonts.heading }}>
                {c}
              </div>
            )}
            {dept && (
              <div className="truncate" style={{ fontSize: uf(S.dept), marginTop: uf(6), color: muted }}>
                {dept}
              </div>
            )}
          </div>
        )
      }
      case 'logo': {
        const src = card.logo_url ?? card.business?.logo_url
        const h = Math.min(zh * (single ? 0.62 : 0.45), single ? 240 : 150)
        if (src) return <img key="logo" src={src} alt="" className="max-w-full object-contain" style={{ height: uf(h) }} />
        const name = (shown('company') && f.company) || card.business?.name || f.full_name || ''
        if (!name) return ph('Logo')
        const tint = contrast(d.primary, on) >= 2 ? d.primary : fg
        return (
          <span key="logo" className="inline-flex shrink-0 items-center justify-center font-bold" style={{ width: uf(h), height: uf(h), borderRadius: uf(h * 0.24), background: tint, color: textOn(tint, d.text), fontSize: uf(h * 0.46), fontFamily: fonts.heading }}>
            {initials(name).slice(0, 2)}
          </span>
        )
      }
      case 'tagline': {
        const t = shown('headline') ? f.headline : null
        if (!t) return ph('Tagline')
        return (
          <div key="tagline" className="line-clamp-2 max-w-full" style={{ fontSize: uf(S.tagline), color: muted, letterSpacing: '0.04em', lineHeight: 1.3 }}>
            {t}
          </div>
        )
      }
      case 'contacts': {
        const phones = shown('phones') ? (f.phones ?? []).filter((x) => x.value).slice(0, 2) : []
        const emails = shown('emails') ? (f.emails ?? []).filter((x) => x.value).slice(0, 2) : []
        if (!phones.length && !emails.length) return ph((f.phones ?? []).some((x) => x.value) || (f.emails ?? []).some((x) => x.value) ? 'Phone & email · hidden in this view' : 'Phone & email')
        return (
          <div key="contacts" className="flex min-w-0 max-w-full flex-col" style={{ gap: uf(12), alignItems: zone.align === 'end' ? 'flex-end' : zone.align === 'center' ? 'center' : 'flex-start' }}>
            {phones.map((p, i) => row({ icon: Phone, text: p.value, key: `p${i}` }))}
            {emails.map((e, i) => row({ icon: Mail, text: e.value, key: `e${i}` }))}
          </div>
        )
      }
      case 'website': {
        const w = shown('websites') ? (f.websites ?? []).find((x) => x.url) : null
        if (!w) return ph('Website')
        return row({ icon: Globe, text: bare(w.url), key: 'web' })
      }
      case 'address': {
        const a = shown('address') ? f.address : null
        if (!a) return ph('Address')
        return row({ icon: MapPin, text: a, key: 'addr' })
      }
      case 'socials': {
        const s = shown('socials') ? (f.socials ?? []).filter((x) => x.url).slice(0, 5) : []
        if (!s.length) return ph('Social profiles')
        const size = S.row * 1.5
        return (
          <div key="socials" className="flex flex-wrap" style={{ gap: uf(10), justifyContent: zone.align === 'end' ? 'flex-end' : zone.align === 'center' ? 'center' : 'flex-start' }}>
            {s.map((x) => (
              <span
                key={x.url}
                title={x.platform}
                className="inline-flex items-center justify-center rounded-full font-semibold uppercase"
                style={{ width: uf(size), height: uf(size), fontSize: uf(size * 0.42), background: iconStyle === 'filled' ? accent : 'transparent', border: iconStyle !== 'filled' ? `calc(var(--u) * 3) solid ${accent}` : undefined, color: iconStyle === 'filled' ? textOn(accent, d.text) : accent }}
              >
                {x.platform === 'x' ? 'X' : x.platform.slice(0, 2)}
              </span>
            ))}
          </div>
        )
      }
      case 'bio': {
        const t = shown('bio') ? f.bio : null
        if (!t) return ph('Bio')
        return (
          <div key="bio" className="line-clamp-3 max-w-full" style={{ fontSize: uf(S.bio), color: muted, lineHeight: 1.35 }}>
            {t}
          </div>
        )
      }
      case 'qr': {
        if (!qrValue) return ph('QR code')
        const size = Math.min(zw, zh) * (single ? 0.86 : 0.55)
        return (
          <div key="qr" className="shrink-0 bg-white" style={{ width: uf(size), height: uf(size), padding: uf(size * 0.05), borderRadius: uf(size * 0.08) }}>
            <QrCode value={qrValue} size={512} label="QR code for this card" />
          </div>
        )
      }
      case 'barcode': {
        const v = shown('barcode_value') ? f.barcode_value : null
        if (!v || !isCode128Printable(v)) return ph('Barcode')
        const light = contrast('#ffffff', on) < 1.6
        return (
          <div key="barcode" className="flex flex-col items-center" style={{ width: single ? '92%' : '70%', padding: light ? 0 : uf(14), background: light ? undefined : '#ffffff', borderRadius: uf(10) }}>
            <Barcode value={v} color="#111111" height={uf(Math.min(zh * 0.62, 110))} />
            <span className="font-mono tracking-[0.2em]" style={{ fontSize: uf(26), color: '#333333', marginTop: uf(6) }}>
              {v}
            </span>
          </div>
        )
      }
      case 'badge_meta': {
        const rows = [
          shown('id_number') && f.id_number ? ['ID No', f.id_number] : null,
          shown('department') && f.department ? ['Dept', f.department] : null,
          shown('valid_from') && f.valid_from ? ['Issued', fmtDate(f.valid_from)] : null,
          shown('valid_until') && f.valid_until ? ['Valid until', fmtDate(f.valid_until)] : null,
        ].filter(Boolean) as [string, string][]
        if (!rows.length) return ph('ID number & validity')
        return (
          <div key="badge_meta" className="grid w-full" style={{ gridTemplateColumns: 'auto 1fr', columnGap: uf(28), rowGap: uf(10), fontSize: uf(S.meta) }}>
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <span className="font-semibold tracking-wide uppercase" style={{ color: muted, fontSize: uf(S.meta * 0.84), alignSelf: 'center' }}>
                  {k}
                </span>
                <span className="truncate font-medium" style={{ color: fg }}>
                  {v}
                </span>
              </div>
            ))}
          </div>
        )
      }
      default:
        return null
    }
  }

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ background: bg, fontFamily: fonts.body, borderRadius: u(template.format === 'portrait' ? 44 : 50), boxShadow: '0 1px 2px rgba(0,0,0,.14), 0 8px 24px -6px rgba(0,0,0,.18)' }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <pattern id={`pat${uid}`} width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="40" height="40" fill={resolveColor('secondary', d)} />
            <rect width="14" height="40" fill={withAlpha('#ffffff', 0.06)} />
          </pattern>
          {layers.map((l, i) => (l.fill === 'image' ? <clipPath key={i} id={`clip${uid}_${i}`}><path d={l.path} /></clipPath> : null))}
        </defs>
        {layers.map((l, i) =>
          l.fill === 'image' ? (
            card.cover_url ? (
              <image key={i} href={card.cover_url} x={0} y={0} width={W} height={H} preserveAspectRatio="xMidYMid slice" clipPath={`url(#clip${uid}_${i})`} opacity={imgOpacity(l.opacity ?? 1)} />
            ) : (
              <path key={i} d={l.path} fill={`url(#pat${uid})`} opacity={0.9} />
            )
          ) : (
            <path key={i} d={l.path} fill={resolveColor(l.fill, d)} opacity={l.opacity ?? 1} />
          ),
        )}
      </svg>
      {side.zones.map((z) => {
        const blocks = (zoneBlocks[z.id] ?? []).filter((b) => z.accepts.includes(b)).slice(0, z.max_blocks)
        const ROWISH: BlockId[] = ['contacts', 'website', 'address']
        const rendered: ReactNode[] = []
        let prev: BlockId | null = null
        for (const b of blocks) {
          const el = renderBlock(b, z, blocks.length)
          if (!el) continue
          const gap = prev == null ? 0 : ROWISH.includes(prev) && ROWISH.includes(b) ? 14 : Math.min(40, z.rect[3] / 12)
          rendered.push(
            <div key={b} className="flex max-w-full min-w-0 flex-col" style={{ marginTop: uf(gap), alignItems: z.align === 'end' ? 'flex-end' : z.align === 'center' ? 'center' : 'flex-start', width: b === 'badge_meta' || b === 'barcode' ? '100%' : undefined }}>
              {el}
            </div>,
          )
          prev = b
        }
        const on = resolveColor(z.on === 'image' ? 'secondary' : z.on, d)
        const highlight = editing && highlightZone === z.id
        if (!rendered.length && !highlight && !onZoneClick) return null
        return (
          <Zone key={z.id} zone={z} W={W} H={H} highlight={highlight} onClick={onZoneClick ? () => onZoneClick(sideId, z.id) : undefined}>
            <div className="contents" style={{ color: textOn(on, d.text) }}>
              {rendered}
            </div>
          </Zone>
        )
      })}
      {isExpired(f.valid_until) && shown('valid_until') && (
        <div className="pointer-events-none absolute" style={{ top: u(template.format === 'portrait' ? 110 : 80), right: u(-150), width: u(560), transform: 'rotate(38deg)' }}>
          <div className="text-center font-bold tracking-[0.3em] text-white uppercase" style={{ background: '#DC2626', fontSize: u(40), padding: `${u(10)} 0`, boxShadow: '0 2px 6px rgba(0,0,0,.25)' }}>
            Expired
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Generic v2 renderer (Part 5 §1): SVG layers clipped to the rounded card + zones with stacked, auto-fitted blocks.
 * All sizes are template units converted with container-query units, so it's crisp at any size.
 */
export function CardV2({ card, template, audience = 'all', qrValue, side = 'front', onSideChange, editing, highlightZone, onZoneClick, className }: Props) {
  const [W, H] = sideSize(template.format)
  const arrangement = resolveArrangement(template, card.arrangement)
  const hasBack = !!template.canvas.back && template.sides.includes('back') && (card.sides_enabled ?? template.sides).includes('back')
  const current: SideId = hasBack ? side : 'front'
  const flippable = hasBack && !!onSideChange
  const faceProps = { card, template, audience, qrValue, editing, highlightZone, onZoneClick, arrangement }
  return (
    <div className={cn('relative w-full', className)} style={{ containerType: 'inline-size' }}>
      <div
        className={cn('relative w-full [perspective:2000px]', flippable && !onZoneClick && 'cursor-pointer')}
        style={{ aspectRatio: `${W} / ${H}`, ['--u' as string]: `calc(100cqw / ${W})` }}
        onClick={flippable && !onZoneClick ? () => onSideChange!(current === 'front' ? 'back' : 'front') : undefined}
      >
        <div
          className="relative h-full w-full transition-transform duration-700 [transform-style:preserve-3d] motion-reduce:transition-none"
          style={{ transform: current === 'back' ? 'rotateY(180deg)' : undefined }}
        >
          <div className="absolute inset-0 [backface-visibility:hidden]" aria-hidden={current !== 'front'}>
            <Face {...faceProps} sideId="front" />
          </div>
          {hasBack && (
            <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]" aria-hidden={current !== 'back'}>
              <Face {...faceProps} sideId="back" />
            </div>
          )}
        </div>
      </div>
      {flippable && (
        <button
          type="button"
          onClick={() => onSideChange!(current === 'front' ? 'back' : 'front')}
          className="absolute right-2 bottom-2 inline-flex h-8 items-center gap-1.5 rounded-full bg-black/55 px-3 text-xs font-medium text-white backdrop-blur-sm hover:bg-black/70"
          aria-label={current === 'front' ? 'Show back side' : 'Show front side'}
        >
          <RotateCw className="h-3.5 w-3.5" /> {current === 'front' ? 'Back' : 'Front'}
        </button>
      )}
    </div>
  )
}

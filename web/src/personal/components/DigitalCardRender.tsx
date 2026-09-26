import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AtSign, BadgeCheck, Globe, Link2, Mail, MapPin, Phone } from 'lucide-react'
import { QrCode } from '@/components/QrCode'
import { cn } from '@/lib/cn'
import { cssImage, safeHref, safeImageUrl } from '@/lib/url'
import { isV2, type CardLayout, type CardTemplate, type RenderableCard, type SideId, type VisibilityKey } from '../api/types'
import { sideSize } from '../lib/v2'
import { CardV2 } from './CardV2'
import type { CardAudience } from './cardTypes'
import { onColor, surfaceStyle, visibilityOf, withAlpha } from '../lib/design'

export type { CardAudience } from './cardTypes'

interface Props {
  card: RenderableCard
  /** v1 layout (used when no v2 template is given). */
  layout?: CardLayout
  /** The card's template: v2 templates render with the shape engine, v1 with `template.layout`. */
  template?: CardTemplate | null
  /** v2 only: controlled side + flip handler (adds a flip button). */
  side?: SideId
  onSideChange?: (s: SideId) => void
  /** v2 editor hooks. */
  editing?: boolean
  highlightZone?: string | null
  onZoneClick?: (side: SideId, zoneId: string) => void
  /** `public`/`contacts`: filter with the card's visibility map (defaults apply); `all`: show everything not explicitly hidden. */
  audience?: CardAudience
  /** Links/buttons are clickable (public page, contacts). Off for thumbnails/editor. */
  interactive?: boolean
  /** Value encoded in the card's QR (shown when `design.show_qr`). */
  qrValue?: string | null
  className?: string
}

const PLATFORM: Record<string, string> = { x: 'X', linkedin: 'LinkedIn', tiktok: 'TikTok', youtube: 'YouTube', github: 'GitHub' }
const platformName = (p: string) => PLATFORM[p] ?? p.charAt(0).toUpperCase() + p.slice(1)
const initials = (n: string) => {
  const p = n.trim().split(/\s+/).filter(Boolean)
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? (p[p.length - 1][0] ?? '') : '')).toUpperCase() || '•'
}
const bare = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')

/**
 * Renders a digital card from its template layout + design tokens (contract §2). Pure presentation, no data
 * fetching — used by the editor preview, template thumbnails, contacts, the public page and business screens.
 */
export function DigitalCardRender(props: Props) {
  const { template } = props
  if (isV2(template)) {
    const { card, audience, interactive, qrValue, side, onSideChange, editing, highlightZone, onZoneClick, className } = props
    return <CardV2 card={card} template={template} audience={audience} interactive={interactive} qrValue={qrValue} side={side} onSideChange={onSideChange} editing={editing} highlightZone={highlightZone} onZoneClick={onZoneClick} className={className} />
  }
  return <CardV1 {...props} layout={(template && 'layout' in template ? template.layout : undefined) ?? props.layout ?? 'centered'} />
}

function CardV1({ card, layout, audience = 'all', interactive = false, qrValue, className }: Props & { layout: CardLayout }) {
  const d = card.design
  const f = card.fields
  const shown = (k: VisibilityKey) => (audience === 'all' ? card.visibility?.[k] !== 'hidden' : audience === 'public' ? visibilityOf(card, k) === 'public' : visibilityOf(card, k) !== 'hidden')
  const photo = shown('photo') ? safeImageUrl(card.photo_url) : null
  const name = f.full_name || 'Your name'
  const title = [shown('job_title') ? f.job_title : null, shown('company') ? f.company : null].filter(Boolean).join(' · ')
  const headline = shown('headline') ? f.headline : null
  const pronouns = shown('pronouns') ? f.pronouns : null
  const phones = shown('phones') ? (f.phones ?? []).filter((x) => x.value) : []
  const emails = shown('emails') ? (f.emails ?? []).filter((x) => x.value) : []
  const websites = shown('websites') ? (f.websites ?? []).filter((x) => x.url) : []
  const socials = shown('socials') ? (f.socials ?? []).filter((x) => x.url) : []
  const links = shown('custom_links') ? (f.custom_links ?? []).filter((x) => x.url) : []
  const address = shown('address') ? f.address : null
  const bio = shown('bio') ? f.bio : null
  const onPrimary = onColor(d.primary)
  const muted = withAlpha(d.text, 0.68)
  const divider = withAlpha(d.text, 0.12)
  const Tag = interactive ? 'a' : 'span'
  // Stored URLs are user-controlled: only http(s)/mailto/tel become links (anything else renders as plain text).
  const linkProps = (raw: string) => {
    const href = interactive ? safeHref(raw) : null
    return href ? { href, target: href.startsWith('http') ? '_blank' : undefined, rel: 'noopener noreferrer' } : {}
  }

  const avatar = (size: number, ring = false) =>
    photo ? (
      <img src={photo} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size, boxShadow: ring ? `0 0 0 4px ${d.background}` : undefined }} />
    ) : (
      <span
        aria-hidden="true"
        className="flex shrink-0 items-center justify-center rounded-full font-semibold"
        style={{ width: size, height: size, background: d.primary, color: onPrimary, fontSize: size * 0.36, boxShadow: ring ? `0 0 0 4px ${d.background}` : undefined }}
      >
        {initials(name)}
      </span>
    )

  const nameBlock = (align: 'left' | 'center' = 'left', light = false) => (
    <div className={cn('min-w-0', align === 'center' && 'text-center')}>
      <p className="text-[21px] leading-tight font-bold tracking-tight break-words" style={light ? { color: '#fff' } : undefined}>
        {name}
        {pronouns && (
          <span className="ml-1.5 align-middle text-[12px] font-medium" style={{ color: light ? 'rgba(255,255,255,.8)' : muted }}>
            ({pronouns})
          </span>
        )}
      </p>
      {headline && (
        <p className="mt-0.5 text-[13.5px] font-medium" style={{ color: light ? 'rgba(255,255,255,.92)' : d.accent }}>
          {headline}
        </p>
      )}
      {title && (
        <p className="mt-0.5 text-[13px]" style={{ color: light ? 'rgba(255,255,255,.8)' : muted }}>
          {title}
        </p>
      )}
      {card.business && (
        <p className={cn('mt-1 inline-flex items-center gap-1 text-[11.5px] font-medium', align === 'center' && 'justify-center')} style={{ color: light ? 'rgba(255,255,255,.8)' : muted }}>
          {card.business.name}
          {card.business.verified && <BadgeCheck className="h-3.5 w-3.5" style={{ color: light ? '#fff' : d.accent }} aria-label="Verified business" />}
        </p>
      )}
    </div>
  )

  const actions = [
    phones[0] && { icon: Phone, label: 'Call', href: `tel:${phones[0].value}` },
    emails[0] && { icon: Mail, label: 'Email', href: `mailto:${emails[0].value}` },
    websites[0] && { icon: Globe, label: 'Website', href: websites[0].url },
    address && { icon: MapPin, label: 'Map', href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` },
  ].filter(Boolean) as { icon: typeof Phone; label: string; href: string }[]

  const actionsRow = (center = false) =>
    actions.length ? (
      <div className={cn('flex gap-2', center && 'justify-center')}>
        {actions.map((a) => (
          <Tag key={a.label} {...linkProps(a.href)} aria-label={a.label} title={a.label} className="flex h-10 w-10 items-center justify-center rounded-full transition-opacity hover:opacity-85" style={{ background: d.primary, color: onPrimary }}>
            <a.icon className="h-4.5 w-4.5" />
          </Tag>
        ))}
      </div>
    ) : null

  const rows: { key: string; icon: typeof Phone; label: string; value: string; href: string }[] = [
    ...phones.map((p, i) => ({ key: `p${i}`, icon: Phone, label: p.label || 'Phone', value: p.value, href: `tel:${p.value}` })),
    ...emails.map((e, i) => ({ key: `e${i}`, icon: Mail, label: e.label || 'Email', value: e.value, href: `mailto:${e.value}` })),
    ...websites.map((w, i) => ({ key: `w${i}`, icon: Globe, label: w.label || 'Website', value: bare(w.url), href: w.url })),
    ...(address ? [{ key: 'addr', icon: MapPin, label: 'Address', value: address, href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` }] : []),
    ...links.map((l, i) => ({ key: `l${i}`, icon: Link2, label: l.label || 'Link', value: bare(l.url), href: l.url })),
  ]

  const fieldsBlock = () => (
    <div className="space-y-3">
      {bio && (
        <p className="text-[13.5px] leading-relaxed whitespace-pre-line" style={{ color: muted }}>
          {bio}
        </p>
      )}
      {rows.length > 0 && (
        <ul className="divide-y" style={{ borderColor: divider }}>
          {rows.map((r) => (
            <li key={r.key} style={{ borderColor: divider }}>
              <Tag {...linkProps(r.href)} className="flex items-center gap-3 py-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: withAlpha(d.primary, 0.12), color: d.primary }}>
                  <r.icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[11px] font-medium tracking-wide uppercase" style={{ color: muted }}>
                    {r.label}
                  </span>
                  <span className="block truncate text-[14px] font-medium">{r.value}</span>
                </span>
              </Tag>
            </li>
          ))}
        </ul>
      )}
      {socials.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {socials.map((s) => (
            <Tag key={s.url} {...linkProps(s.url)} className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[12.5px] font-medium" style={{ background: withAlpha(d.text, 0.07) }}>
              <AtSign className="h-3.5 w-3.5" style={{ color: d.accent }} /> {platformName(s.platform)}
            </Tag>
          ))}
        </div>
      )}
      {d.show_qr && qrValue && (
        <div className="flex items-center gap-3 pt-1">
          <QrCode value={qrValue} size={76} label={`QR code for ${name}'s card`} />
          <p className="text-[12px]" style={{ color: muted }}>
            Scan to open this card
          </p>
        </div>
      )}
    </div>
  )

  const cover = cssImage(card.cover_url)
  const coverBg: CSSProperties = cover
    ? { backgroundImage: cover, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { backgroundImage: `linear-gradient(135deg, ${d.primary}, ${withAlpha(d.accent, 0.85)})` }
  const logo = safeImageUrl(card.logo_url ?? card.business?.logo_url)
  const logoMark = (size = 28) => (logo ? <img src={logo} alt="" className="rounded-md object-contain" style={{ width: size, height: size }} /> : null)

  let body: ReactNode
  switch (layout) {
    case 'left':
      body = (
        <div className="p-5">
          <div className="flex items-start gap-4">
            {avatar(72)}
            <div className="min-w-0 flex-1 pt-1">
              {nameBlock()}
            </div>
            {logoMark()}
          </div>
          <div className="my-4 h-px" style={{ background: divider }} />
          {actionsRow()}
          <div className={actions.length ? 'mt-4' : ''}>
            {fieldsBlock()}
          </div>
        </div>
      )
      break
    case 'split':
      body = (
        <div>
          <div className="flex flex-col items-center gap-3 px-5 pt-6 pb-5 text-center" style={{ background: d.primary, color: onPrimary }}>
            {avatar(84, true)}
            <div className="min-w-0" style={{ color: onPrimary }}>
              <p className="text-[21px] leading-tight font-bold tracking-tight break-words">{name}</p>
              {headline && <p className="mt-0.5 text-[13.5px] font-medium opacity-90">{headline}</p>}
              {title && <p className="mt-0.5 text-[13px] opacity-80">{title}</p>}
              {card.business && <p className="mt-1 text-[11.5px] font-medium opacity-80">{card.business.name}</p>}
            </div>
          </div>
          <div className="space-y-4 p-5">
            {actionsRow(true)}
            {fieldsBlock()}
          </div>
        </div>
      )
      break
    case 'hero_photo':
      body = (
        <div>
          <div className="relative h-56" style={photo ? { backgroundImage: cssImage(photo), backgroundSize: 'cover', backgroundPosition: 'center' } : coverBg}>
            <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,.72) 100%)' }} />
            <div className="absolute inset-x-5 bottom-4">
              {nameBlock('left', true)}
            </div>
            {logo && (
              <span className="absolute top-3 right-3 rounded-lg bg-white/90 p-1">
                {logoMark(26)}
              </span>
            )}
          </div>
          <div className="space-y-4 p-5">
            {actionsRow()}
            {fieldsBlock()}
          </div>
        </div>
      )
      break
    case 'banner':
      body = (
        <div>
          <div className="h-28" style={coverBg} />
          <div className="-mt-11 px-5">
            <div className="flex items-end justify-between">
              {avatar(88, true)}
              {logoMark(30)}
            </div>
            <div className="mt-3">
              {nameBlock()}
            </div>
          </div>
          <div className="space-y-4 p-5 pt-4">
            {actionsRow()}
            {fieldsBlock()}
          </div>
        </div>
      )
      break
    case 'compact':
      body = (
        <div className="flex aspect-[1.75] w-full flex-col justify-between p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[18px] leading-tight font-bold tracking-tight">{name}</p>
              {(f.job_title || headline) && (
                <p className="truncate text-[12.5px] font-medium" style={{ color: d.accent }}>
                  {shown('job_title') && f.job_title ? f.job_title : headline}
                </p>
              )}
              {shown('company') && f.company && (
                <p className="truncate text-[12px]" style={{ color: muted }}>
                  {f.company}
                </p>
              )}
            </div>
            {logo ? logoMark(34) : avatar(40)}
          </div>
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0 space-y-0.5 text-[11.5px]" style={{ color: muted }}>
              {phones[0] && <p className="truncate">{phones[0].value}</p>}
              {emails[0] && <p className="truncate">{emails[0].value}</p>}
              {websites[0] && <p className="truncate">{bare(websites[0].url)}</p>}
            </div>
            {d.show_qr && qrValue && <QrCode value={qrValue} size={62} label={`QR code for ${name}'s card`} />}
          </div>
        </div>
      )
      break
    default:
      body = (
        <div className="flex flex-col items-center gap-4 p-5 pt-7">
          {avatar(96)}
          {nameBlock('center')}
          {actionsRow(true)}
          <div className="w-full">
            {fieldsBlock()}
          </div>
        </div>
      )
  }

  return (
    <div className={cn('relative w-full overflow-hidden shadow-sm', className)} style={{ ...surfaceStyle(d), boxShadow: `0 1px 2px ${withAlpha('#000000', 0.06)}, 0 0 0 1px ${divider}` }}>
      {body}
    </div>
  )
}

/**
 * Thumbnail: renders the card at a fixed design width and scales it down with a CSS transform, so text and
 * shapes stay crisp at any size.
 */
export function CardThumb(props: Props & { width?: number; maxHeight?: number }) {
  if (isV2(props.template)) {
    const [W, H] = sideSize(props.template.format)
    const { maxHeight, className, width: _w, ...rest } = props
    void _w
    return (
      <div className={cn('mx-auto', className)} style={maxHeight ? { maxWidth: `min(100%, ${(maxHeight * W) / H}px)` } : undefined} aria-hidden="true">
        <DigitalCardRender {...rest} interactive={false} />
      </div>
    )
  }
  return <CardThumbV1 {...props} />
}

function CardThumbV1({ width = 360, maxHeight, className, ...props }: Props & { width?: number; maxHeight?: number }) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState<{ scale: number; height: number } | null>(null)
  useLayoutEffect(() => {
    const o = outer.current
    const i = inner.current
    if (!o || !i) return
    const measure = () => {
      const scale = o.clientWidth / width
      setDims({ scale, height: i.offsetHeight * scale })
    }
    const ro = new ResizeObserver(measure)
    ro.observe(o)
    ro.observe(i)
    return () => ro.disconnect()
  }, [width])
  return (
    <div ref={outer} className={cn('relative w-full overflow-hidden', className)} style={{ height: dims ? Math.min(dims.height, maxHeight ?? Infinity) : undefined, aspectRatio: dims ? undefined : '3 / 4' }} aria-hidden="true">
      <div ref={inner} style={{ width, transform: `scale(${dims?.scale ?? 0})`, transformOrigin: 'top left', position: 'absolute', top: 0, left: 0 }}>
        <DigitalCardRender {...props} interactive={false} />
      </div>
    </div>
  )
}

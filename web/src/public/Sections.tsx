import { Fragment, useState, type ReactNode } from 'react'
import { ArrowUpRight, Clock, Globe, Mail, MapPin, Phone } from 'lucide-react'
import type { Section } from '@/business/api/types'
import { safeHref, safeImageUrl } from '@/lib/url'
import { actionHref, isOpenNow, mapsLink, onColor, sectionData, todayRow } from './sectionUtils'

/** Tiny safe Markdown subset: paragraphs, "- " lists, **bold**, *italic*, [text](https://…). No HTML. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const k = `${keyBase}-${i++}`
    if (m[2]) out.push(<strong key={k}>{m[2]}</strong>)
    else if (m[3]) out.push(<em key={k}>{m[3]}</em>)
    else
      out.push(
        <a key={k} href={m[5]} target="_blank" rel="noreferrer noopener" className="font-medium underline underline-offset-2">
          {m[4]}
        </a>,
      )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function MiniMarkdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean)
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-muted">
      {blocks.map((b, bi) => {
        const lines = b.split('\n')
        if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
          return (
            <ul key={bi} className="list-disc space-y-1 pl-5">
              {lines.map((l, li) => (
                <li key={li}>{inline(l.replace(/^\s*[-*]\s+/, ''), `${bi}-${li}`)}</li>
              ))}
            </ul>
          )
        }
        return (
          <p key={bi}>
            {lines.map((l, li) => (
              <Fragment key={li}>
                {li > 0 && <br />}
                {inline(l, `${bi}-${li}`)}
              </Fragment>
            ))}
          </p>
        )
      })}
    </div>
  )
}

function Block({ title, children, right }: { title?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-xs">
      {title && (
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[13px] font-semibold tracking-wider text-subtle uppercase">{title}</h2>
          {right}
        </div>
      )}
      {children}
    </section>
  )
}

const PLATFORM_NAMES: Record<string, string> = { x: 'X', linkedin: 'LinkedIn', tiktok: 'TikTok', youtube: 'YouTube', github: 'GitHub' }
const platformName = (p: string) => PLATFORM_NAMES[p] ?? p.charAt(0).toUpperCase() + p.slice(1)

export function SectionView({ section, accent, businessSlug }: { section: Section; accent: string; businessSlug: string }) {
  const [activeCat, setActiveCat] = useState(0)
  switch (section.type) {
    case 'about': {
      const d = sectionData(section)
      return d.text ? (
        <Block title="About">
          <MiniMarkdown text={d.text} />
        </Block>
      ) : null
    }
    case 'text': {
      const d = sectionData(section)
      return d.markdown ? (
        <Block>
          <MiniMarkdown text={d.markdown} />
        </Block>
      ) : null
    }
    case 'contact': {
      const d = sectionData(section)
      const rows = [
        d.phone && { icon: Phone, label: d.phone, href: `tel:${d.phone}` },
        d.email && { icon: Mail, label: d.email, href: `mailto:${d.email}` },
        d.website && { icon: Globe, label: d.website.replace(/^https?:\/\//, ''), href: safeHref(d.website) },
        d.address && { icon: MapPin, label: d.address, href: mapsLink(d.address) },
      ].filter(Boolean) as { icon: typeof Phone; label: string; href: string | null }[]
      if (!rows.length) return null
      return (
        <Block title="Contact">
          <ul className="-my-1 divide-y divide-border">
            {rows.map((r) => (
              <li key={r.label}>
                {r.href ? (
                  <a href={r.href} target={r.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className="flex items-center gap-3 py-2.5 text-[15px] hover:opacity-80">
                    <r.icon className="h-4.5 w-4.5 shrink-0" style={{ color: accent }} />
                    <span className="min-w-0 break-words">{r.label}</span>
                  </a>
                ) : (
                  <span className="flex items-center gap-3 py-2.5 text-[15px]">
                    <r.icon className="h-4.5 w-4.5 shrink-0" style={{ color: accent }} />
                    <span className="min-w-0 break-words">{r.label}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Block>
      )
    }
    case 'hours': {
      const d = sectionData(section)
      if (!d.rows?.length) return null
      const open = isOpenNow(d.rows)
      const today = todayRow(d.rows)
      return (
        <Block
          title="Opening hours"
          right={
            open != null && (
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${open ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-surface-2 text-muted'}`}>
                <Clock className="h-3 w-3" /> {open ? 'Open now' : 'Closed now'}
              </span>
            )
          }
        >
          <table className="w-full text-[14.5px]">
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.day} className={r === today ? 'font-semibold text-fg' : 'text-muted'}>
                  <td className="py-1 pr-4">{r.day}</td>
                  <td className="py-1 text-right tabular-nums">{r.closed ? 'Closed' : `${r.open} – ${r.close}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Block>
      )
    }
    case 'social': {
      const d = sectionData(section)
      const links = (d.links ?? []).map((l) => ({ ...l, href: safeHref(l.url) })).filter((l): l is typeof l & { href: string } => !!l.href)
      if (!links.length) return null
      return (
        <Block title="Follow">
          <div className="flex flex-wrap gap-2">
            {links.map((l) => (
              <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-2 text-sm font-medium hover:bg-surface-2">
                {platformName(l.platform)} <ArrowUpRight className="h-3.5 w-3.5 text-subtle" />
              </a>
            ))}
          </div>
        </Block>
      )
    }
    case 'services': {
      const d = sectionData(section)
      if (!d.items?.length) return null
      return (
        <Block title="Services">
          <ul className="-my-2 divide-y divide-border">
            {d.items.map((it, i) => (
              <li key={i} className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold">{it.title}</p>
                  {it.description && <p className="mt-0.5 text-sm text-muted">{inline(it.description, 'd')}</p>}
                </div>
                {it.price && <span className="shrink-0 text-sm font-semibold tabular-nums">{it.price}</span>}
              </li>
            ))}
          </ul>
        </Block>
      )
    }
    case 'products': {
      const d = sectionData(section)
      if (!d.items?.length) return null
      return (
        <Block title="Products">
          <div className="grid gap-3 sm:grid-cols-2">
            {d.items.map((it, i) => {
              const img = safeImageUrl(it.image_url)
              const href = safeHref(it.url)
              const body = (
                <>
                  {img && <img src={img} alt="" loading="lazy" className="mb-3 aspect-[4/3] w-full rounded-xl object-cover" />}
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[15px] font-semibold">{it.title}</p>
                    {it.price && <span className="shrink-0 text-sm font-semibold tabular-nums">{it.price}</span>}
                  </div>
                  {it.description && <p className="mt-1 text-sm text-muted">{inline(it.description, 'd')}</p>}
                  {href && (
                    <span className="mt-2 inline-flex items-center gap-1 text-sm font-semibold" style={{ color: accent }}>
                      View <ArrowUpRight className="h-3.5 w-3.5" />
                    </span>
                  )}
                </>
              )
              return href ? (
                <a key={i} href={href} target="_blank" rel="noreferrer" className="block rounded-xl border border-border p-3.5 hover:bg-surface-2">
                  {body}
                </a>
              ) : (
                <div key={i} className="rounded-xl border border-border p-3.5">
                  {body}
                </div>
              )
            })}
          </div>
        </Block>
      )
    }
    case 'menu': {
      const d = sectionData(section)
      const cats = d.categories ?? []
      if (!cats.length) return null
      const shown = cats.length > 1 ? [cats[Math.min(activeCat, cats.length - 1)]] : cats
      return (
        <Block title="Menu">
          {cats.length > 1 && (
            <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Menu categories">
              {cats.map((c, i) => (
                <button
                  key={c.name + i}
                  role="tab"
                  aria-selected={i === activeCat}
                  onClick={() => setActiveCat(i)}
                  className="shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors"
                  style={i === activeCat ? { background: accent, borderColor: accent, color: onColor(accent) } : undefined}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
          {shown.map((c) => (
            <div key={c.name}>
              {cats.length === 1 && <h3 className="mb-2 text-base font-semibold">{c.name}</h3>}
              <ul className="-my-2 divide-y divide-border">
                {c.items.map((it, i) => (
                  <li key={i} className="py-3">
                    <div className="flex items-baseline justify-between gap-4">
                      <p className="text-[15px] font-semibold">{it.name}</p>
                      <span className="shrink-0 text-[15px] font-semibold tabular-nums">{it.price}</span>
                    </div>
                    {it.description && <p className="mt-0.5 text-sm text-muted">{inline(it.description, 'd')}</p>}
                    {(it.tags?.length ?? 0) > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {it.tags!.map((t) => (
                          <span key={t} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted ring-1 ring-border">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </Block>
      )
    }
    case 'buttons': {
      const d = sectionData(section)
      const items = (d.items ?? []).map((b) => ({ ...b, href: safeHref(actionHref(b.action, businessSlug)) })).filter((b) => b.href)
      if (!items.length) return null
      return (
        <div className="space-y-2.5">
          {items.map((b, i) => (
            <a
              key={i}
              href={b.href!}
              target={b.href!.startsWith('http') ? '_blank' : undefined}
              rel="noreferrer"
              className="flex h-12 items-center justify-center gap-2 rounded-2xl px-4 text-[15px] font-semibold shadow-sm transition-opacity hover:opacity-90"
              style={{ background: accent, color: onColor(accent) }}
            >
              {b.label}
            </a>
          ))}
        </div>
      )
    }
    case 'gallery': {
      const d = sectionData(section)
      if (!d.images?.length) return null
      return (
        <Block title="Gallery">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {d.images.map((raw) => safeImageUrl(raw)).filter((src): src is string => !!src).map((src, i) => (
              <img key={i} src={src} alt="" loading="lazy" className="aspect-square w-full rounded-xl object-cover" />
            ))}
          </div>
        </Block>
      )
    }
    default:
      return null
  }
}

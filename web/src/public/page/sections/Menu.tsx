import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Flame, Leaf, Search, Sparkles, Sprout, Star, WheatOff, XCircle } from 'lucide-react'
import type { MenuBadge, MenuItem, SectionDataMap } from '@/business/api/types'
import { usePage } from '../ctx'
import { formatPrice, imgSrc } from '../format'
import { FoodPlaceholder } from '../food'
import { Inline, Sec } from '../ui'

const BADGES: Record<MenuBadge, { label: string; icon: typeof Leaf; color: string }> = {
  vegetarian: { label: 'Vegetarian', icon: Leaf, color: '#16a34a' },
  vegan: { label: 'Vegan', icon: Sprout, color: '#15803d' },
  spicy: { label: 'Spicy', icon: Flame, color: '#dc2626' },
  gluten_free: { label: 'Gluten-free', icon: WheatOff, color: '#b45309' },
  new: { label: 'New', icon: Sparkles, color: '#7c3aed' },
  popular: { label: 'Popular', icon: Star, color: '#d97706' },
  sold_out: { label: 'Sold out', icon: XCircle, color: '#6b7280' },
}

export function Badges({ badges, tags }: { badges?: MenuBadge[] | null; tags?: string[] | null }) {
  const list = (badges ?? []).filter((b) => BADGES[b])
  if (!list.length && !tags?.length) return null
  return (
    <div className="pg-badges">
      {list.map((b) => {
        const m = BADGES[b]
        return (
          <span key={b} className="pg-chip" style={{ color: m.color, borderColor: `${m.color}40`, background: `${m.color}14` }}>
            <m.icon className="h-3 w-3" aria-hidden="true" />
            {m.label}
          </span>
        )
      })}
      {tags?.map((t) => (
        <span key={t} className="pg-chip">
          {t}
        </span>
      ))}
    </div>
  )
}

function Variants({ item, currency }: { item: MenuItem; currency?: string }) {
  if (!item.variants?.length) return null
  return (
    <div className="pg-variants">
      {item.variants.map((v, i) => (
        <span key={i} className="pg-variant">
          {v.label} <b>{formatPrice(v.price, currency)}</b>
        </span>
      ))}
    </div>
  )
}

/** Styles that reserve room for a photo, so a missing one gets a food-icon tile instead of a gap. */
const PHOTO_STYLES = new Set(['grid', 'spotlight', 'bars'])

function Media({ it, style, img }: { it: MenuItem; style: string; img: string | null }) {
  const cls = `pg-mi-media pg-mi-media-${style}`
  if (img) return <img className={cls} src={img} alt="" loading="lazy" />
  if (!PHOTO_STYLES.has(style)) return null
  return <FoodPlaceholder name={it.name} className={cls} />
}

function Item({ it, style, currency, showImages, n }: { it: MenuItem; style: string; currency?: string; showImages: boolean; n: number }) {
  const sold = it.badges?.includes('sold_out')
  const price = it.variants?.length ? null : formatPrice(it.price, currency)
  const fromPrice = it.variants?.length ? formatPrice(it.variants[0].price, currency) : null
  const img = showImages ? imgSrc(it.image_url) : null
  const desc = it.description ? (
    <p className="pg-item-desc">
      <Inline text={it.description} />
    </p>
  ) : null
  if (style === 'grid') {
    return (
      <article className={`pg-card${sold ? ' pg-soldout' : ''}`}>
        {showImages && (img ? <img className="pg-card-img" src={img} alt="" loading="lazy" /> : <FoodPlaceholder name={it.name} className="pg-card-img" />)}
        <Badges badges={it.badges} tags={it.tags} />
        <div className="pg-card-body">
          <p className="pg-item-name">{it.name}</p>
          {desc}
          <Variants item={it} currency={currency} />
          {(price || fromPrice) && !it.variants?.length && <p className="pg-price">{price}</p>}
        </div>
      </article>
    )
  }
  const name: ReactNode = <p className="pg-item-name">{it.name}</p>
  if (style === 'fine') {
    return (
      <div className={`pg-mi${sold ? ' pg-soldout' : ''}`}>
        {img && <img className="pg-mi-media pg-mi-media-fine" src={img} alt="" loading="lazy" />}
        {name}
        {desc}
        {price && <span className="pg-price">{price}</span>}
        <Variants item={it} currency={currency} />
        <Badges badges={it.badges?.filter((b) => b !== 'sold_out')} tags={it.tags} />
      </div>
    )
  }
  const media = showImages ? <Media it={it} style={style} img={img} /> : null
  const priceEl = price && <span className="pg-price">{price}</span>
  return (
    <div className={`pg-mi${sold ? ' pg-soldout' : ''}${media ? ' pg-has-media' : ''}`}>
      {style === 'spotlight' || style === 'bars' || style === 'pricebox' ? null : media}
      <div className="pg-mi-main">
        <div className="pg-mi-row">
          {style === 'numbered' && <span className="pg-mi-n">{n}.</span>}
          {name}
          {(style === 'leaders' || style === 'numbered') && price && <span className="pg-leader" aria-hidden="true" />}
          {style !== 'spotlight' && style !== 'pricebox' && priceEl}
        </div>
        {desc}
        <Variants item={it} currency={currency} />
        <Badges badges={it.badges} tags={it.tags} />
      </div>
      {style === 'pricebox' && priceEl && <span className="pg-pricebox">{priceEl}</span>}
      {(style === 'spotlight' || style === 'bars') && (media || priceEl) && (
        <div className="pg-mi-aside">
          {media}
          {style === 'spotlight' && priceEl}
        </div>
      )}
    </div>
  )
}

const LIST_CLASS: Record<string, string> = { bar: '', columns: 'pg-menu-cols' }

/** "Burger menu" → accent first word, plain rest (split headings). */
function SplitTitle({ text }: { text: string }) {
  const [first, ...rest] = text.split(' ')
  return rest.length ? (
    <>
      <span className="pg-split-a">{first}</span> {rest.join(' ')}
    </>
  ) : (
    <>{text}</>
  )
}

/** Menu with sticky category nav (scroll-spy), search for long menus, badges, variants and optional images. */
export function MenuSection({ d, sectionId }: { d: SectionDataMap['menu'] & { title?: string }; sectionId: string }) {
  const { layout, preview } = usePage()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const refs = useRef<(HTMLElement | null)[]>([])
  const cats = useMemo(() => (d.categories ?? []).filter((c) => c && c.name), [d.categories])
  const total = cats.reduce((n, c) => n + (c.items?.length ?? 0), 0)
  const style = layout.menu
  const showImages = d.show_images ?? style === 'grid'
  const needle = q.trim().toLowerCase()
  const shown = needle
    ? cats.map((c) => ({ ...c, items: (c.items ?? []).filter((i) => `${i.name} ${i.description ?? ''} ${(i.badges ?? []).join(' ')} ${(i.tags ?? []).join(' ')}`.toLowerCase().includes(needle)) })).filter((c) => c.items.length)
    : cats

  useEffect(() => {
    if (needle || cats.length < 2 || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (vis) setActive(Number((vis.target as HTMLElement).dataset.idx))
      },
      { rootMargin: '-72px 0px -60% 0px' },
    )
    refs.current.forEach((el) => el && io.observe(el))
    return () => io.disconnect()
  }, [cats.length, needle])

  if (!cats.length) return null
  const go = (i: number) => {
    setActive(i)
    refs.current[i]?.scrollIntoView({ behavior: preview ? 'auto' : 'smooth', block: 'start' })
  }
  return (
    <Sec title={d.title} bare={style === 'grid'} className={`pg-menu-${style}`}>
      {cats.length > 1 && !needle && (
        <nav className="pg-menu-nav" aria-label="Menu categories">
          {cats.map((c, i) => (
            <button key={c.name + i} type="button" aria-current={i === active} onClick={() => go(i)}>
              {c.name}
            </button>
          ))}
        </nav>
      )}
      {total > 12 && (
        <label className="pg-search">
          <Search className="h-4.5 w-4.5" aria-hidden="true" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${total} items…`} aria-label="Search the menu" />
        </label>
      )}
      <div style={{ marginTop: cats.length > 1 || total > 12 ? 18 : 0 }}>
        {shown.map((c) => {
          const idx = cats.indexOf(cats.find((x) => x.name === c.name) ?? c)
          return (
            <section
              key={`${sectionId}-${c.name}-${idx}`}
              className="pg-cat"
              data-idx={idx}
              ref={(el) => {
                refs.current[idx] = el
              }}
              aria-label={c.name}
            >
              <div className="pg-cat-h">
                <h3>
                  <span className="pg-cat-t">{style === 'numbered' || layout.cat === 'split' ? <SplitTitle text={c.name} /> : c.name}</span>
                </h3>
                {c.description && (
                  <p>
                    <Inline text={c.description} />
                  </p>
                )}
              </div>
              {style === 'grid' ? (
                <div className="pg-grid">
                  {(c.items ?? []).map((it, i) => (
                    <Item key={i} it={it} style={style} currency={d.currency} showImages={showImages} n={i + 1} />
                  ))}
                </div>
              ) : (
                <div className={LIST_CLASS[style] ?? 'pg-menu-list'}>
                  {(c.items ?? []).map((it, i) => (
                    <Item key={i} it={it} style={style} currency={d.currency} showImages={showImages} n={i + 1} />
                  ))}
                </div>
              )}
            </section>
          )
        })}
        {needle && !shown.length && <p className="pg-muted" style={{ padding: '24px 0', textAlign: 'center' }}>Nothing matches “{q}”.</p>}
      </div>
    </Sec>
  )
}

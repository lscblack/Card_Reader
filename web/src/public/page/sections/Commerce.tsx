import { ArrowUpRight, Clock } from 'lucide-react'
import type { Price, ProductItem, SectionDataMap } from '@/business/api/types'
import { safeHref } from '@/lib/url'
import { usePage } from '../ctx'
import { formatPrice, imgSrc } from '../format'
import { Placeholder, Prose, Sec } from '../ui'

const initial = (s: string) => s.replace(/^[^\p{L}\p{N}]+/u, '').charAt(0).toUpperCase() || '•'
const num = (p: Price | null | undefined) => (typeof p === 'number' ? p : typeof p === 'string' ? Number(p.replace(/[^0-9.]/g, '')) || null : null)

function PriceLine({ it, currency, className }: { it: ProductItem; currency?: string; className?: string }) {
  const price = formatPrice(it.price, currency)
  const was = it.compare_at_price != null && num(it.compare_at_price)! > (num(it.price) ?? 0) ? formatPrice(it.compare_at_price, currency) : null
  if (!price && !was) return null
  return (
    <div className={className ?? 'pg-price-row'}>
      {price && <span className="pg-price">{price}</span>}
      {was && <span className="pg-was">{was}</span>}
    </div>
  )
}

function Cta({ it, className = 'pg-btn pg-prod-cta' }: { it: ProductItem; className?: string }) {
  const href = safeHref(it.cta?.url ?? it.url)
  if (!href || it.in_stock === false) return null
  return (
    <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className={className}>
      {it.cta?.label || 'View'} <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
    </a>
  )
}

const title = (it: ProductItem & { name?: string }) => it.title || it.name || ''

function GridCard({ it, currency }: { it: ProductItem; currency?: string }) {
  const img = imgSrc(it.image_url)
  return (
    <article className="pg-card pg-prod" style={{ position: 'relative' }}>
      {img ? <img className="pg-card-img" src={img} alt="" loading="lazy" /> : <Placeholder label={initial(title(it))} />}
      {it.badge && <span className="pg-ribbon">{it.badge}</span>}
      {it.in_stock === false && <span className="pg-oos">Out of stock</span>}
      <div className="pg-card-body">
        <p className="pg-prod-name">{title(it)}</p>
        {it.description && <p className="pg-item-desc" style={{ fontSize: 13 }}>{it.description}</p>}
        <PriceLine it={it} currency={currency} />
        <Cta it={it} />
      </div>
    </article>
  )
}

export function ProductsSection({ d }: { d: SectionDataMap['products'] & { title?: string } }) {
  const { layout } = usePage()
  const items = (d.items ?? []).filter((i) => title(i))
  if (!items.length) return null
  if (layout.products === 'single') {
    const [hero, ...rest] = items
    const img = imgSrc(hero.image_url)
    const save = num(hero.compare_at_price) && num(hero.price) && num(hero.compare_at_price)! > num(hero.price)! ? Math.round((1 - num(hero.price)! / num(hero.compare_at_price)!) * 100) : null
    return (
      <>
        <Sec bare>
          <div className="pg-single-hero">
            {img ? <img src={img} alt={title(hero)} /> : <Placeholder label={initial(title(hero))} />}
            {hero.badge && <span className="pg-ribbon">{hero.badge}</span>}
          </div>
          <h2 className="pg-single-name">{title(hero)}</h2>
          <div className="pg-single-price">
            <PriceLine it={hero} currency={d.currency} className="pg-single-price" />
            {save && <span className="pg-save">Save {save}%</span>}
          </div>
          {hero.in_stock === false && <p className="pg-chip" style={{ marginTop: 8 }}>Out of stock</p>}
          {hero.description && <Prose text={hero.description} className="" />}
          <div style={{ marginTop: 16 }}>
            <Cta it={hero} className="pg-btn pg-btn-block" />
          </div>
        </Sec>
        {rest.length > 0 && (
          <Sec title="More" bare>
            <div className="pg-prod-grid">
              {rest.map((it, i) => (
                <GridCard key={i} it={it} currency={d.currency} />
              ))}
            </div>
          </Sec>
        )}
      </>
    )
  }
  if (layout.products === 'list') {
    return (
      <Sec title={d.title ?? 'Products'}>
        <div className="pg-plist">
          {items.map((it, i) => {
            const img = imgSrc(it.image_url)
            return (
              <div key={i} className="pg-pl">
                {img ? <img className="pg-pl-img" src={img} alt="" loading="lazy" /> : <Placeholder label={initial(title(it))} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="pg-mi-row">
                    <p className="pg-item-name">{title(it)}</p>
                    <PriceLine it={it} currency={d.currency} className="pg-price-row" />
                  </div>
                  {it.description && <p className="pg-item-desc">{it.description}</p>}
                  <Cta it={it} className="pg-accent" />
                </div>
              </div>
            )
          })}
        </div>
      </Sec>
    )
  }
  return (
    <Sec title={d.title} bare>
      <div className="pg-prod-grid">
        {items.map((it, i) => (
          <GridCard key={i} it={it} currency={d.currency} />
        ))}
      </div>
    </Sec>
  )
}

export function ServicesSection({ d, title: t }: { d: SectionDataMap['services']; title?: string | null }) {
  const items = (d.items ?? []).filter((i) => i.title)
  if (!items.length) return null
  return (
    <Sec title={t ?? 'Services'}>
      <div>
        {items.map((it, i) => (
          <div key={i} className="pg-svc">
            <div style={{ minWidth: 0 }}>
              <p className="pg-item-name">{it.title}</p>
              {it.description && <p className="pg-item-desc">{it.description}</p>}
            </div>
            {(it.price != null && it.price !== '') || it.duration ? (
              <div className="pg-svc-meta">
                {it.price != null && it.price !== '' && <span className="pg-price">{formatPrice(it.price, (d as { currency?: string }).currency)}</span>}
                {it.duration && (
                  <span className="pg-dur">
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" /> {it.duration}
                  </span>
                )}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </Sec>
  )
}

import { ArrowUpRight } from 'lucide-react'
import type { Action, SectionDataMap } from '@/business/api/types'
import { safeHref } from '@/lib/url'
import { actionHref } from '../../sectionUtils'
import { usePage } from '../ctx'
import { iconForUrl } from '../hooks'
import { LinkGlyph, Sec } from '../ui'

export function LinksSection({ d }: { d: SectionDataMap['links'] & { title?: string } }) {
  const { layout } = usePage()
  const items = (d.items ?? []).map((l) => ({ ...l, href: safeHref(l.url) })).filter((l): l is typeof l & { href: string } => !!l.href && !!l.label)
  if (!items.length) return null
  return (
    <Sec title={d.title} bare>
      <div className={`pg-links pg-links-${layout.links}`}>
        {items.map((l, i) => (
          <a key={i} href={l.href} target={l.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className={`pg-link${l.highlight ? ' pg-link-hi' : ''}`}>
            <span className="pg-link-ico">
              <LinkGlyph icon={l.icon || iconForUrl(l.href)} />
            </span>
            <span className="pg-link-label">{l.label}</span>
            <ArrowUpRight className="pg-link-arrow h-4 w-4" aria-hidden="true" />
          </a>
        ))}
      </div>
    </Sec>
  )
}

const PLATFORM_NAMES: Record<string, string> = { x: 'X', linkedin: 'LinkedIn', tiktok: 'TikTok', youtube: 'YouTube', github: 'GitHub' }
const platformName = (p: string) => PLATFORM_NAMES[p] ?? p.charAt(0).toUpperCase() + p.slice(1)

export function SocialSection({ d }: { d: SectionDataMap['social'] }) {
  const links = (d.links ?? []).map((l) => ({ ...l, href: safeHref(l.url) })).filter((l): l is typeof l & { href: string } => !!l.href)
  if (!links.length) return null
  return (
    <Sec bare>
      <div className="pg-social">
        {links.map((l) => (
          <a key={l.href} href={l.href} target="_blank" rel="noreferrer" aria-label={platformName(l.platform)} title={platformName(l.platform)}>
            <LinkGlyph icon={l.platform} />
          </a>
        ))}
      </div>
    </Sec>
  )
}

export function ButtonsSection({ d }: { d: SectionDataMap['buttons'] }) {
  const { businessSlug } = usePage()
  const items = (d.items ?? []).map((b) => ({ ...b, href: safeHref(actionHref(b.action as Action, businessSlug)) })).filter((b) => b.href)
  if (!items.length) return null
  return (
    <Sec bare>
      <div className="pg-links">
        {items.map((b, i) => (
          <a key={i} href={b.href!} target={b.href!.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className="pg-btn pg-btn-block">
            {b.label}
          </a>
        ))}
      </div>
    </Sec>
  )
}

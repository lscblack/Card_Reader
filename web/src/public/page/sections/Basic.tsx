import { Clock, Globe, Mail, MapPin, Phone } from 'lucide-react'
import type { SectionDataMap } from '@/business/api/types'
import { safeHref } from '@/lib/url'
import { isOpenNow, mapsLink, todayRow } from '../../sectionUtils'
import { Prose, Sec } from '../ui'

export function AboutSection({ d, title }: { d: SectionDataMap['about']; title?: string | null }) {
  return d.text ? (
    <Sec title={title ?? 'About'}>
      <Prose text={d.text} />
    </Sec>
  ) : null
}

export function TextSection({ d }: { d: SectionDataMap['text'] }) {
  return d.markdown ? (
    <Sec bare className="pg-align">
      <Prose text={d.markdown} />
    </Sec>
  ) : null
}

export function ContactSection({ d, title }: { d: SectionDataMap['contact']; title?: string | null }) {
  const rows = [
    d.phone && { icon: Phone, label: d.phone, href: `tel:${d.phone.replace(/\s+/g, '')}` },
    d.email && { icon: Mail, label: d.email, href: `mailto:${d.email}` },
    d.website && { icon: Globe, label: d.website.replace(/^https?:\/\//, '').replace(/\/$/, ''), href: safeHref(d.website) },
    d.address && { icon: MapPin, label: d.address, href: mapsLink(d.address) },
  ].filter(Boolean) as { icon: typeof Phone; label: string; href: string | null }[]
  if (!rows.length) return null
  return (
    <Sec title={title ?? 'Contact'}>
      <div className="pg-rows">
        {rows.map((r) =>
          r.href ? (
            <a key={r.label} href={r.href} target={r.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
              <r.icon className="h-4.5 w-4.5" aria-hidden="true" />
              <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{r.label}</span>
            </a>
          ) : (
            <div key={r.label}>
              <r.icon className="h-4.5 w-4.5" aria-hidden="true" />
              <span>{r.label}</span>
            </div>
          ),
        )}
      </div>
    </Sec>
  )
}

export function HoursSection({ d, title }: { d: SectionDataMap['hours']; title?: string | null }) {
  if (!d.rows?.length) return null
  const open = isOpenNow(d.rows)
  const today = todayRow(d.rows)
  return (
    <Sec
      title={title ?? 'Opening hours'}
      right={
        open != null && (
          <span className="pg-open" style={open ? { background: '#16a34a1f', color: '#16a34a' } : { background: 'var(--pg-surface-2)', color: 'var(--pg-muted)' }}>
            <Clock className="h-3 w-3" aria-hidden="true" /> {open ? 'Open now' : 'Closed now'}
          </span>
        )
      }
    >
      <table className="pg-hours">
        <tbody>
          {d.rows.map((r) => (
            <tr key={r.day} className={r === today ? 'pg-today' : undefined}>
              <td>{r.day}</td>
              <td>{r.closed ? 'Closed' : `${r.open} – ${r.close}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Sec>
  )
}

import { useState } from 'react'
import { ArrowUpRight, CalendarPlus, Clock, MapPin, Navigation } from 'lucide-react'
import type { SectionDataMap } from '@/business/api/types'
import { safeHref } from '@/lib/url'
import { mapsLink } from '../../sectionUtils'
import { usePage } from '../ctx'
import { fmtDate, fmtTime, icsDataUrl, parseWhen } from '../format'
import { Prose, Sec } from '../ui'

/** Map: a neutral drawing until the visitor asks for it (no third-party request on page load). */
function MapBox({ query }: { query: string }) {
  const { preview } = usePage()
  const [on, setOn] = useState(false)
  return (
    <div className="pg-map">
      {on && !preview ? (
        <iframe title={`Map of ${query}`} src={`https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
      ) : (
        <button type="button" className="pg-map-btn" onClick={() => setOn(true)} aria-label="Show the map">
          <span className="pg-map-pin">
            <i />
          </span>
          <span style={{ marginTop: 10 }}>Tap to load the map</span>
        </button>
      )}
    </div>
  )
}

export function EventSection({ d, sectionId }: { d: SectionDataMap['event']; sectionId: string }) {
  const { pageUrl, layout } = usePage()
  const [now] = useState(() => Date.now())
  const start = parseWhen(d.starts_at)
  const end = parseWhen(d.ends_at ?? null)
  if (!start || !d.title) return null
  const ended = (end ?? start).getTime() < now
  const ics = icsDataUrl(d, pageUrl)
  const where = d.map_query || d.address || d.venue
  const cta = safeHref(d.cta?.url)
  const sameDay = end && end.toDateString() === start.toDateString()
  const when = `${fmtTime(start)}${end ? ` – ${sameDay ? fmtTime(end) : `${fmtDate(end, { day: 'numeric', month: 'short' })}, ${fmtTime(end)}`}` : ''}`
  const invite = layout.id === 'event-invite'
  return (
    <Sec bare={invite} className="pg-ev" id={`ev-${sectionId}`}>
      <div style={invite ? { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 } : { display: 'flex', gap: 16, alignItems: 'center' }}>
        <div className="pg-date" aria-hidden="true">
          <span>{fmtDate(start, { month: 'short' })}</span>
          <b>{start.getDate()}</b>
        </div>
        <div style={{ minWidth: 0 }}>
          {ended && <span className="pg-ended">This event has ended</span>}
          <h2 className="pg-ev-title" style={ended ? { marginTop: 8 } : undefined}>
            {d.title}
          </h2>
        </div>
      </div>
      <div className="pg-ev-rows">
        <div className="pg-ev-row">
          <Clock className="h-5 w-5" aria-hidden="true" />
          <div>
            <p style={{ fontWeight: 650 }}>{fmtDate(start)}</p>
            <p className="pg-muted">{when}</p>
          </div>
        </div>
        {(d.venue || d.address) && (
          <div className="pg-ev-row">
            <MapPin className="h-5 w-5" aria-hidden="true" />
            <div>
              {d.venue && <p style={{ fontWeight: 650 }}>{d.venue}</p>}
              {d.address && <p className="pg-muted">{d.address}</p>}
            </div>
          </div>
        )}
      </div>
      {d.description && (
        <div style={{ marginTop: 16 }}>
          <Prose text={d.description} />
        </div>
      )}
      <div style={{ display: 'grid', gap: 10, marginTop: 18, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        {ics && !ended && (
          <a href={ics} download={`${d.title.replace(/[^\w-]+/g, '-').slice(0, 60)}.ics`} className="pg-btn">
            <CalendarPlus className="h-4.5 w-4.5" aria-hidden="true" /> Add to calendar
          </a>
        )}
        {where && (
          <a href={mapsLink(where)} target="_blank" rel="noreferrer" className="pg-btn pg-btn-2">
            <Navigation className="h-4.5 w-4.5" aria-hidden="true" /> Directions
          </a>
        )}
      </div>
      {cta && !ended && (
        <a href={cta} target={cta.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className="pg-btn pg-btn-block pg-btn-2" style={{ marginTop: 10 }}>
          {d.cta?.label || 'Learn more'} <ArrowUpRight className="h-4 w-4" />
        </a>
      )}
      {where && <MapBox query={where} />}
    </Sec>
  )
}

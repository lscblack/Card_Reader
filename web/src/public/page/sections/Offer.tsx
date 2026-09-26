import { useEffect, useState } from 'react'
import { ArrowUpRight, CalendarClock } from 'lucide-react'
import type { SectionDataMap } from '@/business/api/types'
import { safeHref } from '@/lib/url'
import { usePage } from '../ctx'
import { fmtDate, fmtTime, parseWhen } from '../format'
import { Inline, CopyBtn, Prose, Sec } from '../ui'

function useNow(tick: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!tick) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [tick])
  return now
}

function Terms({ text }: { text?: string }) {
  if (!text) return null
  return (
    <details style={{ marginTop: 16, textAlign: 'left' }}>
      <summary className="pg-subtle" style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
        Terms & conditions
      </summary>
      <p className="pg-muted" style={{ fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
        {text}
      </p>
    </details>
  )
}

export function OfferSection({ d }: { d: SectionDataMap['offer'] }) {
  const { layout } = usePage()
  const until = parseWhen(d.valid_until ?? null, true)
  const flash = layout.id === 'offer-flash'
  const now = useNow(flash && !!until)
  const expired = !!until && until.getTime() < now
  const cta = safeHref(d.cta?.url)
  const untilLabel = until ? `${expired ? 'Expired' : 'Valid until'} ${fmtDate(until, { day: 'numeric', month: 'long', year: 'numeric' })}${/T/.test(d.valid_until ?? '') ? `, ${fmtTime(until)}` : ''}` : null

  if (flash) {
    const left = until ? Math.max(0, until.getTime() - now) : 0
    const parts = [Math.floor(left / 86400000), Math.floor(left / 3600000) % 24, Math.floor(left / 60000) % 60, Math.floor(left / 1000) % 60]
    return (
      <Sec bare>
        <div className={`pg-flash${expired ? ' pg-expired' : ''}`}>
          {d.discount_label && <p className="pg-flash-big">{d.discount_label}</p>}
          <h2 className="pg-hf" style={{ fontSize: 22, fontWeight: 700, marginTop: 10, textTransform: 'uppercase' }}>
            {d.title}
          </h2>
          {d.description && <p style={{ marginTop: 6, fontSize: 15, opacity: 0.85 }}><Inline text={d.description} /></p>}
          {until && !expired && (
            <div className="pg-count" role="timer" aria-label={untilLabel ?? undefined}>
              {(['days', 'hours', 'mins', 'secs'] as const).map((l, i) => (
                <div key={l}>
                  <b>{String(parts[i]).padStart(2, '0')}</b>
                  <span>{l}</span>
                </div>
              ))}
            </div>
          )}
          {expired && <p style={{ marginTop: 14, fontWeight: 800, letterSpacing: '0.1em' }}>THIS SALE HAS ENDED</p>}
          {d.code && !expired && (
            <div className="pg-code" style={{ marginTop: 16 }}>
              <span className="pg-code-txt">{d.code}</span>
              <CopyBtn value={d.code} label="Copy code" text />
            </div>
          )}
          {cta && !expired && (
            <a href={cta} target={cta.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className="pg-btn pg-btn-block" style={{ marginTop: 12, background: 'var(--pg-text)', color: 'var(--pg-bg)' }}>
              {d.cta?.label || 'Shop now'} <ArrowUpRight className="h-4 w-4" />
            </a>
          )}
          <div style={{ color: 'inherit' }}>
            <Terms text={d.terms} />
          </div>
        </div>
      </Sec>
    )
  }

  return (
    <Sec bare>
      <div className={`pg-coupon${expired ? ' pg-expired' : ''}`}>
        {expired && <span className="pg-stamp">EXPIRED</span>}
        <div className="pg-coupon-top">
          {d.discount_label && <p className="pg-coupon-big">{d.discount_label}</p>}
          <h2 style={{ fontSize: 23, fontWeight: 700, marginTop: d.discount_label ? 12 : 0, lineHeight: 1.2 }}>{d.title}</h2>
          {d.description && <Prose text={d.description} className="" />}
        </div>
        <div className="pg-coupon-cut" aria-hidden="true">
          <i />
        </div>
        <div className="pg-coupon-bottom">
          {d.code && (
            <>
              <p className="pg-subtle" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
                Your code
              </p>
              <div className="pg-code">
                <span className="pg-code-txt" style={expired ? { textDecoration: 'line-through' } : undefined}>
                  {d.code}
                </span>
                {!expired && <CopyBtn value={d.code} label="Copy code" text />}
              </div>
            </>
          )}
          {untilLabel && (
            <p className={expired ? 'pg-accent' : 'pg-muted'} style={{ marginTop: 14, fontSize: 13.5, display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: expired ? 700 : 500 }}>
              <CalendarClock className="h-4 w-4" aria-hidden="true" /> {untilLabel}
            </p>
          )}
          {cta && !expired && (
            <a href={cta} target={cta.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className="pg-btn pg-btn-block" style={{ marginTop: 16 }}>
              {d.cta?.label || 'Use offer'} <ArrowUpRight className="h-4 w-4" />
            </a>
          )}
          <Terms text={d.terms} />
        </div>
      </div>
    </Sec>
  )
}

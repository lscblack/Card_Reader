import { Fragment, type ReactNode } from 'react'
import { AtSign, Check, Code2, Copy, Ghost, Globe, Link2, Mail, MapPin, MessageCircle, Music2, Phone, Pin, Send } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useCopy } from './hooks'

/** A page section: chrome comes from the layout (`.pg-chrome-*`); `bare` drops it. */
export function Sec({ title, right, bare, className, children, id }: { title?: string | null; right?: ReactNode; bare?: boolean; className?: string; children: ReactNode; id?: string }) {
  return (
    <section className={cn('pg-sec', bare && 'pg-bare', className)} id={id}>
      {title && (
        <div className="pg-h2">
          <h2>{title}</h2>
          {right}
        </div>
      )}
      {children}
    </section>
  )
}

/** Safe Markdown subset: paragraphs, "- " lists, **bold**, *italic*, [text](https://…). No HTML. */
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
        <a key={k} href={m[5]} target="_blank" rel="noreferrer noopener">
          {m[4]}
        </a>,
      )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** One short rich-text value (descriptions): **bold**, *italic*, links and line breaks. */
export function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((l, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {inline(l, `i${i}`)}
        </Fragment>
      ))}
    </>
  )
}

export function Prose({ text, className }: { text: string; className?: string }) {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean)
  return (
    <div className={cn('pg-prose', className)}>
      {blocks.map((b, bi) => {
        const lines = b.split('\n')
        if (lines.every((l) => /^\s*[-*]\s+/.test(l)))
          return (
            <ul key={bi}>
              {lines.map((l, li) => (
                <li key={li}>{inline(l.replace(/^\s*[-*]\s+/, ''), `${bi}-${li}`)}</li>
              ))}
            </ul>
          )
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

export function CopyBtn({ value, label, className, text }: { value: string; label: string; className?: string; text?: boolean | string }) {
  const [copied, copy] = useCopy()
  if (text)
    return (
      <button type="button" className={cn('pg-btn', className)} onClick={() => copy(value)} aria-label={copied ? 'Copied' : label}>
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {copied ? 'Copied' : typeof text === 'string' ? text : 'Copy'}
      </button>
    )
  return (
    <button type="button" className={cn('pg-icon-btn', className)} onClick={() => copy(value)} aria-label={copied ? 'Copied' : label} title={label}>
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </button>
  )
}

/** Neutral pattern tile used where an image is missing (never stock photos). */
export function Placeholder({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn('pg-ph', className)} aria-hidden="true">
      <span style={{ position: 'relative', zIndex: 1 }}>{label}</span>
    </div>
  )
}

const svg = (d: ReactNode, size = 18) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
)

/** Link / platform icons (simple generic glyphs, no brand artwork). */
export function LinkGlyph({ icon, size = 18 }: { icon?: string | null; size?: number }) {
  const p = { width: size, height: size, 'aria-hidden': true } as const
  switch (icon) {
    case 'instagram':
      return svg(
        <>
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
        </>,
        size,
      )
    case 'youtube':
      return svg(
        <>
          <rect x="2.5" y="5" width="19" height="14" rx="4" />
          <path d="M10 9.5v5l4.5-2.5z" fill="currentColor" />
        </>,
        size,
      )
    case 'x':
      return svg(<path d="M4 4l16 16M20 4L4 20" />, size)
    case 'facebook':
      return svg(<path d="M15 3h-2.5A3.5 3.5 0 0 0 9 6.5V10H6.5v3.5H9V21h3.5v-7.5H15l.5-3.5h-3V7a1 1 0 0 1 1-1H15z" />, size)
    case 'linkedin':
      return svg(
        <>
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <path d="M8 10v7M8 7v.01M12 17v-4a2 2 0 0 1 4 0v4M12 10v7" />
        </>,
        size,
      )
    case 'tiktok':
    case 'spotify':
      return <Music2 {...p} />
    case 'github':
      return <Code2 {...p} />
    case 'telegram':
      return <Send {...p} />
    case 'snapchat':
      return <Ghost {...p} />
    case 'pinterest':
      return <Pin {...p} />
    case 'whatsapp':
      return <MessageCircle {...p} />
    case 'phone':
      return <Phone {...p} />
    case 'email':
      return <Mail {...p} />
    case 'map':
      return <MapPin {...p} />
    case 'website':
      return <Globe {...p} />
    case 'other':
      return <AtSign {...p} />
    default:
      return <Link2 {...p} />
  }
}


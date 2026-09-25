import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { AlertTriangle, ArrowLeft, ArrowRight, Info, Lightbulb, Link2, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { docPath, orderedDocs, findDoc } from '../nav'

/** Page header + title handling. `slug` must match an entry in nav.ts. */
export function DocHeader({ slug, children }: { slug: string; children?: ReactNode }) {
  const page = findDoc(slug)
  useDocumentTitle(page ? `${page.title} · Docs` : 'Docs')
  return (
    <header className="mb-8 border-b border-border pb-8">
      <p className="text-[13px] font-semibold text-accent">{page?.group}</p>
      <h1 className="mt-1.5 text-3xl font-semibold tracking-tight text-balance text-fg sm:text-[34px]">{page?.title}</h1>
      {page?.description && <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-muted">{page.description}</p>}
      {children}
    </header>
  )
}

function Anchor({ id }: { id: string }) {
  return (
    <a
      href={`#${id}`}
      className="ml-2 inline-flex translate-y-[-1px] items-center rounded p-0.5 text-subtle opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 hover:text-accent"
      aria-label="Link to this section"
    >
      <Link2 className="h-4 w-4" aria-hidden="true" />
    </a>
  )
}

export function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} data-toc className="group mt-12 mb-3 scroll-mt-24 text-[22px] font-semibold tracking-tight text-fg first:mt-0">
      {children}
      <Anchor id={id} />
    </h2>
  )
}

export function H3({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h3 id={id} data-toc className="group mt-8 mb-2 scroll-mt-24 text-[17px] font-semibold text-fg">
      {children}
      <Anchor id={id} />
    </h3>
  )
}

export function P({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('my-3.5 text-[15px] leading-7 text-muted', className)}>{children}</p>
}

export function UL({ children }: { children: ReactNode }) {
  return <ul className="my-3.5 list-disc space-y-2 pl-5 text-[15px] leading-7 text-muted marker:text-subtle">{children}</ul>
}

export function OL({ children }: { children: ReactNode }) {
  return <ol className="my-3.5 list-decimal space-y-2 pl-5 text-[15px] leading-7 text-muted marker:font-semibold marker:text-subtle">{children}</ol>
}

export function C({ children }: { children: ReactNode }) {
  return <code className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[0.84em] break-words text-fg">{children}</code>
}

export function B({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-fg">{children}</strong>
}

export function DocLink({ to, children }: { to: string; children: ReactNode }) {
  const cls = 'font-medium text-accent underline-offset-2 hover:underline'
  if (/^https?:/.test(to)) {
    return (
      <a href={to} target="_blank" rel="noreferrer" className={cls}>
        {children}
      </a>
    )
  }
  return (
    <Link to={to} className={cls}>
      {children}
    </Link>
  )
}

const tones = {
  note: { icon: Info, cls: 'border-border-strong bg-surface-2', iconCls: 'text-muted', label: 'Note' },
  tip: { icon: Lightbulb, cls: 'border-emerald-500/30 bg-emerald-500/[0.07]', iconCls: 'text-emerald-500', label: 'Tip' },
  warning: { icon: AlertTriangle, cls: 'border-amber-500/35 bg-amber-500/[0.08]', iconCls: 'text-amber-500', label: 'Warning' },
  danger: { icon: ShieldAlert, cls: 'border-accent/40 bg-accent-soft', iconCls: 'text-accent', label: 'Important' },
} as const

export function Callout({ tone = 'note', title, children }: { tone?: keyof typeof tones; title?: string; children: ReactNode }) {
  const t = tones[tone]
  return (
    <aside className={cn('my-5 flex gap-3 rounded-xl border p-4', t.cls)} role="note">
      <t.icon className={cn('mt-0.5 h-5 w-5 shrink-0', t.iconCls)} aria-hidden="true" />
      <div className="min-w-0 text-[14.5px] leading-relaxed text-muted">
        <p className="font-semibold text-fg">{title ?? t.label}</p>
        <div className="mt-1 [&>p+p]:mt-2">{children}</div>
      </div>
    </aside>
  )
}

export function Table({ head, rows, minWidth = 560 }: { head: ReactNode[]; rows: ReactNode[][]; minWidth?: number }) {
  return (
    <div className="my-5 overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-left text-[13.5px]" style={{ minWidth }}>
        <thead className="bg-surface-2">
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className="border-b border-border px-3.5 py-2.5 text-[12px] font-semibold tracking-wide whitespace-nowrap text-subtle uppercase">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              {r.map((c, j) => (
                <td key={j} className={cn('px-3.5 py-2.5 align-top leading-relaxed text-muted', j === 0 && 'font-medium text-fg')}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function PrevNext({ slug }: { slug: string }) {
  const i = orderedDocs.findIndex((p) => p.slug === slug)
  const prev = i > 0 ? orderedDocs[i - 1] : null
  const next = i >= 0 && i < orderedDocs.length - 1 ? orderedDocs[i + 1] : null
  return (
    <nav className="mt-16 grid gap-3 border-t border-border pt-8 sm:grid-cols-2" aria-label="Previous and next page">
      {prev ? (
        <Link to={docPath(prev.slug)} className="group rounded-xl border border-border p-4 transition-colors hover:border-accent/60">
          <span className="flex items-center gap-1 text-[12px] text-subtle">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Previous
          </span>
          <span className="mt-1 block text-[15px] font-semibold text-fg group-hover:text-accent">{prev.title}</span>
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link to={docPath(next.slug)} className="group rounded-xl border border-border p-4 text-right transition-colors hover:border-accent/60">
          <span className="flex items-center justify-end gap-1 text-[12px] text-subtle">
            Next <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <span className="mt-1 block text-[15px] font-semibold text-fg group-hover:text-accent">{next.title}</span>
        </Link>
      )}
    </nav>
  )
}

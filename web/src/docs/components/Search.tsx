import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { CornerDownLeft, FileText, Hash, Search as SearchIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { docPages, docPath } from '../nav'

interface Hit {
  key: string
  title: string
  page: string
  href: string
  kind: 'page' | 'section'
  score: number
}

type Entry = Omit<Hit, 'score'> & { hay: string }

function buildIndex(): Entry[] {
  const out: Entry[] = []
  for (const p of docPages) {
    out.push({
      key: p.slug || 'intro',
      title: p.title,
      page: p.group,
      href: docPath(p.slug),
      kind: 'page',
      hay: `${p.title} ${p.description} ${p.keywords ?? ''}`.toLowerCase(),
    })
    for (const h of p.headings) {
      out.push({
        key: `${p.slug}#${h.id}`,
        title: h.title,
        page: p.title,
        href: `${docPath(p.slug)}#${h.id}`,
        kind: 'section',
        hay: `${h.title} ${p.title}`.toLowerCase(),
      })
    }
  }
  return out
}

const INDEX = buildIndex()

function search(index: Entry[], q: string): Hit[] {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return index.filter((x) => x.kind === 'page').map((x) => ({ ...x, score: 0 }))
  const hits: Hit[] = []
  for (const x of index) {
    let score = 0
    let all = true
    for (const t of terms) {
      const inTitle = x.title.toLowerCase().includes(t)
      if (!inTitle && !x.hay.includes(t)) {
        all = false
        break
      }
      score += inTitle ? 3 : 1
      if (x.title.toLowerCase().startsWith(t)) score += 2
    }
    if (all) hits.push({ ...x, score: score + (x.kind === 'page' ? 1 : 0) })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 20)
}

export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const navigate = useNavigate()
  const results = useMemo(() => search(INDEX, q), [q])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => inputRef.current?.focus(), 10)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      clearTimeout(t)
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const go = (h: Hit) => {
    onClose()
    setQ('')
    setActive(0)
    navigate(h.href)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]" role="dialog" aria-modal="true" aria-label="Search documentation">
      <button type="button" aria-label="Close search" className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-border-strong bg-surface shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border px-4">
          <SearchIcon className="h-5 w-5 shrink-0 text-subtle" aria-hidden="true" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setActive(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(results.length - 1, a + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(0, a - 1))
              } else if (e.key === 'Enter' && results[active]) {
                e.preventDefault()
                go(results[active])
              }
            }}
            placeholder="Search docs — e.g. signature, pairing, NFC-1003"
            className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-subtle"
            role="combobox"
            aria-expanded="true"
            aria-controls="docs-search-results"
            aria-activedescendant={results[active] ? `dsr-${active}` : undefined}
            aria-autocomplete="list"
          />
          <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-[11px] text-subtle sm:inline">Esc</kbd>
        </div>
        <ul ref={listRef} id="docs-search-results" role="listbox" className="max-h-[55vh] overflow-y-auto p-2">
          {results.length === 0 && <li className="px-3 py-8 text-center text-[14px] text-subtle">No results for “{q}”</li>}
          {results.map((h, i) => (
            <li
              key={h.key}
              id={`dsr-${i}`}
              role="option"
              aria-selected={i === active}
              data-active={i === active}
              onMouseMove={() => setActive(i)}
              onClick={() => go(h)}
              className={cn('flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5', i === active ? 'bg-accent-soft' : 'hover:bg-surface-2')}
            >
              {h.kind === 'page' ? (
                <FileText className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
              ) : (
                <Hash className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <p className={cn('truncate text-[14px] font-medium', i === active ? 'text-accent' : 'text-fg')}>{h.title}</p>
                <p className="truncate text-[12px] text-subtle">{h.page}</p>
              </div>
              {i === active && <CornerDownLeft className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

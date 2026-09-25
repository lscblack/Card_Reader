import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { CopyButton } from './CopyButton'

export interface CodeSample {
  label: string
  language: string
  code: string
}

/** Very light highlighting: comments and strings only. Keeps the bundle small. */
function highlight(code: string, language: string): ReactNode[] {
  const commentRe = ['python', 'bash', 'shell', 'yaml'].includes(language) ? /#[^\n]*/ : /\/\/[^\n]*/
  const re = new RegExp(`(${commentRe.source})|("(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*'|\`[^\`]*\`)`, 'gm')
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(code))) {
    if (m.index > last) out.push(code.slice(last, m.index))
    out.push(
      <span key={i++} className={m[1] ? 'text-zinc-500 italic' : 'text-emerald-300'}>
        {m[0]}
      </span>,
    )
    last = m.index + m[0].length
    if (m[0].length === 0) re.lastIndex++
  }
  if (last < code.length) out.push(code.slice(last))
  return out
}

export function CodeBlock({ code, language = 'text', title, className }: { code: string; language?: string; title?: string; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-xl border border-zinc-800 bg-code-bg text-code-fg', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-1.5">
        <span className="truncate text-xs text-zinc-400">{title ?? language}</span>
        <CopyButton value={code} className="text-zinc-400 hover:bg-white/10 hover:text-white" showLabel />
      </div>
      <pre className="overflow-x-auto p-4 text-[12.5px] leading-relaxed">
        <code>{highlight(code, language)}</code>
      </pre>
    </div>
  )
}

export function CodeTabs({ samples, className }: { samples: CodeSample[]; className?: string }) {
  const [active, setActive] = useState(0)
  const s = samples[active] ?? samples[0]
  return (
    <div className={cn('overflow-hidden rounded-xl border border-zinc-800 bg-code-bg text-code-fg', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-white/10 pr-2">
        <div className="flex min-w-0 overflow-x-auto" role="tablist">
          {samples.map((x, i) => (
            <button
              key={x.label}
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={cn(
                'border-b-2 px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors',
                i === active ? 'border-red-500 text-white' : 'border-transparent text-zinc-400 hover:text-zinc-200',
              )}
            >
              {x.label}
            </button>
          ))}
        </div>
        <CopyButton value={s.code} className="text-zinc-400 hover:bg-white/10 hover:text-white" showLabel />
      </div>
      <pre className="overflow-x-auto p-4 text-[12.5px] leading-relaxed">
        <code>{highlight(s.code, s.language)}</code>
      </pre>
    </div>
  )
}

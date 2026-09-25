import { useId, useSyncExternalStore, type ReactNode } from 'react'
import { CopyButton } from '@/components/ui/CopyButton'
import { cn } from '@/lib/cn'

export interface Sample {
  label: string
  language: string
  code: string
}

const KEYWORDS = new Set(
  (
    'import from export default const let var function return if else elif for while in of new async await def class try except catch finally ' +
    'raise throw not and or is None True False null true false this self echo use namespace public private static fn lambda with as ' +
    'func package var val fun let mut struct impl match using await async end do require'
  ).split(' '),
)

/** Tiny highlighter: comments, strings, keywords, numbers. Keeps the bundle small. */
function highlight(code: string, language: string): ReactNode[] {
  const hashComments = ['python', 'bash', 'shell', 'sh', 'yaml', 'curl', 'http', 'text', 'ruby'].includes(language)
  const comment = hashComments ? String.raw`#[^\n]*` : String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/`
  const re = new RegExp(
    `(${comment})|("(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*'|\`[^\`]*\`)|\\b(\\d+(?:\\.\\d+)?)\\b|\\b([A-Za-z_][A-Za-z0-9_]*)\\b`,
    'gm',
  )
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  const noKeywords = language === 'json' || language === 'http' || language === 'text'
  while ((m = re.exec(code))) {
    if (m[4] && (noKeywords || !KEYWORDS.has(m[4]))) continue
    if (m.index > last) out.push(code.slice(last, m.index))
    const cls = m[1] ? 'text-[#8f8888] italic' : m[2] ? 'text-[#86efac]' : m[3] ? 'text-[#fcd34d]' : 'text-[#fca5a5]'
    out.push(
      <span key={i++} className={cls}>
        {m[0]}
      </span>,
    )
    last = m.index + m[0].length
    if (m[0].length === 0) re.lastIndex++
  }
  if (last < code.length) out.push(code.slice(last))
  return out
}

// ---- shared language preference (choosing Python once switches every tab group) ----
const LANG_KEY = 'nfc.docs.lang'
let preferred: string = (() => {
  try {
    return localStorage.getItem(LANG_KEY) ?? ''
  } catch {
    return ''
  }
})()
const listeners = new Set<() => void>()
function setPreferred(label: string) {
  preferred = label
  try {
    localStorage.setItem(LANG_KEY, label)
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l())
}
function usePreferredLang(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => preferred,
  )
}

const frame = 'overflow-hidden rounded-xl border border-white/10 bg-code-bg text-code-fg shadow-sm'
const copyCls = 'text-[#b3acac] hover:bg-white/10 hover:text-white'

export function CodeBlock({ code, language = 'text', title, className }: { code: string; language?: string; title?: string; className?: string }) {
  return (
    <div className={cn(frame, 'my-4', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-1.5">
        <span className="truncate font-mono text-[11.5px] text-[#b3acac]">{title ?? language}</span>
        <CopyButton value={code} className={copyCls} showLabel />
      </div>
      <pre className="overflow-x-auto p-4 text-[12.5px] leading-relaxed [tab-size:4]">
        <code>{highlight(code, language)}</code>
      </pre>
    </div>
  )
}

export function CodeTabs({ samples, title, className }: { samples: Sample[]; title?: string; className?: string }) {
  const pref = usePreferredLang()
  const id = useId()
  // "curl" (API calls) and "Shell" (openssl snippets) count as the same preference.
  const alias: Record<string, string> = { curl: 'Shell', Shell: 'curl' }
  let found = samples.findIndex((s) => s.label === pref)
  if (found < 0 && alias[pref]) found = samples.findIndex((s) => s.label === alias[pref])
  const idx = Math.max(0, found)
  const s = samples[idx]
  return (
    <div className={cn(frame, 'my-4', className)}>
      <div className="flex items-center justify-between gap-2 border-b border-white/10 pr-2">
        <div className="flex min-w-0 items-center overflow-x-auto" role="tablist" aria-label={title ?? 'Code language'}>
          {title && <span className="hidden shrink-0 border-r border-white/10 px-3 font-mono text-[11.5px] text-[#8f8888] sm:inline">{title}</span>}
          {samples.map((x, i) => (
            <button
              key={x.label}
              id={`${id}-tab-${i}`}
              type="button"
              role="tab"
              aria-selected={i === idx}
              aria-controls={`${id}-panel`}
              onClick={() => setPreferred(x.label)}
              className={cn(
                'border-b-2 px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors',
                i === idx ? 'border-[var(--accent)] text-white' : 'border-transparent text-[#b3acac] hover:text-white',
              )}
            >
              {x.label}
            </button>
          ))}
        </div>
        <CopyButton value={s.code} className={copyCls} showLabel />
      </div>
      <pre id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${idx}`} className="overflow-x-auto p-4 text-[12.5px] leading-relaxed [tab-size:4]">
        <code>{highlight(s.code, s.language)}</code>
      </pre>
    </div>
  )
}

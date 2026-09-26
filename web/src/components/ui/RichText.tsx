import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Bold, Italic, Link2, List, RemoveFormatting } from 'lucide-react'
import { cn } from '@/lib/cn'

/*
 * Small WYSIWYG editor that reads and writes the safe Markdown subset every page renderer understands:
 * paragraphs, "- " lists, **bold**, *italic* and [text](https://…). No raw HTML is ever stored.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function inlineHtml(s: string) {
  return esc(s)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*]+)\*/g, '<i>$1</i>')
}

export function mdToHtml(md: string, inline = false): string {
  if (!md) return ''
  if (inline) return md.split('\n').map(inlineHtml).join('<br>')
  return md
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split('\n')
      if (lines.every((l) => /^\s*[-*]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${inlineHtml(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`
      return `<p>${lines.map(inlineHtml).join('<br>')}</p>`
    })
    .join('')
}

function inlineMd(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/ /g, ' ')
  if (!(node instanceof HTMLElement)) return ''
  const inner = () => Array.from(node.childNodes).map(inlineMd).join('')
  const tag = node.tagName
  if (tag === 'BR') return '\n'
  const style = node.getAttribute('style') ?? ''
  const bold = tag === 'B' || tag === 'STRONG' || /font-weight:\s*(bold|[6-9]00)/.test(style)
  const italic = tag === 'I' || tag === 'EM' || /font-style:\s*italic/.test(style)
  let text = inner()
  if (!text.trim()) return text
  if (tag === 'A') {
    const href = node.getAttribute('href') ?? ''
    return /^https?:\/\//.test(href) ? `[${text}](${href})` : text
  }
  // Keep surrounding spaces outside the markers, or the Markdown won't parse back.
  const wrap = (m: string) => {
    const lead = text.match(/^\s*/)![0]
    const trail = text.match(/\s*$/)![0]
    text = `${lead}${m}${text.trim()}${m}${trail}`
  }
  if (italic) wrap('*')
  if (bold) wrap('**')
  return text
}

export function htmlToMd(root: HTMLElement, inline = false): string {
  const blocks: string[] = []
  let para = ''
  const flush = () => {
    if (para.trim()) blocks.push(para.replace(/[ \t]+\n/g, '\n').trim())
    para = ''
  }
  root.childNodes.forEach((n) => {
    if (n instanceof HTMLElement && (n.tagName === 'UL' || n.tagName === 'OL')) {
      flush()
      const items = Array.from(n.querySelectorAll('li')).map((li) => `- ${inlineMd(li).replace(/\n+/g, ' ').trim()}`).filter((l) => l !== '- ')
      if (items.length) blocks.push(items.join('\n'))
    } else if (n instanceof HTMLElement && (n.tagName === 'P' || n.tagName === 'DIV')) {
      // Chrome/Safari wrap each new line in a <div>; consecutive divs are lines of one paragraph unless empty.
      const t = inlineMd(n)
      if (!t.trim()) flush()
      else para += (para ? '\n' : '') + t.replace(/\n$/, '')
    } else {
      para += inlineMd(n)
    }
  })
  flush()
  const md = blocks.join('\n\n').replace(/\n{3,}/g, '\n\n')
  return inline ? md.replace(/\n{2,}/g, '\n') : md
}

export interface RichTextProps {
  value: string
  onChange: (md: string) => void
  placeholder?: string
  /** Minimum height in text lines. */
  rows?: number
  /** No lists or paragraphs — bold, italic, links and line breaks only (short descriptions). */
  inline?: boolean
  maxLength?: number
  disabled?: boolean
  className?: string
  id?: string
  'aria-label'?: string
  'aria-describedby'?: string
}

export function RichText({ value, onChange, placeholder, rows = 3, inline = false, maxLength, disabled, className, id, ...aria }: RichTextProps) {
  const ref = useRef<HTMLDivElement>(null)
  const last = useRef<string | null>(null)
  const [linking, setLinking] = useState<string | null>(null)
  const [active, setActive] = useState({ bold: false, italic: false, list: false })
  const [focused, setFocused] = useState(false)
  const autoId = useId()

  // Only rewrite the DOM when the value changed from outside, so the caret never jumps while typing.
  useEffect(() => {
    const el = ref.current
    if (!el || value === last.current) return
    el.innerHTML = mdToHtml(value, inline)
    last.current = value
  }, [value, inline])

  const emit = () => {
    const el = ref.current
    if (!el) return
    let md = htmlToMd(el, inline)
    if (maxLength && md.length > maxLength) md = md.slice(0, maxLength)
    last.current = md
    if (md !== value) onChange(md)
  }

  const refreshState = () => {
    try {
      setActive({ bold: document.queryCommandState('bold'), italic: document.queryCommandState('italic'), list: document.queryCommandState('insertUnorderedList') })
    } catch {
      /* unsupported */
    }
  }

  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus()
    document.execCommand(cmd, false, arg)
    emit()
    refreshState()
  }

  const saved = useRef<Range | null>(null)
  const startLink = () => {
    const sel = window.getSelection()
    saved.current = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null
    setLinking('https://')
  }
  const applyLink = () => {
    const url = (linking ?? '').trim()
    setLinking(null)
    if (!/^https?:\/\/\S+\.\S+/.test(url)) return
    ref.current?.focus()
    const sel = window.getSelection()
    if (saved.current && sel) {
      sel.removeAllRanges()
      sel.addRange(saved.current)
    }
    if (sel && sel.isCollapsed) document.execCommand('insertHTML', false, `<a href="${esc(url)}">${esc(url.replace(/^https?:\/\//, ''))}</a>`)
    else document.execCommand('createLink', false, url)
    emit()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 'b') {
      e.preventDefault()
      exec('bold')
    } else if (mod && e.key.toLowerCase() === 'i') {
      e.preventDefault()
      exec('italic')
    } else if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      startLink()
    } else if (inline && e.key === 'Enter') {
      e.preventDefault()
      document.execCommand('insertLineBreak')
      emit()
    }
  }

  const btn = (label: string, on: boolean, onClick: () => void, Icon: typeof Bold) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={on}
      disabled={disabled}
      // Keep the text selection: act on mousedown, before the editor loses focus.
      onMouseDown={(e) => {
        e.preventDefault()
        onClick()
      }}
      className={cn('inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg sm:h-7 sm:w-7', on && 'bg-surface-2 text-fg')}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  )

  const empty = !value.trim()
  return (
    <div
      className={cn(
        'rounded-lg border border-border-strong bg-surface shadow-xs transition-colors',
        focused && 'border-accent ring-3 ring-accent/20',
        disabled && 'opacity-60',
        className,
      )}
    >
      <div className="flex items-center gap-0.5 border-b border-border px-1 py-0.5" role="toolbar" aria-label="Text formatting" aria-controls={id ?? autoId}>
        {btn('Bold (Ctrl+B)', active.bold, () => exec('bold'), Bold)}
        {btn('Italic (Ctrl+I)', active.italic, () => exec('italic'), Italic)}
        {btn('Link (Ctrl+K)', false, startLink, Link2)}
        {!inline && btn('Bulleted list', active.list, () => exec('insertUnorderedList'), List)}
        {btn('Clear formatting', false, () => exec('removeFormat'), RemoveFormatting)}
        {maxLength && value.length > maxLength * 0.8 && <span className="ml-auto pr-1.5 text-[11px] text-subtle tabular-nums">{value.length}/{maxLength}</span>}
      </div>
      {linking != null && (
        <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
          <input
            autoFocus
            type="url"
            value={linking}
            onChange={(e) => setLinking(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                applyLink()
              } else if (e.key === 'Escape') setLinking(null)
            }}
            aria-label="Link address"
            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2 text-[13px] outline-none focus:border-accent"
          />
          <button type="button" onClick={applyLink} className="h-8 rounded-md bg-accent-solid px-2.5 text-[12.5px] font-medium text-accent-fg">
            Add link
          </button>
          <button type="button" onClick={() => setLinking(null)} className="h-8 rounded-md px-2 text-[12.5px] text-muted hover:text-fg">
            Cancel
          </button>
        </div>
      )}
      <div className="relative">
        {empty && placeholder && !focused && <p className="pointer-events-none absolute top-2 left-3 text-sm text-subtle">{placeholder}</p>}
        <div
          ref={ref}
          id={id ?? autoId}
          role="textbox"
          aria-multiline="true"
          aria-label={aria['aria-label']}
          aria-describedby={aria['aria-describedby']}
          aria-placeholder={placeholder}
          contentEditable={!disabled}
          suppressContentEditableWarning
          onInput={emit}
          onKeyDown={onKeyDown}
          onKeyUp={refreshState}
          onMouseUp={refreshState}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            emit()
          }}
          onPaste={(e) => {
            // Paste as plain text: keeps foreign HTML (fonts, colours, scripts) out of the content.
            e.preventDefault()
            document.execCommand('insertText', false, e.clipboardData.getData('text/plain'))
          }}
          style={{ minHeight: `${rows * 1.5 + 1}rem` }}
          className="rt-body max-h-[50vh] overflow-y-auto px-3 py-2 text-sm leading-6 text-fg outline-none [&_a]:text-accent [&_a]:underline [&_li]:ml-4 [&_li]:list-disc [&_p+p]:mt-2 [&_ul]:my-1"
        />
      </div>
    </div>
  )
}

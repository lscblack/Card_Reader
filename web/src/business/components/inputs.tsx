import { useRef, useState, type KeyboardEvent } from 'react'
import { Download, ExternalLink, ImagePlus, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { CopyButton } from '@/components/ui/CopyButton'
import { QrCode } from '@/components/QrCode'
import { cn } from '@/lib/cn'
import type { AnalyticsRange, SocialLink } from '../api/types'
import { checkImage } from '../api/upload'
import { RANGES, SOCIAL_PLATFORMS } from '../lib/format'
import { Avatar } from './bits'


export function RangePicker({ value, onChange, className }: { value: AnalyticsRange; onChange: (v: AnalyticsRange) => void; className?: string }) {
  return (
    <div className={cn('inline-flex rounded-lg border border-border bg-surface-2 p-0.5', className)} role="radiogroup" aria-label="Date range">
      {RANGES.map((r) => (
        <button
          key={r.value}
          type="button"
          role="radio"
          aria-checked={value === r.value}
          onClick={() => onChange(r.value)}
          className={cn(
            'h-7 rounded-md px-2.5 text-[12.5px] font-medium whitespace-nowrap transition-colors',
            value === r.value ? 'bg-surface text-fg shadow-xs ring-1 ring-border' : 'text-muted hover:text-fg',
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}

function downloadSvg(container: HTMLElement | null, filename: string) {
  const svg = container?.querySelector('svg')
  if (!svg) return
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Public URL with copy / open / QR (+ SVG download). */
export function UrlQrPanel({ url, label, filename, qrSize = 168, hint }: { url: string; label: string; filename: string; qrSize?: number; hint?: string }) {
  const qrRef = useRef<HTMLDivElement>(null)
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <div ref={qrRef} className="shrink-0 self-center sm:self-start">
        <QrCode value={url} size={qrSize} label={`QR code for ${label}`} />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-[13px] font-medium">{label}</p>
        <div className="flex items-center gap-1 rounded-lg border border-border-strong bg-surface-2 py-1 pr-1 pl-3">
          <code className="min-w-0 flex-1 overflow-x-auto py-1 text-[12.5px] whitespace-nowrap select-all" translate="no">
            {url}
          </code>
          <CopyButton value={url} label="Copy link" showLabel />
        </div>
        {hint && <p className="text-xs text-subtle">{hint}</p>}
        <div className="flex flex-wrap gap-2">
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-2.5 text-[13px] font-medium hover:bg-surface-2">
            <ExternalLink className="h-3.5 w-3.5" /> Open
          </a>
          <Button size="sm" leftIcon={<Download className="h-3.5 w-3.5" />} onClick={() => downloadSvg(qrRef.current, `${filename}.svg`)}>
            Download QR
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Image picker with client-side validation (png/jpeg/webp ≤ 2 MB). Uploads via `onUpload`. */
export function ImageUpload({
  name,
  src,
  onUpload,
  loading,
  disabled,
  shape = 'circle',
  label = 'Upload photo',
  onError,
}: {
  name: string
  src: string | null
  onUpload: (f: File) => void
  loading?: boolean
  disabled?: boolean
  shape?: 'circle' | 'square'
  label?: string
  onError: (msg: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="flex items-center gap-4">
      {shape === 'circle' ? (
        <Avatar name={name || '?'} src={src} size={64} />
      ) : src ? (
        <img src={src} alt="" className="h-16 w-16 rounded-xl object-cover ring-1 ring-border" />
      ) : (
        <span className="flex h-16 w-16 items-center justify-center rounded-xl border border-dashed border-border-strong bg-surface-2 text-subtle">
          <ImagePlus className="h-6 w-6" />
        </span>
      )}
      <div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            const err = checkImage(f)
            if (err) onError(err)
            else onUpload(f)
          }}
        />
        <Button size="sm" leftIcon={<ImagePlus className="h-3.5 w-3.5" />} loading={loading} disabled={disabled} onClick={() => inputRef.current?.click()}>
          {src ? 'Replace' : label}
        </Button>
        <p className="mt-1 text-xs text-subtle">PNG, JPEG or WebP, up to 2 MB.</p>
      </div>
    </div>
  )
}

let linkSeq = 1
type Row = SocialLink & { _id: number }

export function SocialLinksEditor({ value, onChange, max = 10 }: { value: SocialLink[]; onChange: (v: SocialLink[]) => void; max?: number }) {
  const [rows, setRows] = useState<Row[]>(() => value.map((l) => ({ ...l, _id: linkSeq++ })))
  const commit = (next: Row[]) => {
    setRows(next)
    onChange(next.map(({ platform, url }) => ({ platform, url })))
  }
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r._id} className="flex flex-col gap-2 min-[480px]:flex-row">
          <Select
            aria-label="Platform"
            value={r.platform}
            onChange={(e) => commit(rows.map((x) => (x._id === r._id ? { ...x, platform: e.target.value } : x)))}
            className="min-[480px]:w-36"
          >
            {SOCIAL_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p === 'x' ? 'X (Twitter)' : p.charAt(0).toUpperCase() + p.slice(1)}
              </option>
            ))}
          </Select>
          <div className="flex min-w-0 flex-1 gap-2">
            <Input
              aria-label="Profile URL"
              type="url"
              placeholder="https://"
              value={r.url}
              onChange={(e) => commit(rows.map((x) => (x._id === r._id ? { ...x, url: e.target.value } : x)))}
            />
            <Button size="icon" variant="ghost" aria-label="Remove link" onClick={() => commit(rows.filter((x) => x._id !== r._id))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}
      {rows.length < max && (
        <Button size="sm" variant="ghost" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => commit([...rows, { platform: 'linkedin', url: '', _id: linkSeq++ }])}>
          Add link
        </Button>
      )}
    </div>
  )
}

export function TagsInput({ value, onChange, id, placeholder = 'Type and press Enter' }: { value: string[]; onChange: (v: string[]) => void; id?: string; placeholder?: string }) {
  const [text, setText] = useState('')
  const add = () => {
    const t = text.trim().replace(/,$/, '')
    if (t && !value.includes(t)) onChange([...value, t])
    setText('')
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add()
    } else if (e.key === 'Backspace' && !text && value.length) {
      onChange(value.slice(0, -1))
    }
  }
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-2 py-1 shadow-xs focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/20">
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-xs font-medium ring-1 ring-border">
          {t}
          <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((x) => x !== t))} className="text-subtle hover:text-fg">
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        onBlur={add}
        placeholder={value.length ? '' : placeholder}
        className="h-7 min-w-[120px] flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
      />
    </div>
  )
}

import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { AlertTriangle, EyeOff, Globe, Lock, Users, ZoomIn } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import type { Visibility } from '../api/types'
import { contrast } from '../lib/design'

const COLOR_PRESETS = ['#b91c1c', '#dc2626', '#be123c', '#ea580c', '#d97706', '#15803d', '#0f766e', '#0369a1', '#1d4ed8', '#334155', '#1c1717', '#ffffff']

/** Colour picker: presets + native picker + hex input. Optional contrast hint against `against`. */
export function ColorField({ label, value, onChange, against, againstLabel, disabled }: { label: string; value: string; onChange: (v: string) => void; against?: string; againstLabel?: string; disabled?: boolean }) {
  const [text, setText] = useState(value)
  const [prev, setPrev] = useState(value)
  if (prev !== value) {
    setPrev(value)
    setText(value)
  }
  const ratio = against ? contrast(value, against) : null
  return (
    <fieldset disabled={disabled} className="space-y-1.5 disabled:opacity-60">
      <legend className="text-[13px] font-medium">{label}</legend>
      <div className="flex flex-wrap items-center gap-1.5">
        {COLOR_PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`${label}: ${c}`}
            aria-pressed={value.toLowerCase() === c}
            onClick={() => onChange(c)}
            className={cn('h-6 w-6 rounded-full ring-offset-2 ring-offset-surface transition', value.toLowerCase() === c ? 'ring-2 ring-fg' : 'ring-1 ring-black/15 hover:scale-110')}
            style={{ background: c }}
          />
        ))}
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} aria-label={`${label}: custom colour`} className="h-7 w-9 cursor-pointer rounded border border-border-strong bg-surface" />
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase())
          }}
          aria-label={`${label}: hex value`}
          className="h-7 w-[84px] rounded-md border border-border-strong bg-surface px-2 font-mono text-xs"
          maxLength={7}
        />
      </div>
      {ratio != null && ratio < 4.5 && (
        <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5" /> Low contrast with {againstLabel ?? 'the background'} ({ratio.toFixed(1)}:1). Aim for 4.5:1 so it’s easy to read.
        </p>
      )}
    </fieldset>
  )
}

const VIS: { value: Visibility; label: string; icon: typeof Globe; hint: string }[] = [
  { value: 'public', label: 'Public', icon: Globe, hint: 'Anyone with your link or who taps your phone' },
  { value: 'contacts', label: 'Contacts', icon: Users, hint: 'Only people you exchange cards with' },
  { value: 'hidden', label: 'Hidden', icon: EyeOff, hint: 'Nobody — kept private' },
]

/** Three-state visibility control with clear icons. */
export function VisibilityToggle({ value, onChange, label, disabled }: { value: Visibility; onChange: (v: Visibility) => void; label: string; disabled?: boolean }) {
  return (
    <div className="inline-flex shrink-0 rounded-lg border border-border bg-surface-2 p-0.5" role="radiogroup" aria-label={`${label} visibility`}>
      {VIS.map((v) => (
        <button
          key={v.value}
          type="button"
          role="radio"
          aria-checked={value === v.value}
          aria-label={`${v.label}: ${v.hint}`}
          title={`${v.label} — ${v.hint}`}
          disabled={disabled}
          onClick={() => onChange(v.value)}
          className={cn(
            'inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium transition-colors disabled:opacity-50',
            value === v.value ? (v.value === 'hidden' ? 'bg-surface text-fg shadow-xs ring-1 ring-border' : 'bg-surface text-accent shadow-xs ring-1 ring-border') : 'text-muted hover:text-fg',
          )}
        >
          <v.icon className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{v.label}</span>
        </button>
      ))}
    </div>
  )
}

export function LockedHint({ business }: { business: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-subtle" title={`Managed by ${business}`}>
      <Lock className="h-3 w-3" /> Managed by {business}
    </span>
  )
}

/**
 * Minimal image cropper (canvas, no dependencies): drag to position, slider to zoom. Produces a WebP/PNG File
 * of `outW`×`outH` pixels.
 */
export function ImageCropModal({ file, aspect, outW, outH, round, onClose, onDone, title }: { file: File | null; aspect: number; outW: number; outH: number; round?: boolean; onClose: () => void; onDone: (f: File) => void; title: string }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const FRAME_W = 320
  const FRAME_H = Math.round(FRAME_W / aspect)

  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    const i = new Image()
    i.onload = () => {
      setImg(i)
      setZoom(1)
      setPos({ x: 0, y: 0 })
    }
    i.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  // Scale so the image covers the frame at zoom 1.
  const base = img ? Math.max(FRAME_W / img.width, FRAME_H / img.height) : 1
  const scale = base * zoom
  const w = img ? img.width * scale : 0
  const h = img ? img.height * scale : 0
  const clamp = (p: { x: number; y: number }) => ({ x: Math.min(0, Math.max(FRAME_W - w, p.x)), y: Math.min(0, Math.max(FRAME_H - h, p.y)) })
  const offset = img ? clamp({ x: (FRAME_W - w) / 2 + pos.x, y: (FRAME_H - h) / 2 + pos.y }) : { x: 0, y: 0 }

  const onDown = (e: RPointerEvent) => {
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }
  }
  const onMove = (e: RPointerEvent) => {
    if (!drag.current) return
    setPos({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y })
  }

  async function done() {
    if (!img || !file) return
    setBusy(true)
    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')!
    const k = outW / FRAME_W
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, offset.x * k, offset.y * k, w * k, h * k)
    const type = file.type === 'image/png' ? 'image/png' : 'image/webp'
    canvas.toBlob(
      (blob) => {
        setBusy(false)
        if (blob) onDone(new File([blob], file.name.replace(/\.\w+$/, '') + (type === 'image/png' ? '.png' : '.webp'), { type }))
      },
      type,
      0.9,
    )
  }

  return (
    <Modal
      open={!!file}
      onClose={onClose}
      title={title}
      description="Drag to position, use the slider to zoom."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={done} loading={busy} disabled={!img}>
            Use image
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4">
        <div
          className={cn('relative touch-none overflow-hidden bg-surface-3 select-none', round ? 'rounded-full' : 'rounded-xl')}
          style={{ width: FRAME_W, height: FRAME_H, maxWidth: '100%' }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={() => (drag.current = null)}
        >
          {img && <img src={img.src} alt="" draggable={false} className="pointer-events-none absolute max-w-none cursor-grab" style={{ width: w, height: h, left: offset.x, top: offset.y }} />}
        </div>
        <label className="flex w-full max-w-[320px] items-center gap-3 text-xs text-muted">
          <ZoomIn className="h-4 w-4 shrink-0" />
          <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-full accent-[var(--accent)]" aria-label="Zoom" />
        </label>
      </div>
    </Modal>
  )
}

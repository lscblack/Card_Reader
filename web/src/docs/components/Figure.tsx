import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Maximize2, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Screenshot } from '@/marketing/components/Screenshot'
import type { ScreenName } from '@/marketing/assets/screens'

function Lightbox({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      prev?.focus()
    }
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="animate-fade-in fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-8" role="dialog" aria-modal="true" aria-label={label}>
      <button type="button" aria-label="Close" className="absolute inset-0 cursor-zoom-out bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative max-h-full w-full max-w-6xl overflow-auto rounded-xl bg-surface shadow-2xl">
        {children}
      </div>
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        className="absolute top-3 right-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
        aria-label="Close enlarged view"
      >
        <X className="h-5 w-5" />
      </button>
    </div>,
    document.body,
  )
}

/**
 * Captioned, zoomable figure. Pass `shot` for a theme-aware product screenshot, or children for a diagram.
 * `narrow` limits phone-sized screenshots to a sensible width.
 */
export function Figure({
  caption,
  shot,
  children,
  narrow = false,
  scroll = false,
  className,
}: {
  caption: ReactNode
  shot?: ScreenName
  children?: ReactNode
  narrow?: boolean
  /** Diagrams: keep a minimum width and scroll horizontally on small screens. */
  scroll?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const capId = useId()
  const content = shot ? <Screenshot name={shot} /> : children
  return (
    <figure className={cn('my-7', narrow && 'mx-auto max-w-[300px]', className)} aria-labelledby={capId}>
      <div className="group relative overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className={cn(scroll && 'overflow-x-auto')}>
          <div className={cn(scroll && 'min-w-[600px]', !shot && 'p-3 sm:p-5')}>{content}</div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md border border-border bg-surface/90 px-2 py-1 text-[11.5px] font-medium text-muted opacity-100 shadow-sm backdrop-blur transition-opacity hover:text-fg sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
          aria-label="Enlarge figure"
        >
          <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" /> Zoom
        </button>
      </div>
      <figcaption id={capId} className="mt-2.5 text-center text-[13px] leading-relaxed text-subtle">
        {caption}
      </figcaption>
      <Lightbox open={open} onClose={() => setOpen(false)} label={typeof caption === 'string' ? caption : 'Enlarged figure'}>
        <div className={cn(shot ? '' : 'min-w-[720px] p-6', narrow && 'mx-auto max-w-[420px]')}>{content}</div>
      </Lightbox>
    </figure>
  )
}

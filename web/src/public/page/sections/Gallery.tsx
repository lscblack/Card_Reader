import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { SectionDataMap } from '@/business/api/types'
import { usePage } from '../ctx'
import { imgSrc } from '../format'
import { Placeholder, Sec } from '../ui'

function Lightbox({ images, captions, index, onClose, onIndex }: { images: string[]; captions?: string[]; index: number; onClose: () => void; onIndex: (i: number) => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const touch = useRef<number | null>(null)
  const n = images.length
  const go = useCallback((d: number) => onIndex((index + d + n) % n), [index, n, onIndex])
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [go, onClose])
  return createPortal(
    <div
      className="pg-lb"
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${index + 1} of ${n}`}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touch.current == null) return
        const dx = e.changedTouches[0].clientX - touch.current
        if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1)
        touch.current = null
      }}
    >
      <img src={images[index]} alt={captions?.[index] ?? `Photo ${index + 1}`} />
      <button ref={closeRef} type="button" className="pg-lb-btn" style={{ top: 14, right: 14 }} onClick={onClose} aria-label="Close">
        <X className="h-5 w-5" />
      </button>
      {n > 1 && (
        <>
          <button type="button" className="pg-lb-btn" style={{ left: 12, top: '50%', transform: 'translateY(-50%)' }} onClick={() => go(-1)} aria-label="Previous photo">
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button type="button" className="pg-lb-btn" style={{ right: 12, top: '50%', transform: 'translateY(-50%)' }} onClick={() => go(1)} aria-label="Next photo">
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      )}
      <p className="pg-lb-cap">
        {captions?.[index] ? `${captions[index]} · ` : ''}
        {index + 1} / {n}
      </p>
    </div>,
    document.body,
  )
}

export function GallerySection({ d, title }: { d: SectionDataMap['gallery']; title?: string | null }) {
  const { preview } = usePage()
  const [open, setOpen] = useState<number | null>(null)
  const images = (d.images ?? []).map((u) => imgSrc(u)).filter((u): u is string => !!u)
  if (!images.length) {
    if (!preview) return null
    return (
      <Sec title={title} bare>
        <div className="pg-gal">
          {Array.from({ length: 6 }, (_, i) => (
            <button key={i} type="button" tabIndex={-1} aria-hidden="true">
              <Placeholder label={i === 0 ? 'Your photos here' : ''} />
            </button>
          ))}
        </div>
      </Sec>
    )
  }
  return (
    <Sec title={title} bare>
      <div className="pg-gal">
        {images.map((src, i) => (
          <button key={i} type="button" onClick={() => setOpen(i)} aria-label={`Open photo ${i + 1}`}>
            <img src={src} alt={d.captions?.[i] ?? ''} loading="lazy" />
          </button>
        ))}
      </div>
      {open != null && <Lightbox images={images} captions={d.captions} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </Sec>
  )
}

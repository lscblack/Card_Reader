import { useCallback, useEffect, useLayoutEffect, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'

const MARGIN = 8 // keep floating panels this far from the viewport edge
const GAP = 4 // space between the anchor and the panel

export interface FloatingOptions {
  /** Which anchor edge the panel lines up with. */
  align?: 'left' | 'right'
  /** Make the panel at least as wide as the anchor (selects, switchers). */
  matchWidth?: boolean
  /** Upper bound for the panel height; it also shrinks to the space available. */
  maxHeight?: number
}

/**
 * Positions a panel next to `anchorRef` using fixed coordinates, so it is never clipped by an
 * `overflow: hidden/auto` ancestor (cards, tables, drawers, modals). Flips above the anchor when
 * there is more room there, clamps horizontally into the viewport and follows scroll/resize.
 */
function useFloatingStyle(
  anchorRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  open: boolean,
  { align = 'left', matchWidth = false, maxHeight = 360 }: FloatingOptions,
) {
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', top: 0, left: 0, visibility: 'hidden' })

  const update = useCallback(() => {
    const anchor = anchorRef.current
    const panel = panelRef.current
    if (!anchor || !panel) return
    const a = anchor.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const below = vh - a.bottom - GAP - MARGIN
    const above = a.top - GAP - MARGIN
    const natural = Math.min(panel.scrollHeight, maxHeight)
    const placeAbove = natural > below && above > below
    const available = Math.max(120, Math.min(maxHeight, placeAbove ? above : below))
    const height = Math.min(natural, available)

    const minWidth = matchWidth ? a.width : undefined
    const width = Math.max(panel.offsetWidth, minWidth ?? 0)
    let left = align === 'right' ? a.right - width : a.left
    left = Math.min(Math.max(MARGIN, left), Math.max(MARGIN, vw - width - MARGIN))
    const top = placeAbove ? a.top - GAP - height : a.bottom + GAP

    setStyle({
      position: 'fixed',
      top: Math.round(top),
      left: Math.round(left),
      minWidth,
      maxWidth: vw - MARGIN * 2,
      maxHeight: available,
      transformOrigin: placeAbove ? 'bottom' : 'top',
    })
  }, [anchorRef, panelRef, align, matchWidth, maxHeight])

  useLayoutEffect(() => {
    if (!open) return
    update()
    // Second pass once the panel has its final size (fonts, async content).
    const raf = requestAnimationFrame(update)
    return () => cancelAnimationFrame(raf)
  }, [open, update])

  useEffect(() => {
    if (!open) return
    let raf = 0
    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(update)
    }
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
    if (ro && panelRef.current) ro.observe(panelRef.current)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      ro?.disconnect()
    }
  }, [open, update, panelRef])

  return style
}

/**
 * A floating panel rendered into <body> (above cards, drawers and modals, below toasts),
 * anchored to `anchorRef`. Render it only while open.
 */
export function FloatingPanel({
  anchorRef,
  panelRef,
  open,
  className,
  children,
  role,
  id,
  ariaLabel,
  onMouseDown,
  ...opts
}: FloatingOptions & {
  anchorRef: RefObject<HTMLElement | null>
  panelRef: RefObject<HTMLDivElement | null>
  open: boolean
  className?: string
  children: ReactNode
  role?: string
  id?: string
  ariaLabel?: string
  onMouseDown?: (e: ReactMouseEvent) => void
}) {
  const style = useFloatingStyle(anchorRef, panelRef, open, opts)
  if (!open) return null
  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role={role}
      aria-label={ariaLabel}
      style={style}
      onMouseDown={onMouseDown}
      className={cn(
        'animate-pop-in z-[55] flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl ring-1 ring-black/5 dark:ring-white/5',
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  )
}

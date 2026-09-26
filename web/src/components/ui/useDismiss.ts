import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

/** Closes on outside pointer-down (ignoring the anchor and the panel) and on Escape. */
export function useDismiss(open: boolean, onClose: () => void, refs: RefObject<HTMLElement | null>[]) {
  const refsRef = useRef(refs)
  const onCloseRef = useRef(onClose)
  useLayoutEffect(() => {
    refsRef.current = refs
    onCloseRef.current = onClose
  })
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node
      if (refsRef.current.some((r) => r.current?.contains(t))) return
      onCloseRef.current()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])
}

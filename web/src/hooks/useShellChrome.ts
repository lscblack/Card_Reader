import { useSyncExternalStore } from 'react'

/**
 * Dashboard-shell "chrome" state shared between DashboardShell and the pages inside it.
 *
 * Focus mode hides the sidebar and top bar so a page (e.g. a card editor) can use the whole
 * viewport. It is not persisted and DashboardShell resets it whenever the route changes.
 */

let focus = false
const listeners = new Set<() => void>()

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function setFocusMode(next: boolean) {
  if (focus === next) return
  focus = next
  listeners.forEach((l) => l())
}

export function useFocusMode(): { focus: boolean; setFocus: (next: boolean) => void } {
  const value = useSyncExternalStore(subscribe, () => focus, () => false)
  return { focus: value, setFocus: setFocusMode }
}

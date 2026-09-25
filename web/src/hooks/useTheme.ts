import { useSyncExternalStore } from 'react'

export type ThemePref = 'light' | 'dark' | 'system'
const KEY = 'nfc.theme'

function storedPref(): ThemePref | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' || v === 'system' ? v : null
  } catch {
    return null
  }
}

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    // Default theme is dark; the user can still pick light or follow the system.
    return v === 'light' || v === 'system' ? v : 'dark'
  } catch {
    return 'dark'
  }
}

const mq = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null
let current: ThemePref = typeof window !== 'undefined' ? readPref() : 'dark'
const listeners = new Set<() => void>()

function apply() {
  const dark = current === 'dark' || (current === 'system' && !!mq?.matches)
  document.documentElement.classList.toggle('dark', dark)
  listeners.forEach((l) => l())
}

mq?.addEventListener('change', () => {
  if (current === 'system') apply()
})

function setPref(p: ThemePref) {
  current = p
  try {
    localStorage.setItem(KEY, p)
  } catch {
    /* ignore */
  }
  apply()
}

/**
 * Branding's default mode (Part 3). Only applies while the user hasn't picked a theme themselves.
 */
export function setDefaultThemeMode(mode: ThemePref) {
  if (storedPref() !== null || current === mode) return
  current = mode
  apply()
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Shared theme preference (light / dark / system), applied as a `.dark` class on <html>. */
export function useTheme() {
  const pref = useSyncExternalStore(subscribe, () => current)
  return { pref, setPref }
}

/** Re-renders when the *effective* theme changes (used by charts). */
export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, () => document.documentElement.classList.contains('dark'))
}

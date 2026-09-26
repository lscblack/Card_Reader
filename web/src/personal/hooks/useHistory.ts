import { useCallback, useState } from 'react'

/** Value with undo/redo. `set` pushes a history entry (coalesced when `coalesceKey` repeats within 800 ms). */
export function useHistory<T>(initial: T) {
  const [state, setState] = useState<{ past: T[]; present: T; future: T[]; key: string | null; at: number }>({ past: [], present: initial, future: [], key: null, at: 0 })
  const set = useCallback((next: T | ((prev: T) => T), coalesceKey?: string) => {
    setState((s) => {
      const value = typeof next === 'function' ? (next as (p: T) => T)(s.present) : next
      if (Object.is(value, s.present)) return s
      const now = Date.now()
      const coalesce = !!coalesceKey && coalesceKey === s.key && now - s.at < 800
      return { past: coalesce ? s.past : [...s.past.slice(-80), s.present], present: value, future: [], key: coalesceKey ?? null, at: now }
    })
  }, [])
  const undo = useCallback(() => setState((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future], key: null, at: 0 } : s)), [])
  const redo = useCallback(() => setState((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1), key: null, at: 0 } : s)), [])
  /** Replace without history (e.g. after a save returns normalised data). */
  const reset = useCallback((value: T) => setState((s) => ({ ...s, present: value })), [])
  return { value: state.present, set, undo, redo, reset, canUndo: state.past.length > 0, canRedo: state.future.length > 0 }
}

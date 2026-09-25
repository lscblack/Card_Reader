import { driver, type DriveStep, type Driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import { preferencesApi } from '@/api/platform'
import type { User, UserPreferences } from '@/api/types'

/** A tour step. `element` is a CSS selector — prefer `[data-tour="…"]` hooks. Omit it for a centred intro. */
export interface TourStep {
  element?: string
  title: string
  description: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
}

const LOCAL_KEY = 'nfc.tours'
const registry = new Map<string, TourStep[]>()
let active: Driver | null = null
let currentUser: User | null = null
let onUserUpdate: ((u: User) => void) | null = null
const listeners = new Set<() => void>()
let pageTours: string[] = []

interface LocalState {
  completed: string[]
  dismissed: boolean
}

function readLocal(): LocalState {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null') as LocalState | null
    return { completed: v?.completed ?? [], dismissed: !!v?.dismissed }
  } catch {
    return { completed: [], dismissed: false }
  }
}
function writeLocal(s: LocalState) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

/** Wire the tour engine to the signed-in user (called by useTour). */
export function bindTourUser(user: User | null, update: (u: User) => void) {
  currentUser = user
  onUserUpdate = update
}

function prefs(): { completed: string[]; dismissed: boolean } {
  const local = readLocal()
  const p = currentUser?.preferences ?? {}
  return {
    completed: [...new Set([...(p.tours_completed ?? []), ...local.completed])],
    dismissed: !!p.tours_dismissed || local.dismissed,
  }
}

async function persist(patch: Partial<UserPreferences>) {
  const local = readLocal()
  writeLocal({
    completed: [...new Set([...local.completed, ...(patch.tours_completed ?? [])])],
    dismissed: patch.tours_dismissed ?? local.dismissed,
  })
  if (!currentUser) return
  try {
    const u = await preferencesApi.patch(patch)
    currentUser = u
    onUserUpdate?.(u)
  } catch {
    // localStorage fallback already stored it (older backend or offline).
  }
}

export function isTourCompleted(id: string): boolean {
  return prefs().completed.includes(id)
}
export function areToursDismissed(): boolean {
  return prefs().dismissed
}

/** Register (or replace) a tour's steps. */
export function registerTour(id: string, steps: TourStep[]) {
  registry.set(id, steps)
}

/** Tours registered by components currently on screen (for the "Replay tour" menu). */
export function getPageTours(): string[] {
  return pageTours
}
export function setPageTour(id: string, on: boolean) {
  pageTours = on ? [...pageTours.filter((x) => x !== id), id] : pageTours.filter((x) => x !== id)
  listeners.forEach((l) => l())
}
export function subscribePageTours(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function visible(selector: string): Element | null {
  const el = document.querySelector(selector)
  if (!el) return null
  const r = (el as HTMLElement).getBoundingClientRect()
  return r.width > 0 && r.height > 0 ? el : null
}

export function isTourRunning(): boolean {
  return !!active?.isActive()
}

/** Start a registered tour now (replay). Steps whose element isn't visible (e.g. desktop-only) are skipped. */
export function startTour(id: string) {
  const steps = registry.get(id)
  if (!steps?.length) return false
  active?.destroy()
  const usable: DriveStep[] = steps
    .filter((s) => !s.element || visible(s.element))
    .map((s) => ({
      element: s.element,
      popover: { title: s.title, description: s.description, side: s.side, align: s.align ?? 'start' },
    }))
  if (!usable.length) return false
  let finished = false
  const d = driver({
    steps: usable,
    showProgress: true,
    progressText: '{{current}} of {{total}}',
    nextBtnText: 'Next',
    prevBtnText: 'Back',
    doneBtnText: 'Done',
    allowClose: true,
    smoothScroll: true,
    stagePadding: 6,
    stageRadius: 10,
    overlayOpacity: 0.55,
    popoverClass: 'nfc-tour',
    onPopoverRender: (popover) => {
      // "Don't show tours" escape hatch on every step.
      const skip = document.createElement('button')
      skip.type = 'button'
      skip.className = 'nfc-tour-skip'
      skip.textContent = 'Don’t show tours again'
      skip.onclick = () => {
        void persist({ tours_dismissed: true })
        finished = true
        d.destroy()
      }
      popover.footer.prepend(skip)
    },
    onDestroyed: () => {
      // Closing or finishing both count as "seen" so it doesn't auto-start again.
      if (!finished) void persist({ tours_completed: [...new Set([...prefs().completed, id])] })
      active = null
    },
  } as Parameters<typeof driver>[0])
  active = d
  d.drive()
  return true
}

/** Auto-start on first visit (not completed, tours not dismissed). */
export function maybeAutoStart(id: string) {
  if (isTourRunning() || isTourCompleted(id) || areToursDismissed()) return false
  if (window.matchMedia('(max-height: 480px)').matches) return false
  return startTour(id)
}

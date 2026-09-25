import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
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
  /** Optional icon shown in the step header (e.g. a lucide icon element). */
  icon?: ReactNode
  /** Optional illustration (URL) shown above the text. */
  image?: string
}

const LOCAL_KEY = 'nfc.tours'
const registry = new Map<string, TourStep[]>()
let active: Driver | null = null
let currentUser: User | null = null
let onUserUpdate: ((u: User) => void) | null = null
const listeners = new Set<() => void>()
let pageTours: string[] = []

// First-visit welcome request (rendered by <TourWelcome/> inside DashboardShell).
let welcomeFor: string | null = null
let welcomeHostMounted = 0
const welcomeListeners = new Set<() => void>()

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

/** Mark a tour as seen (it won't auto-start again; it can still be replayed). */
export function markTourSeen(id: string) {
  void persist({ tours_completed: [...new Set([...prefs().completed, id])] })
}
/** Turn off all automatic tours for this user. */
export function dismissAllTours() {
  void persist({ tours_dismissed: true })
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
export function getTourSteps(id: string): TourStep[] | undefined {
  return registry.get(id)
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

// ---- welcome modal plumbing ----
export function getWelcomeTour(): string | null {
  return welcomeFor
}
export function subscribeWelcome(cb: () => void) {
  welcomeListeners.add(cb)
  return () => welcomeListeners.delete(cb)
}
function setWelcome(id: string | null) {
  welcomeFor = id
  welcomeListeners.forEach((l) => l())
}
/** Called by <TourWelcome/> so auto-start knows a welcome dialog can be shown. */
export function registerWelcomeHost(): () => void {
  welcomeHostMounted++
  return () => {
    welcomeHostMounted--
  }
}
export function closeWelcome() {
  setWelcome(null)
}

function visible(selector: string): Element | null {
  const el = document.querySelector(selector)
  if (!el) return null
  const r = (el as HTMLElement).getBoundingClientRect()
  return r.width > 0 && r.height > 0 ? el : null
}

export function isTourRunning(): boolean {
  return !!active?.isActive() || welcomeFor !== null
}

const ARROW_LEFT = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>'
const ARROW_RIGHT = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>'
const CHECK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'

/** Start a registered tour now (replay). Steps whose element isn't visible (e.g. desktop-only) are skipped. */
export function startTour(id: string) {
  const steps = registry.get(id)
  if (!steps?.length) return false
  active?.destroy()
  const usable = steps.filter((s) => !s.element || visible(s.element))
  if (!usable.length) return false
  const total = usable.length
  const iconRoots: Root[] = []
  const unmountIcons = () => {
    while (iconRoots.length) {
      const r = iconRoots.pop()
      // Defer so we never unmount during a React render.
      setTimeout(() => r?.unmount(), 0)
    }
  }
  let finished = false
  const driveSteps: DriveStep[] = usable.map((s) => ({
    element: s.element,
    popover: { title: s.title, description: s.description, side: s.side, align: s.align ?? 'start' },
  }))
  const d = driver({
    steps: driveSteps,
    showProgress: false,
    nextBtnText: 'Next',
    prevBtnText: 'Back',
    doneBtnText: 'Finish',
    allowClose: true,
    smoothScroll: true,
    animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    stagePadding: 8,
    stageRadius: 12,
    overlayOpacity: 0.62,
    overlayColor: '#0c0a0a',
    popoverClass: 'nfc-tour',
    popoverOffset: 14,
    onPopoverRender: (popover, { state }) => {
      unmountIcons()
      const index = state.activeIndex ?? 0
      const step = usable[index]
      const wrapper = popover.wrapper
      wrapper.setAttribute('aria-live', 'polite')

      // Header: icon + eyebrow above the title.
      const head = document.createElement('div')
      head.className = 'nfc-tour-head'
      if (step?.icon) {
        const iconHost = document.createElement('span')
        iconHost.className = 'nfc-tour-icon'
        head.appendChild(iconHost)
        const root = createRoot(iconHost)
        root.render(step.icon)
        iconRoots.push(root)
      }
      const eyebrow = document.createElement('p')
      eyebrow.className = 'nfc-tour-eyebrow'
      eyebrow.textContent = total > 1 ? `Step ${index + 1} of ${total}` : 'Tip'
      head.appendChild(eyebrow)
      popover.title.before(head)

      if (step?.image) {
        const img = document.createElement('img')
        img.className = 'nfc-tour-image'
        img.src = step.image
        img.alt = ''
        head.after(img)
      }

      // Slim progress bar.
      const bar = document.createElement('div')
      bar.className = 'nfc-tour-progress'
      bar.setAttribute('role', 'progressbar')
      bar.setAttribute('aria-valuemin', '1')
      bar.setAttribute('aria-valuemax', String(total))
      bar.setAttribute('aria-valuenow', String(index + 1))
      const fill = document.createElement('span')
      fill.style.width = `${((index + 1) / total) * 100}%`
      bar.appendChild(fill)
      popover.footer.before(bar)

      // Footer: "Skip tour" + keyboard hints on the left, buttons on the right.
      const left = document.createElement('div')
      left.className = 'nfc-tour-left'
      const skip = document.createElement('button')
      skip.type = 'button'
      skip.className = 'nfc-tour-skip'
      skip.textContent = index === total - 1 ? 'Don’t show tours' : 'Skip tour'
      skip.onclick = () => {
        if (index === total - 1) {
          void persist({ tours_dismissed: true })
          finished = true
        }
        d.destroy()
      }
      left.appendChild(skip)
      const keys = document.createElement('span')
      keys.className = 'nfc-tour-keys'
      keys.innerHTML = '<kbd>←</kbd><kbd>→</kbd><kbd>Esc</kbd>'
      keys.setAttribute('aria-hidden', 'true')
      left.appendChild(keys)
      popover.footer.prepend(left)

      popover.previousButton.innerHTML = `${ARROW_LEFT}<span>Back</span>`
      const last = index === total - 1
      popover.nextButton.innerHTML = last ? `<span>Finish</span>${CHECK}` : `<span>Next</span>${ARROW_RIGHT}`
      popover.previousButton.classList.toggle('nfc-hidden', index === 0)
      popover.closeButton.setAttribute('aria-label', 'Close tour')
    },
    onDestroyed: () => {
      unmountIcons()
      // Closing or finishing both count as "seen" so it doesn't auto-start again.
      if (!finished) markTourSeen(id)
      active = null
    },
  })
  active = d
  d.drive()
  return true
}

/** Auto-start on first visit (not completed, tours not dismissed). Shows the welcome dialog first when available. */
export function maybeAutoStart(id: string) {
  if (isTourRunning() || isTourCompleted(id) || areToursDismissed()) return false
  if (window.matchMedia('(max-height: 480px)').matches) return false
  if (!registry.get(id)?.length) return false
  if (welcomeHostMounted > 0) {
    setWelcome(id)
    return true
  }
  return startTour(id)
}

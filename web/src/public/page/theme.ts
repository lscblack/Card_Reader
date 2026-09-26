import { useEffect, useState, type CSSProperties } from 'react'
import type { PageHeaderStyle, ProfileTheme, ProfileType } from '@/business/api/types'

// ───────────────────────── colours ─────────────────────────

const HEX = /^#[0-9a-f]{6}$/i
const rgb = (h: string) => {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const hex = (c: number[]) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
/** Mix `a` into `b` by `t` (0 = b, 1 = a). */
export const mix = (a: string, b: string, t: number) => {
  const x = rgb(a)
  const y = rgb(b)
  return hex(x.map((v, i) => v * t + y[i] * (1 - t)))
}
const lum = (h: string) => {
  const [r, g, b] = rgb(h).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
export const isDarkColor = (h: string) => lum(h) < 0.2
/** Readable text on a background. */
export const onColor = (bg: string) => (contrast('#ffffff', bg) >= contrast('#111111', bg) ? '#ffffff' : '#111111')
const ok = (v: string | null | undefined): v is string => !!v && HEX.test(v)

/** Pushes `fg` towards `toward` until it reaches `min` contrast on `bg`. */
function ensure(fg: string, bg: string, min: number, toward: string) {
  let c = fg
  for (let i = 1; i <= 10 && contrast(c, bg) < min; i++) c = mix(toward, fg, i / 10)
  return c
}

export interface Palette {
  dark: boolean
  bg: string
  surface: string
  surface2: string
  text: string
  muted: string
  subtle: string
  border: string
  accent: string
  onAccent: string
  /** Accent usable as text on the page background. */
  accentText: string
  accentSoft: string
}

export const DEFAULT_PAGE_ACCENT = '#b91c1c'

/**
 * Page palette. A theme's colours describe its designed scheme (`theme.dark` true = designed dark); when the
 * visitor views the other scheme a matching neutral palette is derived that keeps the accent.
 */
export function palette(theme: ProfileTheme | null | undefined, dark: boolean, fallbackAccent?: string | null): Palette {
  const t = theme ?? ({ accent: '' } as ProfileTheme)
  const accent = ok(t.accent) ? t.accent : ok(fallbackAccent) ? fallbackAccent : DEFAULT_PAGE_ACCENT
  const designedDark = t.dark === true || (ok(t.background) && isDarkColor(t.background))
  let bg: string, surface: string, text: string
  if (designedDark === dark && ok(t.background)) {
    bg = t.background
    surface = ok(t.surface) ? t.surface : dark ? mix('#ffffff', bg, 0.05) : '#ffffff'
    text = ok(t.text) ? t.text : dark ? '#f4f4f5' : '#18181b'
  } else if (dark) {
    bg = mix(accent, '#0b0b0d', 0.05)
    surface = mix(accent, '#161619', 0.06)
    text = '#f3f3f4'
  } else {
    bg = mix(accent, '#f6f6f5', 0.025)
    surface = '#ffffff'
    text = '#18181b'
  }
  if (contrast(text, bg) < 7) text = onColor(bg) === '#ffffff' ? mix('#ffffff', text, 0.7) : mix('#111111', text, 0.7)
  const muted = ensure(mix(text, bg, 0.7), bg, 4.6, text)
  const subtle = ensure(mix(text, bg, 0.52), bg, 3.2, text)
  return {
    dark,
    bg,
    surface,
    surface2: mix(text, surface, 0.045),
    text,
    muted,
    subtle,
    border: mix(text, surface, 0.12),
    accent,
    onAccent: onColor(accent),
    accentText: ensure(accent, bg, 3.6, text),
    accentSoft: mix(accent, surface, dark ? 0.2 : 0.12),
  }
}

// ───────────────────────── fonts ─────────────────────────

/** Font-pair ids (shared with /personal/design-presets) mapped to web fonts for pages. */
export const PAGE_FONTS: Record<string, { name: string; heading: string; body: string; google: string[] }> = {
  sans: { name: 'Inter', heading: "'Inter', system-ui, sans-serif", body: "'Inter', system-ui, sans-serif", google: [] },
  display: { name: 'Grotesk + Inter', heading: "'Space Grotesk', 'Inter', system-ui, sans-serif", body: "'Inter', system-ui, sans-serif", google: ['Space+Grotesk:wght@500;600;700'] },
  geometric: { name: 'Geometric', heading: "'Montserrat', 'Inter', system-ui, sans-serif", body: "'Inter', system-ui, sans-serif", google: ['Montserrat:wght@500;600;700;800'] },
  elegant: { name: 'Serif + Inter', heading: "'Playfair Display', Georgia, serif", body: "'Inter', system-ui, sans-serif", google: ['Playfair+Display:ital,wght@0,500;0,600;0,700;1,500'] },
  serif: { name: 'Classic serif', heading: "'Cormorant Garamond', Georgia, serif", body: "'EB Garamond', Georgia, serif", google: ['Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500', 'EB+Garamond:ital,wght@0,400;0,500;1,400'] },
  humanist: { name: 'Humanist', heading: "'Nunito', 'Segoe UI', system-ui, sans-serif", body: "'Nunito', 'Segoe UI', system-ui, sans-serif", google: ['Nunito:wght@400;600;700;800'] },
  condensed: { name: 'Condensed + Inter', heading: "'Oswald', 'Arial Narrow', system-ui, sans-serif", body: "'Inter', system-ui, sans-serif", google: ['Oswald:wght@500;600;700'] },
  mono: { name: 'Mono + Inter', heading: "'JetBrains Mono', ui-monospace, monospace", body: "'Inter', system-ui, sans-serif", google: [] },
}
/** Decorative display fonts some layouts use for category titles. */
const DECOR: Record<string, string[]> = { chalk: ['Caveat:wght@600;700'], script: ['Great+Vibes', 'Caveat:wght@600;700'], brush: ['Permanent+Marker'] }

const loaded = new Set<string>()
function loadFamilies(families: string[]) {
  const todo = families.filter((f) => !loaded.has(f))
  if (!todo.length || typeof document === 'undefined') return
  todo.forEach((f) => loaded.add(f))
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?${todo.map((f) => `family=${f}`).join('&')}&display=swap`
  document.head.appendChild(link)
}

/** Loads the Google fonts a page needs (once per family). */
export function usePageFonts(font: string | null | undefined, decor?: string | null) {
  useEffect(() => {
    loadFamilies([...(PAGE_FONTS[font ?? 'sans'] ?? PAGE_FONTS.sans).google, ...(decor ? (DECOR[decor] ?? []) : [])])
  }, [font, decor])
}

// ───────────────────────── scheme ─────────────────────────

const SCHEME_KEY = 'nfc.page.scheme'

function systemDark() {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

/**
 * Light/dark for a page: the visitor's own toggle (remembered per page) wins, then the theme's `dark` flag, then the
 * visitor's system preference.
 */
export function usePageScheme(theme: ProfileTheme | null | undefined, key: string, forced?: 'light' | 'dark') {
  const stored = () => {
    try {
      const v = JSON.parse(localStorage.getItem(SCHEME_KEY) ?? '{}')[key]
      return v === 'dark' || v === 'light' ? (v as 'light' | 'dark') : null
    } catch {
      return null
    }
  }
  const [choice, setChoice] = useState<'light' | 'dark' | null>(stored)
  const [sys, setSys] = useState(systemDark)
  useEffect(() => {
    let mq: MediaQueryList
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)')
    } catch {
      return
    }
    const on = () => setSys(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  const base = theme?.dark === true ? true : theme?.dark === false ? false : sys
  const dark = forced ? forced === 'dark' : choice ? choice === 'dark' : base
  const toggle = () => {
    const next = dark ? 'light' : 'dark'
    setChoice(next)
    try {
      const all = JSON.parse(localStorage.getItem(SCHEME_KEY) ?? '{}')
      all[key] = next
      localStorage.setItem(SCHEME_KEY, JSON.stringify(all))
    } catch {
      /* storage blocked */
    }
  }
  return { dark, toggle }
}

// ───────────────────────── layouts ─────────────────────────

export type Chrome = 'card' | 'flat' | 'paper' | 'outline' | 'glass' | 'frame'
export type TitleStyle = 'caps' | 'ornament' | 'fine' | 'chalk' | 'neon' | 'bold' | 'serif' | 'rule'
export type MenuStyle = 'list' | 'leaders' | 'grid' | 'fine' | 'board' | 'bar' | 'street' | 'spotlight' | 'boxed' | 'bars' | 'columns' | 'dashes' | 'ledger' | 'pricebox' | 'numbered'
/** Category heading style inside menus (overrides the menu style's own). */
export type CatStyle = 'default' | 'accent-caps' | 'rule-center' | 'script' | 'brush' | 'ornament' | 'pill' | 'pill-dark' | 'split' | 'spaced' | 'bar'
export type Texture = 'none' | 'paper' | 'chalk' | 'dots' | 'grid' | 'glow' | 'stripes' | 'rays' | 'waves' | 'gingham' | 'pattern' | 'grain' | 'kraft'

export interface LayoutSpec {
  id: string
  name: string
  /** Page types this layout is designed for (all layouts render any section). */
  for: ProfileType[]
  width: 'narrow' | 'wide'
  chrome: Chrome
  titles: TitleStyle
  menu: MenuStyle
  cat: CatStyle
  products: 'grid' | 'single' | 'list'
  links: 'stack' | 'creator'
  texture: Texture
  align: 'left' | 'center'
  header: PageHeaderStyle
  decor?: 'chalk' | 'script' | 'brush'
  /** Offer section style: a coupon card or a loud flash-sale block. */
  offer: 'coupon' | 'flash'
  /** Event section style: a centred invitation or a details card. */
  event: 'card' | 'invite'
  /** Uppercase headings (street food, flash sale). */
  upper?: boolean
}

const L = (id: string, name: string, forTypes: ProfileType[], spec: Partial<LayoutSpec>): LayoutSpec => ({
  id,
  name,
  for: forTypes,
  width: 'narrow',
  chrome: 'card',
  titles: 'caps',
  menu: 'list',
  cat: 'default',
  offer: 'coupon',
  event: 'card',
  products: 'grid',
  links: 'stack',
  texture: 'none',
  align: 'left',
  header: 'cover',
  ...spec,
})

export const LAYOUTS: LayoutSpec[] = [
  L('classic', 'Classic', ['custom', 'menu', 'product', 'links', 'offer', 'event', 'gallery', 'form', 'wifi'], {}),
  L('menu-bistro', 'Bistro', ['menu'], { chrome: 'paper', titles: 'ornament', menu: 'leaders', texture: 'paper', header: 'logo', align: 'center' }),
  L('menu-chalkboard', 'Chalkboard', ['menu'], { chrome: 'flat', titles: 'chalk', menu: 'board', texture: 'chalk', header: 'minimal', decor: 'chalk' }),
  L('menu-grid', 'Photo grid', ['menu', 'product'], { width: 'wide', chrome: 'flat', titles: 'bold', menu: 'grid', header: 'cover' }),
  L('menu-fine', 'Fine dining', ['menu'], { chrome: 'flat', titles: 'fine', menu: 'fine', header: 'logo', align: 'center' }),
  L('menu-bar', 'Neon bar', ['menu'], { chrome: 'glass', titles: 'neon', menu: 'bar', texture: 'glow', header: 'banner' }),
  L('menu-street', 'Street food', ['menu'], { chrome: 'outline', titles: 'bold', menu: 'street', texture: 'stripes', header: 'banner', upper: true }),
  // Menu layouts modelled on printed restaurant menus (burger flyer, chalk dinner, gold frame, Thai border…).
  L('menu-burger', 'Burger spotlight', ['menu'], { chrome: 'flat', titles: 'bold', menu: 'spotlight', cat: 'accent-caps', texture: 'grain', header: 'minimal', upper: true }),
  L('menu-chalk-dinner', 'Chalk dinner', ['menu'], { chrome: 'flat', titles: 'chalk', menu: 'boxed', cat: 'rule-center', texture: 'chalk', header: 'logo', align: 'center', decor: 'chalk', upper: true }),
  L('menu-specials', 'Daily specials', ['menu'], { chrome: 'card', titles: 'serif', menu: 'bars', cat: 'script', header: 'cover', decor: 'script' }),
  L('menu-brush', 'Brush bold', ['menu'], { width: 'wide', chrome: 'flat', titles: 'bold', menu: 'columns', cat: 'brush', texture: 'grain', header: 'banner', decor: 'brush' }),
  L('menu-gold', 'Gold frame', ['menu'], { chrome: 'frame', titles: 'ornament', menu: 'dashes', cat: 'ornament', header: 'logo', align: 'center', decor: 'script' }),
  L('menu-arch', 'Arch', ['menu'], { width: 'wide', chrome: 'paper', titles: 'fine', menu: 'columns', cat: 'rule-center', texture: 'paper', header: 'logo', align: 'center', upper: true }),
  L('menu-restaurant', 'Restaurant', ['menu'], { width: 'wide', chrome: 'flat', titles: 'serif', menu: 'columns', cat: 'pill', header: 'minimal' }),
  L('menu-diner', 'Diner', ['menu'], { chrome: 'card', titles: 'bold', menu: 'leaders', cat: 'pill-dark', texture: 'gingham', header: 'logo', align: 'center' }),
  L('menu-rustic', 'Rustic', ['menu'], { width: 'wide', chrome: 'flat', titles: 'caps', menu: 'columns', cat: 'accent-caps', texture: 'kraft', header: 'logo', align: 'center', upper: true }),
  L('menu-pattern', 'Pattern border', ['menu'], { chrome: 'flat', titles: 'serif', menu: 'ledger', cat: 'script', texture: 'pattern', header: 'logo', decor: 'script' }),
  L('menu-kraft', 'Kraft special', ['menu'], { chrome: 'flat', titles: 'bold', menu: 'pricebox', cat: 'accent-caps', texture: 'kraft', header: 'banner', upper: true }),
  L('menu-numbered', 'Big flavours', ['menu'], { chrome: 'flat', titles: 'bold', menu: 'numbered', cat: 'split', texture: 'grain', header: 'minimal', upper: true }),
  L('menu-lounge', 'Lounge', ['menu'], { width: 'wide', chrome: 'flat', titles: 'caps', menu: 'columns', cat: 'pill-dark', header: 'logo', align: 'center' }),
  L('menu-noir', 'Drinks noir', ['menu'], { width: 'wide', chrome: 'flat', titles: 'bold', menu: 'columns', cat: 'spaced', texture: 'grain', header: 'minimal', upper: true }),
  L('menu-cocktail', 'Cocktail bars', ['menu'], { chrome: 'flat', titles: 'bold', menu: 'list', cat: 'bar', header: 'logo', align: 'center' }),
  L('menu-fastfood-chalk', 'Fast food chalk', ['menu'], { chrome: 'flat', titles: 'chalk', menu: 'leaders', cat: 'script', texture: 'chalk', header: 'minimal', decor: 'script', upper: true }),
  L('catalogue-grid', 'Catalogue grid', ['product'], { width: 'wide', chrome: 'flat', titles: 'bold', products: 'grid', header: 'minimal' }),
  L('product-single', 'Single product', ['product'], { chrome: 'flat', titles: 'serif', products: 'single', header: 'minimal' }),
  L('service-list', 'Service list', ['product', 'custom'], { chrome: 'card', titles: 'caps', products: 'list', header: 'cover', texture: 'waves' }),
  L('link-hub', 'Link hub', ['links'], { chrome: 'flat', titles: 'caps', links: 'stack', header: 'logo', align: 'center', texture: 'dots' }),
  L('link-creator', 'Creator', ['links'], { chrome: 'flat', titles: 'bold', links: 'creator', header: 'logo', align: 'center', texture: 'glow' }),
  L('offer-coupon', 'Coupon', ['offer'], { chrome: 'card', titles: 'caps', header: 'minimal', align: 'center', texture: 'rays' }),
  L('offer-flash', 'Flash sale', ['offer'], { offer: 'flash', chrome: 'outline', titles: 'bold', header: 'banner', texture: 'stripes', upper: true }),
  L('event-invite', 'Invitation', ['event'], { event: 'invite', chrome: 'card', titles: 'serif', header: 'cover', align: 'center', texture: 'paper' }),
  L('event-workshop', 'Workshop', ['event'], { chrome: 'card', titles: 'rule', header: 'minimal', texture: 'grid' }),
  L('wifi-guest', 'Guest Wi-Fi', ['wifi'], { chrome: 'card', titles: 'caps', header: 'logo', align: 'center', texture: 'waves' }),
  L('gallery-portfolio', 'Portfolio', ['gallery'], { width: 'wide', chrome: 'flat', titles: 'rule', header: 'minimal' }),
  L('form-feedback', 'Feedback', ['form'], { chrome: 'card', titles: 'caps', header: 'logo', align: 'center', texture: 'dots' }),
  L('form-contact', 'Contact form', ['form'], { chrome: 'card', titles: 'rule', header: 'minimal' }),
  L('form-booking', 'Booking', ['form'], { chrome: 'card', titles: 'serif', header: 'cover', texture: 'paper' }),
  // More looks for every page type, composed from the same chrome / title / texture building blocks.
  L('product-boutique', 'Boutique', ['product'], { width: 'wide', chrome: 'paper', titles: 'ornament', products: 'grid', texture: 'paper', header: 'logo', align: 'center' }),
  L('product-tech', 'Tech store', ['product'], { width: 'wide', chrome: 'glass', titles: 'neon', products: 'grid', texture: 'glow', header: 'banner' }),
  L('product-bold', 'Bold shop', ['product'], { chrome: 'outline', titles: 'bold', products: 'list', texture: 'stripes', header: 'banner', upper: true }),
  L('service-elegant', 'Elegant services', ['product', 'custom'], { chrome: 'flat', titles: 'fine', products: 'list', header: 'logo', align: 'center' }),
  L('service-studio', 'Studio', ['product', 'custom'], { chrome: 'card', titles: 'rule', products: 'list', texture: 'dots', header: 'minimal' }),
  L('link-glass', 'Glass', ['links'], { chrome: 'glass', titles: 'neon', links: 'creator', texture: 'glow', header: 'logo', align: 'center' }),
  L('link-paper', 'Paper', ['links'], { chrome: 'paper', titles: 'ornament', links: 'stack', texture: 'paper', header: 'logo', align: 'center' }),
  L('link-bold', 'Bold', ['links'], { chrome: 'outline', titles: 'bold', links: 'stack', texture: 'stripes', header: 'banner', upper: true }),
  L('link-minimal', 'Minimal', ['links'], { chrome: 'flat', titles: 'rule', links: 'stack', header: 'minimal' }),
  L('link-cover', 'Cover', ['links'], { chrome: 'card', titles: 'caps', links: 'creator', texture: 'grain', header: 'cover', align: 'center' }),
  L('offer-poster', 'Poster', ['offer'], { offer: 'flash', chrome: 'flat', titles: 'bold', texture: 'rays', header: 'cover', align: 'center', upper: true }),
  L('offer-ticket', 'Ticket', ['offer'], { chrome: 'paper', titles: 'ornament', texture: 'paper', header: 'logo', align: 'center' }),
  L('offer-neon', 'Neon promo', ['offer'], { offer: 'flash', chrome: 'glass', titles: 'neon', texture: 'glow', header: 'banner' }),
  L('offer-minimal', 'Minimal offer', ['offer'], { chrome: 'flat', titles: 'fine', header: 'minimal', align: 'center' }),
  L('offer-kraft', 'Kraft flyer', ['offer'], { offer: 'flash', chrome: 'card', titles: 'bold', texture: 'kraft', header: 'banner', upper: true }),
  L('offer-gingham', 'Picnic', ['offer'], { chrome: 'card', titles: 'caps', texture: 'gingham', header: 'logo', align: 'center' }),
  L('event-gala', 'Gala', ['event'], { event: 'invite', chrome: 'frame', titles: 'ornament', header: 'logo', align: 'center' }),
  L('event-neon', 'Night event', ['event'], { chrome: 'glass', titles: 'neon', texture: 'glow', header: 'banner' }),
  L('event-poster', 'Poster', ['event'], { chrome: 'outline', titles: 'bold', texture: 'stripes', header: 'banner', upper: true }),
  L('event-minimal', 'Minimal event', ['event'], { event: 'invite', chrome: 'flat', titles: 'fine', header: 'minimal', align: 'center' }),
  L('event-garden', 'Garden party', ['event'], { event: 'invite', chrome: 'paper', titles: 'serif', texture: 'paper', header: 'cover', align: 'center' }),
  L('gallery-dark', 'Dark room', ['gallery'], { width: 'wide', chrome: 'flat', titles: 'bold', texture: 'grain', header: 'minimal' }),
  L('gallery-frame', 'Framed', ['gallery'], { chrome: 'frame', titles: 'ornament', header: 'logo', align: 'center' }),
  L('gallery-paper', 'Scrapbook', ['gallery'], { chrome: 'paper', titles: 'serif', texture: 'paper', header: 'cover' }),
  L('gallery-cover', 'Showcase', ['gallery'], { width: 'wide', chrome: 'card', titles: 'caps', texture: 'dots', header: 'cover', align: 'center' }),
  L('form-glass', 'Glass form', ['form'], { chrome: 'glass', titles: 'neon', texture: 'glow', header: 'banner' }),
  L('form-paper', 'Paper form', ['form'], { chrome: 'paper', titles: 'ornament', texture: 'paper', header: 'logo', align: 'center' }),
  L('form-bold', 'Bold form', ['form'], { chrome: 'outline', titles: 'bold', texture: 'stripes', header: 'banner', upper: true }),
  L('form-minimal', 'Minimal form', ['form'], { chrome: 'flat', titles: 'fine', header: 'minimal', align: 'center' }),
  L('wifi-neon', 'Neon Wi-Fi', ['wifi'], { chrome: 'glass', titles: 'neon', texture: 'glow', header: 'banner', align: 'center' }),
  L('wifi-paper', 'Paper Wi-Fi', ['wifi'], { chrome: 'paper', titles: 'ornament', texture: 'paper', header: 'logo', align: 'center' }),
  L('wifi-bold', 'Bold Wi-Fi', ['wifi'], { chrome: 'outline', titles: 'bold', texture: 'stripes', header: 'banner', upper: true }),
  L('wifi-minimal', 'Minimal Wi-Fi', ['wifi'], { chrome: 'flat', titles: 'rule', header: 'minimal' }),
  L('wifi-frame', 'Framed Wi-Fi', ['wifi'], { chrome: 'frame', titles: 'fine', header: 'logo', align: 'center' }),
]

export const layoutOf = (id: string | null | undefined): LayoutSpec => LAYOUTS.find((l) => l.id === id) ?? LAYOUTS[0]

/** CSS custom properties for a page. */
export function pageVars(p: Palette, font: string | null | undefined, radius: number | null | undefined): CSSProperties {
  const f = PAGE_FONTS[font ?? 'sans'] ?? PAGE_FONTS.sans
  const r = typeof radius === 'number' ? Math.max(0, Math.min(32, radius)) : 16
  return {
    '--pg-bg': p.bg,
    '--pg-surface': p.surface,
    '--pg-surface-2': p.surface2,
    '--pg-text': p.text,
    '--pg-muted': p.muted,
    '--pg-subtle': p.subtle,
    '--pg-border': p.border,
    '--pg-accent': p.accent,
    '--pg-on-accent': p.onAccent,
    '--pg-accent-text': p.accentText,
    '--pg-accent-soft': p.accentSoft,
    '--pg-radius': `${r}px`,
    '--pg-radius-sm': `${Math.round(r * 0.6)}px`,
    '--pg-font-h': f.heading,
    '--pg-font-b': f.body,
    colorScheme: p.dark ? 'dark' : 'light',
  } as CSSProperties
}

import type { Branding } from '@/api/types'
import { contrast, isHex, mix, readableOn, rgba, solidForWhiteText, THEME_BG } from './color'
import { DEFAULT_BRANDING } from './defaults'

const STYLE_ID = 'brand-runtime-vars'
const FONT_LINK_ID = 'brand-runtime-fonts'
const FALLBACK_SANS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
const FALLBACK_MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

let brandName = DEFAULT_BRANDING.product_name

/** Current product name (for document titles outside React). */
export function getBrandName(): string {
  return brandName
}

const q = (family: string) => `'${family.replace(/'/g, '')}'`

/** CSS custom properties derived from the branding accents. Exported for the admin live preview. */
export function accentVars(b: Branding): { light: Record<string, string>; dark: Record<string, string> } {
  const lightBase = isHex(b.theme.accent_light) ? b.theme.accent_light : DEFAULT_BRANDING.theme.accent_light
  const darkBase = isHex(b.theme.accent_dark) ? b.theme.accent_dark : DEFAULT_BRANDING.theme.accent_dark
  const lightText = readableOn(lightBase, THEME_BG.light, 4.5)
  const lightSolid = solidForWhiteText(lightBase)
  const darkText = readableOn(darkBase, THEME_BG.dark, 4.5)
  const darkSolid = solidForWhiteText(darkBase)
  return {
    light: {
      '--accent': lightText,
      '--accent-hover': mix(lightText, '#000000', 0.15),
      '--accent-solid': lightSolid,
      '--accent-solid-hover': mix(lightSolid, '#000000', 0.15),
      '--accent-soft': mix(lightBase, '#ffffff', 0.93),
      '--ring': lightBase,
      '--chart-1': lightBase,
    },
    dark: {
      '--accent': darkText,
      '--accent-hover': mix(darkText, '#ffffff', 0.15),
      '--accent-solid': darkSolid,
      '--accent-solid-hover': mix(darkSolid, '#000000', 0.15),
      '--accent-soft': rgba(darkBase, 0.12),
      '--ring': darkBase,
      '--chart-1': darkBase,
    },
  }
}

/** Contrast of an accent against the theme background (the API rejects < 3:1). */
export function accentContrast(hex: string, mode: 'light' | 'dark'): number {
  return isHex(hex) ? contrast(hex, THEME_BG[mode]) : 0
}

function block(sel: string, vars: Record<string, string>) {
  return `${sel}{${Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(';')}}`
}

export function googleFontsHref(families: string[]): string | null {
  const unique = [...new Set(families.filter(Boolean))]
  if (!unique.length) return null
  const parts = unique.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700`)
  return `https://fonts.googleapis.com/css2?${parts.join('&')}&display=swap`
}

function setFavicon(url: string | null) {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  const next = url ?? '/favicon.svg'
  if (link.getAttribute('href') !== next) {
    link.href = next
    link.type = url ? '' : 'image/svg+xml'
  }
}

/** Applies branding to the document: accent + font CSS variables, Google Fonts, favicon, title suffix. */
export function applyBranding(b: Branding) {
  if (typeof document === 'undefined') return
  brandName = b.product_name || DEFAULT_BRANDING.product_name
  const v = accentVars(b)
  const fonts = {
    '--font-body': `${q(b.fonts.body || 'Inter')}, ${FALLBACK_SANS}`,
    '--font-heading': `${q(b.fonts.heading || b.fonts.body || 'Inter')}, ${FALLBACK_SANS}`,
    '--font-code': `${q(b.fonts.mono || 'JetBrains Mono')}, ${FALLBACK_MONO}`,
  }
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = block(':root', { ...fonts, ...v.light }) + block('.dark', v.dark)

  const href = googleFontsHref([b.fonts.body, b.fonts.heading, b.fonts.mono])
  let link = document.getElementById(FONT_LINK_ID) as HTMLLinkElement | null
  if (href) {
    if (!link) {
      link = document.createElement('link')
      link.id = FONT_LINK_ID
      link.rel = 'stylesheet'
      document.head.appendChild(link)
    }
    if (link.href !== href) link.href = href
  }
  setFavicon(b.favicon_url)

  // Re-suffix the current title if it carries the previous product name.
  const parts = document.title.split(' · ')
  if (parts.length > 1) document.title = `${parts.slice(0, -1).join(' · ')} · ${brandName}`
}

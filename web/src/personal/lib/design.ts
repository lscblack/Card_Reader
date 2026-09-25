import type { CSSProperties } from 'react'
import type { CardDesign, CardFont, CardLayout, RenderableCard, Visibility, VisibilityKey } from '../api/types'

export const DEFAULT_DESIGN: CardDesign = {
  primary: '#b91c1c',
  background: '#ffffff',
  text: '#1c1717',
  accent: '#b91c1c',
  background_style: 'solid',
  pattern: null,
  font: 'sans',
  corner_radius: 20,
  show_qr: true,
}

export const FONT_STACKS: Record<CardFont, string> = {
  sans: "'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  serif: "'Iowan Old Style', 'Palatino Linotype', Georgia, 'Times New Roman', serif",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  display: "'Space Grotesk', 'Avenir Next', 'Montserrat', 'Segoe UI', system-ui, sans-serif",
}

export const FONT_LABELS: Record<CardFont, string> = { sans: 'Sans', serif: 'Serif', mono: 'Mono', display: 'Display' }

export const PATTERNS = ['dots', 'grid', 'lines', 'waves'] as const

export const LAYOUT_LABELS: Record<CardLayout, string> = {
  centered: 'Centered',
  left: 'Left aligned',
  split: 'Split',
  hero_photo: 'Hero photo',
  banner: 'Banner',
  compact: 'Compact',
}

/** Default visibility per field (contract §2). */
export const DEFAULT_VISIBILITY: Record<VisibilityKey, Visibility> = {
  full_name: 'public',
  photo: 'public',
  pronouns: 'public',
  headline: 'public',
  job_title: 'public',
  company: 'public',
  department: 'public',
  bio: 'public',
  socials: 'public',
  websites: 'public',
  custom_links: 'public',
  phones: 'contacts',
  emails: 'contacts',
  address: 'hidden',
}

export function visibilityOf(card: Pick<RenderableCard, 'visibility'>, key: VisibilityKey): Visibility {
  return card.visibility?.[key] ?? DEFAULT_VISIBILITY[key]
}

/** Parses #rgb / #rrggbb → [r,g,b] (0-255). */
export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1]
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function luminance(hex: string): number {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio (1–21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

export const onColor = (hex: string) => (luminance(hex) > 0.45 ? '#111111' : '#ffffff')

export function withAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex)
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : hex
}

function patternImage(pattern: string | null, color: string): string | null {
  const c = withAlpha(color, 0.09)
  switch (pattern) {
    case 'dots':
      return `radial-gradient(${c} 1.2px, transparent 1.4px)`
    case 'grid':
      return `linear-gradient(${c} 1px, transparent 1px), linear-gradient(90deg, ${c} 1px, transparent 1px)`
    case 'lines':
      return `repeating-linear-gradient(45deg, ${c} 0 1px, transparent 1px 10px)`
    case 'waves':
      return `radial-gradient(circle at 50% 120%, transparent 18px, ${c} 19px, transparent 20px)`
    default:
      return null
  }
}

/** Card surface style from the design tokens. */
export function surfaceStyle(d: CardDesign): CSSProperties {
  const base: CSSProperties = { color: d.text, fontFamily: FONT_STACKS[d.font] ?? FONT_STACKS.sans, borderRadius: d.corner_radius }
  switch (d.background_style) {
    case 'gradient':
      return { ...base, backgroundColor: d.background, backgroundImage: `linear-gradient(145deg, ${withAlpha(d.primary, 0.9)} 0%, ${d.background} 72%)` }
    case 'glass':
      return {
        ...base,
        backgroundColor: withAlpha(d.background, 0.72),
        backgroundImage: `radial-gradient(120% 90% at 0% 0%, ${withAlpha(d.primary, 0.35)}, transparent 60%), radial-gradient(90% 80% at 100% 100%, ${withAlpha(d.accent, 0.3)}, transparent 60%)`,
        boxShadow: `inset 0 0 0 1px ${withAlpha('#ffffff', 0.35)}`,
        backdropFilter: 'blur(12px)',
      }
    case 'pattern': {
      const img = patternImage(d.pattern ?? 'dots', d.text)
      return { ...base, backgroundColor: d.background, backgroundImage: img ?? undefined, backgroundSize: d.pattern === 'waves' ? '40px 24px' : d.pattern === 'grid' ? '18px 18px' : '14px 14px' }
    }
    default:
      return { ...base, backgroundColor: d.background }
  }
}

/** Small colour helpers for runtime theming (no dependencies). */

export type RGB = [number, number, number]

export function isHex(v: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim())
}

export function hexToRgb(hex: string): RGB {
  let h = hex.trim().replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string): number {
  const x = luminance(a)
  const y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** Mix `a` toward `b` by `t` (0..1). */
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a)
  const y = hexToRgb(b)
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t])
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** Darken (toward black) until white text on it reaches `min` contrast. */
export function solidForWhiteText(hex: string, min = 4.5): string {
  let c = hex
  for (let i = 0; i < 20 && contrast('#ffffff', c) < min; i++) c = mix(c, '#000000', 0.06)
  return c
}

/** Move toward white/black until it reaches `min` contrast on `bg` (for text/icon use). */
export function readableOn(hex: string, bg: string, min = 4.5): string {
  const towards = luminance(bg) < 0.5 ? '#ffffff' : '#000000'
  let c = hex
  for (let i = 0; i < 20 && contrast(c, bg) < min; i++) c = mix(c, towards, 0.06)
  return c
}

export const THEME_BG = { light: '#ffffff', dark: '#141112' } as const

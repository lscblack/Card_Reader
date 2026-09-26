import { contrast, hexToRgb } from './design'

const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`

function sat(r: number, g: number, b: number) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max === 0 ? 0 : (max - min) / max
}

/** Dominant colours of an image (canvas sampling + coarse quantisation). Throws if the image can't be read (CORS). */
export async function dominantColors(url: string, count = 4): Promise<string[]> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.crossOrigin = 'anonymous'
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error('Could not load the image'))
    i.src = url
  })
  const S = 64
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, S, S)
  const data = ctx.getImageData(0, 0, S, S).data // throws on tainted canvas
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]]
    if (a < 128) continue
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    if (lum > 242 || lum < 10) continue
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
    e.n++
    e.r += r
    e.g += g
    e.b += b
    buckets.set(key, e)
  }
  const sorted = [...buckets.values()].sort((a, b) => b.n - a.n).map((e) => [e.r / e.n, e.g / e.n, e.b / e.n] as [number, number, number])
  const out: [number, number, number][] = []
  for (const c of sorted) {
    if (out.every((o) => Math.hypot(o[0] - c[0], o[1] - c[1], o[2] - c[2]) > 64)) out.push(c)
    if (out.length >= count) break
  }
  return out.map((c) => toHex(...c))
}

const darken = (hex: string, f: number) => {
  const rgb = hexToRgb(hex) ?? [0, 0, 0]
  return toHex(rgb[0] * f, rgb[1] * f, rgb[2] * f)
}

/** Turns dominant colours into a card palette (primary = most saturated, secondary = darkest, readable accent). */
export function paletteFrom(colors: string[]): { primary: string; secondary: string; accent: string } | null {
  if (!colors.length) return null
  const rgb = (h: string) => hexToRgb(h) ?? [0, 0, 0]
  const bySat = [...colors].sort((a, b) => sat(...rgb(b)) - sat(...rgb(a)))
  let primary = bySat[0]
  if (contrast(primary, '#ffffff') < 3) primary = darken(primary, 0.7)
  const byDark = [...colors].sort((a, b) => contrast(a, '#ffffff') - contrast(b, '#ffffff'))
  let secondary = byDark[byDark.length - 1]
  if (secondary === primary || contrast(secondary, '#ffffff') < 7) secondary = darken(primary, 0.35)
  const accent = bySat[1] && contrast(bySat[1], '#ffffff') >= 3 ? bySat[1] : primary
  return { primary, secondary, accent }
}

import type { Arrangement, BlockId, CardDesign, CardTemplateV2, SideId } from '../api/types'
import { contrast, FONT_STACKS } from './design'

export const sideSize = (format: 'landscape' | 'portrait'): [number, number] => (format === 'portrait' ? [1000, 1586] : [1750, 1000])

/** Colour token → hex (`image` resolves to the secondary colour for contrast purposes). */
export function resolveColor(token: string, d: CardDesign): string {
  if (token.startsWith('#')) return token
  switch (token) {
    case 'primary':
      return d.primary
    case 'secondary':
    case 'image':
      return d.secondary ?? '#1C1717'
    case 'background':
      return d.background
    case 'text':
      return d.text
    case 'accent':
      return d.accent
    default:
      return d.background
  }
}

/** Text colour on a surface: the design text colour if it reaches 4.5:1, otherwise white or near-black (whichever is higher). */
export function textOn(on: string, text: string): string {
  if (contrast(text, on) >= 4.5) return text
  return contrast('#FFFFFF', on) >= contrast('#111111', on) ? '#FFFFFF' : '#111111'
}

/** Font pairs (ids shared with `/personal/design-presets`); single v1 font keys map to heading = body. */
export const FONT_PAIRS: Record<string, { heading: string; body: string; name: string }> = {
  sans: { heading: FONT_STACKS.sans, body: FONT_STACKS.sans, name: 'Inter' },
  display: { heading: FONT_STACKS.display, body: FONT_STACKS.sans, name: 'Grotesk + Inter' },
  serif: { heading: FONT_STACKS.serif, body: FONT_STACKS.serif, name: 'Classic serif' },
  mono: { heading: FONT_STACKS.mono, body: FONT_STACKS.sans, name: 'Mono + Inter' },
  elegant: { heading: FONT_STACKS.serif, body: FONT_STACKS.sans, name: 'Serif + Inter' },
  geometric: { heading: "'Montserrat', 'Avenir Next', 'Segoe UI', system-ui, sans-serif", body: FONT_STACKS.sans, name: 'Geometric' },
  humanist: { heading: "'Optima', 'Candara', 'Segoe UI', system-ui, sans-serif", body: "'Optima', 'Candara', 'Segoe UI', system-ui, sans-serif", name: 'Humanist' },
  condensed: { heading: "'Arial Narrow', 'Roboto Condensed', 'Helvetica Neue', system-ui, sans-serif", body: FONT_STACKS.sans, name: 'Condensed + Inter' },
}

export function fontsFor(font: string | null | undefined): { heading: string; body: string } {
  return FONT_PAIRS[font ?? 'sans'] ?? FONT_PAIRS.sans
}

/**
 * The card's arrangement validated against the template (unknown zones/blocks dropped, max_blocks and
 * "each block once" enforced); falls back to the template default.
 */
export function resolveArrangement(t: CardTemplateV2, a: Arrangement | null | undefined): Arrangement {
  const src = a && Object.keys(a).length ? a : t.default_arrangement
  const seen = new Set<BlockId>()
  const out: Arrangement = {}
  for (const side of t.sides) {
    const zones = t.canvas[side]?.zones ?? []
    const res: Record<string, BlockId[]> = {}
    for (const z of zones) {
      const list = (src[side]?.[z.id] ?? []).filter((b) => z.accepts.includes(b) && !seen.has(b)).slice(0, z.max_blocks)
      list.forEach((b) => seen.add(b))
      res[z.id] = list
    }
    out[side] = res
  }
  return out
}

/** Maps an arrangement onto another template (same block → first zone that accepts it), like the backend does. */
export function mapArrangement(from: Arrangement | null | undefined, to: CardTemplateV2): Arrangement {
  if (!from) return to.default_arrangement
  const blocks: BlockId[] = []
  for (const side of ['front', 'back'] as SideId[]) for (const list of Object.values(from[side] ?? {})) blocks.push(...list)
  if (!blocks.length) return to.default_arrangement
  const out: Arrangement = {}
  for (const side of to.sides) out[side] = Object.fromEntries((to.canvas[side]?.zones ?? []).map((z) => [z.id, [] as BlockId[]]))
  for (const b of blocks) {
    let placed = false
    for (const side of to.sides) {
      for (const z of to.canvas[side]?.zones ?? []) {
        const list = out[side]![z.id]
        if (!placed && z.accepts.includes(b) && list.length < z.max_blocks) {
          list.push(b)
          placed = true
        }
      }
    }
  }
  return out
}

export const ALL_BLOCKS: BlockId[] = ['photo', 'name', 'logo', 'company', 'tagline', 'contacts', 'website', 'address', 'socials', 'bio', 'qr', 'barcode', 'badge_meta']

export const BLOCK_LABELS: Record<BlockId, string> = {
  photo: 'Photo',
  name: 'Name & title',
  logo: 'Logo',
  company: 'Company',
  tagline: 'Tagline',
  contacts: 'Phone & email',
  website: 'Website',
  address: 'Address',
  socials: 'Social icons',
  bio: 'Bio',
  qr: 'QR code',
  barcode: 'Barcode',
  badge_meta: 'ID details',
}

export function isExpired(validUntil: string | null | undefined): boolean {
  if (!validUntil) return false
  const today = new Date().toISOString().slice(0, 10)
  return validUntil.slice(0, 10) < today
}

import type { MenuBadge, MenuItem } from '../api/types'

/** Currencies offered in the menu / product editors (any ISO code or symbol typed as "Other" still works). */
export const CURRENCIES: { code: string; name: string }[] = [
  { code: 'USD', name: 'US dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British pound' },
  { code: 'RWF', name: 'Rwandan franc' },
  { code: 'KES', name: 'Kenyan shilling' },
  { code: 'UGX', name: 'Ugandan shilling' },
  { code: 'TZS', name: 'Tanzanian shilling' },
  { code: 'BIF', name: 'Burundian franc' },
  { code: 'CDF', name: 'Congolese franc' },
  { code: 'ETB', name: 'Ethiopian birr' },
  { code: 'NGN', name: 'Nigerian naira' },
  { code: 'GHS', name: 'Ghanaian cedi' },
  { code: 'ZAR', name: 'South African rand' },
  { code: 'EGP', name: 'Egyptian pound' },
  { code: 'MAD', name: 'Moroccan dirham' },
  { code: 'XOF', name: 'West African CFA franc' },
  { code: 'XAF', name: 'Central African CFA franc' },
  { code: 'AED', name: 'UAE dirham' },
  { code: 'SAR', name: 'Saudi riyal' },
  { code: 'QAR', name: 'Qatari riyal' },
  { code: 'TRY', name: 'Turkish lira' },
  { code: 'INR', name: 'Indian rupee' },
  { code: 'PKR', name: 'Pakistani rupee' },
  { code: 'CNY', name: 'Chinese yuan' },
  { code: 'JPY', name: 'Japanese yen' },
  { code: 'KRW', name: 'South Korean won' },
  { code: 'SGD', name: 'Singapore dollar' },
  { code: 'THB', name: 'Thai baht' },
  { code: 'IDR', name: 'Indonesian rupiah' },
  { code: 'PHP', name: 'Philippine peso' },
  { code: 'AUD', name: 'Australian dollar' },
  { code: 'NZD', name: 'New Zealand dollar' },
  { code: 'CAD', name: 'Canadian dollar' },
  { code: 'MXN', name: 'Mexican peso' },
  { code: 'BRL', name: 'Brazilian real' },
  { code: 'CHF', name: 'Swiss franc' },
  { code: 'SEK', name: 'Swedish krona' },
  { code: 'NOK', name: 'Norwegian krone' },
  { code: 'DKK', name: 'Danish krone' },
  { code: 'PLN', name: 'Polish złoty' },
]

/** Built-in tags keep their icon and colour on the page; anything else is a custom tag. */
export const PRESET_TAGS: { id: MenuBadge; label: string }[] = [
  { id: 'popular', label: 'Popular' },
  { id: 'new', label: 'New' },
  { id: 'spicy', label: 'Spicy' },
  { id: 'vegetarian', label: 'Vegetarian' },
  { id: 'vegan', label: 'Vegan' },
  { id: 'gluten_free', label: 'Gluten-free' },
  { id: 'sold_out', label: 'Sold out' },
]

/** Ideas shown under the tag input (all stored as custom tags). */
export const TAG_IDEAS = ['Signature', 'Chef’s pick', 'Halal', 'Kids', 'Sharing', 'Seasonal', 'Organic', 'Local', 'Contains nuts', 'Dairy-free', 'Sugar-free', 'Hot', 'Iced', 'Limited', 'Best seller']

const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '')
const presetByLabel = new Map(PRESET_TAGS.flatMap((t) => [[norm(t.label), t.id] as const, [norm(t.id), t.id] as const]))

/** One flat list of tag labels for an item (preset badges first; legacy "vegan"-style tags shown as the preset). */
export function itemTags(it: MenuItem): string[] {
  const labels = [...(it.badges ?? []), ...(it.tags ?? [])].map((t) => PRESET_TAGS.find((p) => p.id === presetByLabel.get(norm(t)))?.label ?? t)
  return labels.filter((l, i) => labels.findIndex((x) => norm(x) === norm(l)) === i)
}

/** Unique by letters only, first spelling wins ("Gluten-free" hides "gluten free"). */
export const uniqueTags = (xs: string[]) => xs.filter((x, i) => xs.findIndex((y) => norm(y) === norm(x)) === i)

/** Splits labels back into preset badges (icons, sold-out styling) and custom tags. */
export function withTags(it: MenuItem, labels: string[]): MenuItem {
  const badges: MenuBadge[] = []
  const tags: string[] = []
  for (const raw of labels) {
    const l = raw.trim().slice(0, 30)
    if (!l) continue
    const preset = presetByLabel.get(norm(l))
    if (preset) {
      if (!badges.includes(preset)) badges.push(preset)
    } else if (!tags.some((t) => norm(t) === norm(l))) tags.push(l)
  }
  return { ...it, badges, tags: tags.slice(0, 10) }
}

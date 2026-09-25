import { AlignLeft, Clock, Contact, Images, LayoutList, MousePointerClick, Package, Share2, UtensilsCrossed, Wrench, type LucideIcon } from 'lucide-react'
import type { HoursRow, SectionDataMap, SectionType } from '../api/types'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export const defaultHours = (): HoursRow[] => DAYS.map((day, i) => ({ day, open: '09:00', close: '17:00', closed: i >= 5 }))

export const SECTION_DEFAULTS: { [K in SectionType]: () => SectionDataMap[K] } = {
  about: () => ({ text: '' }),
  contact: () => ({ phone: '', email: '', website: '', address: '' }),
  hours: () => ({ rows: defaultHours() }),
  social: () => ({ links: [] }),
  services: () => ({ items: [{ title: '', description: '', price: '' }] }),
  products: () => ({ items: [{ title: '', description: '', price: '', image_url: '', url: '' }] }),
  menu: () => ({ categories: [{ name: 'Menu', items: [{ name: '', description: '', price: '', tags: [] }] }] }),
  buttons: () => ({ items: [{ label: 'Visit our website', action: { type: 'website', config: { url: '' } } }] }),
  gallery: () => ({ images: [] }),
  text: () => ({ markdown: '' }),
}


export const SECTION_META: Record<SectionType, { label: string; icon: LucideIcon; hint: string }> = {
  about: { label: 'About', icon: AlignLeft, hint: 'A short introduction.' },
  contact: { label: 'Contact', icon: Contact, hint: 'Phone, email, website, address — also powers the quick buttons.' },
  hours: { label: 'Opening hours', icon: Clock, hint: 'Shows “Open now” automatically.' },
  social: { label: 'Social links', icon: Share2, hint: 'Instagram, LinkedIn, TikTok…' },
  services: { label: 'Services', icon: Wrench, hint: 'What you offer, with optional prices.' },
  products: { label: 'Products', icon: Package, hint: 'Items with image, price and link.' },
  menu: { label: 'Menu', icon: UtensilsCrossed, hint: 'Categories and dishes with prices and tags.' },
  buttons: { label: 'Buttons', icon: MousePointerClick, hint: 'Big call-to-action buttons.' },
  gallery: { label: 'Gallery', icon: Images, hint: 'A grid of photos.' },
  text: { label: 'Text', icon: LayoutList, hint: 'Free text with simple formatting.' },
}

export const SECTION_TYPES = Object.keys(SECTION_META) as SectionType[]

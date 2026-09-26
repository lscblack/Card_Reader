import { AlignLeft, CalendarDays, ClipboardList, Clock, Contact, Images, LayoutList, Link2, MousePointerClick, Package, Share2, TicketPercent, UtensilsCrossed, Wifi, Wrench, type LucideIcon } from 'lucide-react'
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
  menu: () => ({ currency: 'USD', show_images: false, categories: [{ name: 'Menu', items: [{ name: '', description: '', price: '', badges: [] }] }] }),
  buttons: () => ({ items: [{ label: 'Visit our website', action: { type: 'website', config: { url: '' } } }] }),
  gallery: () => ({ images: [] }),
  text: () => ({ markdown: '' }),
  links: () => ({ items: [{ label: 'Visit our website', url: 'https://', icon: 'link', highlight: true }] }),
  offer: () => ({ title: 'Special offer', description: '', code: '', discount_label: '10% OFF', valid_until: null, terms: '' }),
  event: () => ({ title: 'Event', starts_at: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16) + ':00Z', ends_at: null, venue: '', address: '', map_query: '', description: '' }),
  wifi: () => ({ ssid: '', password: '', security: 'WPA', hidden: false }),
  form: () => ({ title: 'Contact us', description: '', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }, { id: 'email', label: 'Email', type: 'email', required: true }, { id: 'message', label: 'Message', type: 'textarea', required: true }], submit_label: 'Send', success_message: 'Thank you — we’ll be in touch.' }),
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
  links: { label: 'Links', icon: Link2, hint: 'Link-in-bio buttons with icons.' },
  offer: { label: 'Offer / coupon', icon: TicketPercent, hint: 'Discount, code to copy, expiry and terms.' },
  event: { label: 'Event', icon: CalendarDays, hint: 'Date, venue, map and “Add to calendar”.' },
  wifi: { label: 'Wi-Fi', icon: Wifi, hint: 'Network, copy password and a join QR code.' },
  form: { label: 'Form', icon: ClipboardList, hint: 'Feedback, contact or booking form — responses land in your dashboard.' },
}

export const SECTION_TYPES = Object.keys(SECTION_META) as SectionType[]

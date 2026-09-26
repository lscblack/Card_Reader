import { CalendarDays, ClipboardList, FileText, Images, Link2, Package, TicketPercent, UtensilsCrossed, Wifi, type LucideIcon } from 'lucide-react'
import type { Business, PageTemplate, ProfileType, PublicBusinessInfo, Section } from '../api/types'
import { fillPlaceholders } from '@/public/page/format'

export type CreatablePageType = Exclude<ProfileType, 'business' | 'employee'>

/** Page types a business can create (Part 6 §1), in gallery order. */
export const PAGE_TYPES: CreatablePageType[] = ['menu', 'product', 'links', 'offer', 'event', 'form', 'gallery', 'wifi', 'custom']

export const PAGE_TYPE_META: Record<CreatablePageType, { label: string; plural: string; icon: LucideIcon; hint: string }> = {
  menu: { label: 'Menu', plural: 'Menus', icon: UtensilsCrossed, hint: 'Digital menu with categories, prices and badges' },
  product: { label: 'Products', plural: 'Products', icon: Package, hint: 'A product, a catalogue or a price list' },
  links: { label: 'Links', plural: 'Links', icon: Link2, hint: 'Link-in-bio page with all your links' },
  offer: { label: 'Offer', plural: 'Offers', icon: TicketPercent, hint: 'Coupon or sale with a code to copy' },
  event: { label: 'Event', plural: 'Events', icon: CalendarDays, hint: 'Invitation with map and “Add to calendar”' },
  form: { label: 'Form', plural: 'Forms', icon: ClipboardList, hint: 'Feedback, contact or booking requests' },
  gallery: { label: 'Gallery', plural: 'Galleries', icon: Images, hint: 'Photo portfolio with a lightbox' },
  wifi: { label: 'Wi-Fi', plural: 'Wi-Fi', icon: Wifi, hint: 'Guest network with copy password and QR' },
  custom: { label: 'Custom', plural: 'Custom', icon: FileText, hint: 'Start from a blank page' },
}

export const TYPE_LABEL: Record<ProfileType, string> = {
  business: 'Business',
  employee: 'Employee',
  ...Object.fromEntries(PAGE_TYPES.map((t) => [t, PAGE_TYPE_META[t].label])),
} as Record<ProfileType, string>

/** Starter sections for a blank page of each type. */
export const BLANK_SECTIONS: Record<CreatablePageType, Section[]> = {
  custom: [{ type: 'text', markdown: 'Tell your visitors what this page is about.' }],
  menu: [{ type: 'menu', currency: 'USD', show_images: false, categories: [{ name: 'Drinks', items: [{ name: 'Espresso', description: '', price: 3, badges: [] }] }] }],
  product: [{ type: 'products', items: [{ title: 'Product name', description: '', price: '', in_stock: true }] }],
  links: [{ type: 'links', items: [{ label: 'Visit our website', url: 'https://example.com', icon: 'link', highlight: true }] }],
  offer: [{ type: 'offer', title: 'Special offer', description: 'Show this page at the counter.', code: 'WELCOME10', discount_label: '10% OFF' }],
  event: [{ type: 'event', title: 'Our event', starts_at: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10) + 'T18:00:00' }],
  form: [{ type: 'form', title: 'Get in touch', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }, { id: 'message', label: 'Message', type: 'textarea', required: true }], submit_label: 'Send', success_message: 'Thank you!' }],
  gallery: [{ type: 'gallery', images: [] }],
  wifi: [{ type: 'wifi', ssid: 'Guest-WiFi', password: '', security: 'WPA' }],
}

/** Public info used when previewing pages/templates inside the dashboard. */
export function previewBusiness(b: Business, categoryLabel?: string | null): PublicBusinessInfo {
  return { name: b.name, slug: b.slug, logo_url: b.logo_url, verified: b.verified, category: categoryLabel ?? b.category }
}

/** A template as it would look for this business (placeholders replaced, logo applied). */
export function templateFor(t: PageTemplate, b: Business) {
  return fillPlaceholders({ theme: t.theme, sections: t.sections }, b)
}

/** Does this page have at least one form section? */
export const hasForm = (sections: Section[]) => sections.some((s) => s.type === 'form')

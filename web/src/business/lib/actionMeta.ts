import {
  AtSign,
  Building2,
  CalendarDays,
  ClipboardList,
  Images,
  TicketPercent,
  Contact,
  FileText,
  Globe,
  Hash,
  Link,
  Mail,
  MapPin,
  MessageCircle,
  Package,
  Phone,
  SquareUser,
  UtensilsCrossed,
  Webhook,
  Wifi,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { Action } from '../api/types'

export const ACTION_ICONS: Record<string, LucideIcon> = {
  website: Globe,
  custom_url: Link,
  business_profile: Building2,
  employee_profile: SquareUser,
  profile: FileText,
  share_contact: Contact,
  whatsapp: MessageCircle,
  phone_call: Phone,
  ussd: Hash,
  email: Mail,
  maps: MapPin,
  social: AtSign,
  digital_menu: UtensilsCrossed,
  links_page: Link,
  offer_page: TicketPercent,
  event_page: CalendarDays,
  feedback_form: ClipboardList,
  gallery_page: Images,
  product_info: Package,
  wifi: Wifi,
  developer_webhook: Webhook,
}

export const actionIcon = (type: string | null | undefined): LucideIcon => (type && ACTION_ICONS[type]) || Zap

/** Plain-language description of what the customer experiences when they tap. */
export const CUSTOMER_SEES: Record<string, string> = {
  website: 'Their phone opens the web page straight away.',
  custom_url: 'Their phone opens the link straight away.',
  business_profile: 'They see your public business page with your contact buttons.',
  employee_profile: 'They see the employee’s digital business card with call, email and save-contact buttons.',
  profile: 'They see the selected page from your Pages.',
  share_contact: 'Their phone offers to save the contact to their address book.',
  whatsapp: 'WhatsApp opens a chat with this number, with your message pre-filled.',
  phone_call: 'A page with a big “Call” button opens (phones don’t allow calling directly from a link).',
  ussd: 'A page opens their dialer with the code ready (Android dials in one tap; iPhone users get a copy button). With several codes, they choose which one.',
  email: 'Their mail app opens a new email with the address (and subject/body) filled in.',
  maps: 'Google Maps opens at the location, ready for directions.',
  social: 'Your social profile opens (in the app, if installed).',
  digital_menu: 'Your menu opens — no app or download needed.',
  product_info: 'The product page opens.',
  links_page: 'Your link page opens with all your links in one place.',
  offer_page: 'Your offer opens with a code they can copy (it shows “Expired” after the end date).',
  event_page: 'The event page opens with the date, a map and “Add to calendar”.',
  feedback_form: 'A short form opens — their answers land in Form responses.',
  gallery_page: 'Your photo gallery opens; they can view each photo full-screen.',
  wifi: 'A page shows the network name with a “Copy password” button and a Wi-Fi QR code.',
  developer_webhook: 'Your system receives a signed card.tapped event; the customer then sees the follow-up action.',
}

const KIND_TEXT: Record<string, string> = {
  redirect: 'Redirect',
  page: 'Hosted page',
  vcard: 'Contact file (vCard)',
  webhook: 'Webhook + follow-up',
}
export const previewKindLabel = (k: string) => KIND_TEXT[k] ?? k

/** One-line detail of an action's config, e.g. the URL or phone number. */
export function actionDetail(a: Action | null | undefined): string | null {
  if (!a) return null
  const c = a.config ?? {}
  const s = (k: string) => (typeof c[k] === 'string' && c[k] ? (c[k] as string) : null)
  switch (a.type) {
    case 'website':
    case 'custom_url':
    case 'social':
      return s('url')
    case 'whatsapp':
    case 'phone_call':
      return s('phone')
    case 'ussd':
      return s('code') ? `${s('code')}${s('more_codes') ? ` + ${s('more_codes')!.split('\n').length} more` : ''}` : null
    case 'email':
      return s('to')
    case 'maps':
      return s('query') ?? (c.lat != null && c.lng != null ? `${c.lat}, ${c.lng}` : null)
    case 'wifi':
      return s('ssid') ? `Network “${s('ssid')}”` : null
    case 'digital_menu':
    case 'product_info':
      return s('url')
    default:
      return null
  }
}

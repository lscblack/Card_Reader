import type { Branding } from '@/api/types'

export const DEFAULT_BRANDING: Branding = {
  product_name: 'nexTap',
  tagline: 'NFC detection → Card ID → Secure delivery',
  logo_url: null,
  logo_dark_url: null,
  auth_logo_url: null,
  auth_logo_dark_url: null,
  favicon_url: null,
  fonts: { heading: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
  theme: { accent_light: '#B91C1C', accent_dark: '#E5484D', default_mode: 'dark' },
  support_email: null,
  company_address: null,
  social_links: [],
  updated_at: null,
}

export const BRANDING_CACHE_KEY = 'nfc.branding'

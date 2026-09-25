/**
 * Product screenshots captured from the app in mock mode (headless Chrome), light + dark, as webp.
 * Re-capture after UI changes; see the web-marketing notes in the final report.
 */
const files = import.meta.glob('./screens/*.webp', { eager: true, import: 'default' }) as Record<string, string>

export type ScreenName = 'dashboard' | 'events' | 'sandbox' | 'analytics' | 'card' | 'profile'

export const screenMeta: Record<ScreenName, { width: number; height: number; alt: string }> = {
  dashboard: { width: 1280, height: 800, alt: 'Developer dashboard overview with applications, devices, events today and delivery success rate' },
  events: { width: 1280, height: 800, alt: 'NFC events list showing card IDs, UID-only badges, delivery status and devices' },
  sandbox: { width: 1280, height: 800, alt: 'Sandbox inspector with incoming requests, a valid signature verdict and passed checks' },
  analytics: { width: 1280, height: 800, alt: 'Business analytics with taps, unique visitors, web and reader taps and a taps-over-time chart' },
  card: { width: 1280, height: 800, alt: 'Business card detail with the card preview, owner, action, tap statistics and the tap link QR code' },
  profile: { width: 780, height: 1560, alt: 'Public business profile on a phone with call, WhatsApp, email, directions and save contact buttons' },
}

export function screenSrc(name: ScreenName, theme: 'light' | 'dark'): string {
  return files[`./screens/${name}-${theme}.webp`]
}

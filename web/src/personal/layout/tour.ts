import type { TourStep } from '@/tours'

export const PERSONAL_TOUR_ID = 'personal.dashboard'

export function personalTourSteps(): TourStep[] {
  const wide = typeof window === 'undefined' || window.matchMedia('(min-width: 1024px)').matches
  const nav = (p: string) => (wide ? `aside a[href="${p}"]` : undefined)
  return [
    { title: 'Your digital card', description: 'Share your details by tapping phones, with a QR code or a link — and collect everyone you meet in one place. Replay this tour from your user menu.' },
    { element: '[data-tour="me-card-preview"]', title: 'Your primary card', description: 'This is what people get when you share. Your phone shares the primary card.', side: 'right' },
    { element: nav('/me/cards'), title: 'Design your cards', description: 'Pick a template, colours, font and photo. Choose which details are public, for contacts only, or hidden.', side: 'right' },
    { element: nav('/me/share'), title: 'Share & sign in on your phone', description: 'Your public link and QR code, plus a QR that signs the nexTap app in as you — no password typing.', side: 'right' },
    { element: nav('/me/contacts'), title: 'Contacts', description: 'Everyone you exchange cards with lands here automatically, plus people who share their details back from your page.', side: 'right' },
    { element: nav('/me/activity'), title: 'Activity', description: 'Views, taps, exchanges and leads over time.', side: 'right' },
    { element: nav('/me/settings'), title: 'Devices & privacy', description: 'See the phones signed in to your account, revoke them, and set privacy defaults.', side: 'right' },
  ]
}

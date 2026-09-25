import type { TourStep } from '@/tours'

export const BUSINESS_TOUR_ID = 'business.dashboard'

/**
 * `business.dashboard` tour: the sidebar sections, then the setup path (profile → employee → card → action →
 * app/programming → device → analytics). Sidebar steps target the desktop sidebar links; hidden targets are skipped.
 */
export function businessTourSteps(base: string): TourStep[] {
  // The sidebar is a drawer below lg: show those steps centred instead of skipping them.
  const wide = typeof window === 'undefined' || window.matchMedia('(min-width: 1024px)').matches
  const nav = (path: string) => (wide ? `aside a[href="${path ? `${base}/${path}` : base}"]` : undefined)
  return [
    {
      title: 'Welcome to your business dashboard',
      description: 'A quick tour of where things live and how to go from zero to your first tap. You can replay it anytime from your user menu.',
    },
    { element: wide ? '[data-tour="biz-switcher"]' : undefined, title: 'Your business', description: 'Your role and plan. If you belong to several businesses, switch between them here.', side: 'right' },
    { element: nav(''), title: 'Overview', description: 'Today’s taps, active cards, online devices and your setup checklist.', side: 'right' },
    { element: '[data-tour="biz-checklist"]', title: 'Setup checklist', description: 'The next steps to go live. Each one links straight to where you do it.', side: 'top' },
    { element: nav('profiles'), title: '1 · Complete your profile', description: 'Your public business page — logo, hours, contact buttons, menu. Customers see it when they tap. Upload your logo in Business Settings.', side: 'right' },
    { element: nav('employees'), title: '2 · Add an employee', description: 'Each employee gets a digital business card. Customers work the same way for loyalty cards.', side: 'right' },
    { element: nav('cards'), title: '3 · Create a card', description: 'Cards are held by people; NFC Tags go on tables, posters and products. Assign a card to the employee you just added.', side: 'right' },
    { element: nav('actions'), title: '4 · Choose what a tap does', description: 'Open a profile, a website, WhatsApp, Wi-Fi, a menu, save a contact or call your own webhook. Change it anytime — no reprogramming.', side: 'right' },
    { element: nav('devices'), title: '5 · Download the app & program the card', description: 'Install NFC Terminal on an Android phone (download it from Devices), open “Program card” and hold the card to the phone.', side: 'right' },
    { element: nav('devices'), title: '6 · Pair a device', description: 'Pair a phone by scanning a QR code. It reads cards at your counter or events and shows who tapped.', side: 'right' },
    { element: nav('events'), title: 'Every tap, live', description: 'NFC Events lists taps from customers’ phones (Web) and from your devices (Reader).', side: 'right' },
    { element: nav('analytics'), title: '7 · View analytics', description: 'Taps over time, top cards and employees, device types and the busiest hours.', side: 'right' },
    { element: nav('team'), title: 'Your team', description: 'Invite colleagues and choose what each role can do. API / Integrations, Billing and Settings live here too.', side: 'right' },
  ]
}

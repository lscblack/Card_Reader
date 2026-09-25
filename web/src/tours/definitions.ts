import type { TourStep } from './engine'

export const developerDashboardTour: TourStep[] = [
  {
    title: 'Welcome to your NFC dashboard',
    description: 'A two-minute tour: from creating an application to watching your first card tap arrive. You can replay it anytime from your user menu.',
  },
  { element: '[data-tour="overview-stats"]', title: 'Your platform at a glance', description: 'Applications, devices, today’s taps and how reliably events reach your endpoint.', side: 'bottom' },
  { element: '[data-tour="new-app"]', title: '1 · Create an application', description: 'An application groups your API keys, phones and the endpoint that receives card events.', side: 'bottom' },
  { element: '[data-tour="nav-api-keys"]', title: '2 · Your API key', description: 'Shown once when the application is created. Keep it secret — the phone app uses it (or a QR code) to register.', side: 'right' },
  { element: '[data-tour="pair-phone"]', title: '3 · Download the app & pair a phone', description: 'Install NFC Terminal on an Android phone and scan the pairing QR code — no typing needed.', side: 'left' },
  { element: '[data-tour="nav-endpoints"]', title: '4 · Point it at your endpoint', description: 'Set the HTTPS URL that should receive signed events, then send a test event.', side: 'right' },
  { element: '[data-tour="nav-sandbox"]', title: '5 · Or start with the sandbox', description: 'A hosted endpoint that shows every request, checks signatures and answers however you like. Its Run mode streams taps live.', side: 'right' },
  { element: '[data-tour="nav-events"]', title: '6 · Watch the events', description: 'Every tap with its delivery status and attempts. Redeliver with one click.', side: 'right' },
  { element: '[data-tour="nav-logs"]', title: '7 · Debug with request logs', description: 'Every API and device request, searchable by the request ID shown in error messages.', side: 'right' },
  { element: '[data-tour="nav-docs"]', title: '8 · Read the docs', description: 'Guides, the payload schema, signature verification samples and every error code.', side: 'right' },
]

export const developerSandboxTour: TourStep[] = [
  { title: 'The sandbox', description: 'A test receiver hosted by us. Point an application at it to see exactly what we send — and control how it answers.' },
  { element: '[data-tour="sandbox-connect"]', title: 'Connect an application', description: 'One click sets the app’s endpoint to this sandbox URL and links its secret so signatures can be verified.', side: 'bottom' },
  { element: '[data-tour="run-console"]', title: 'Run mode', description: 'Press Run, tap a card on your phone and watch the card ID, the exact payload, the response and the verdict appear live.', side: 'top' },
  { element: '[data-tour="sandbox-stream"]', title: 'Request inspector', description: 'Every request with headers, body, signature verdict and a checklist of what passed or failed.', side: 'top' },
  { element: '[data-tour="sandbox-simulator"]', title: 'Response simulator', description: 'Return any status code, add a delay to simulate timeouts, and customise the body to test your retries.', side: 'top' },
]

export const adminConsoleTour: TourStep[] = [
  { title: 'Admin console', description: 'Monitor and change everything on the platform. Every change you make here is audited.' },
  { element: '[data-tour="admin-range"]', title: 'Time range & live mode', description: 'Switch the range and turn on auto-refresh for a live view.', side: 'bottom' },
  { element: '[data-tour="nav-admin-accounts"]', title: 'Accounts', description: 'Search users, inspect their apps, devices and logs, email them or fix their account.', side: 'right' },
  { element: '[data-tour="nav-admin-errors"]', title: 'Error center', description: 'Every error code with its meaning, trend and the requests that hit it.', side: 'right' },
  { element: '[data-tour="nav-admin-branding"]', title: 'Branding', description: 'Logo, fonts and colours — applied everywhere, including emails.', side: 'right' },
  { element: '[data-tour="nav-admin-releases"]', title: 'App releases', description: 'Build and publish the Android app that customers download.', side: 'right' },
  { element: '[data-tour="notifications"]', title: 'Notifications', description: 'Builds finishing, failures and other events land here.', side: 'bottom' },
]

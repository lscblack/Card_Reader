import {
  Activity,
  CreditCard,
  Mail,
  PackageOpen,
  Palette,
  Siren,
  TicketPercent,
  Building2,
  Globe2,
  HeartPulse,
  Send,
  SlidersHorizontal,
  Users,
  AppWindow,
  BookOpen,
  FlaskConical,
  Gauge,
  KeyRound,
  LayoutDashboard,
  ScrollText,
  Settings,
  ShieldCheck,
  Smartphone,
  Webhook,
  Waypoints,
} from 'lucide-react'
import type { ShellNavSection } from './DashboardShell'

/** Developer dashboard navigation (all under /dashboard). */
export const developerNav: ShellNavSection[] = [
  {
    items: [
      { to: '/dashboard', label: 'Overview', icon: LayoutDashboard, tour: 'nav-overview', end: true },
      { to: '/dashboard/applications', label: 'Applications', icon: AppWindow, tour: 'nav-applications' },
      { to: '/dashboard/api-keys', label: 'API Keys', icon: KeyRound, tour: 'nav-api-keys' },
      { to: '/dashboard/devices', label: 'Devices', icon: Smartphone, tour: 'nav-devices' },
      { to: '/dashboard/events', label: 'NFC Events', icon: Activity, tour: 'nav-events' },
    ],
  },
  {
    title: 'Delivery',
    items: [
      { to: '/dashboard/endpoints', label: 'Endpoint Configuration', icon: Waypoints, tour: 'nav-endpoints' },
      { to: '/dashboard/webhooks', label: 'Webhooks', icon: Webhook, tour: 'nav-webhooks' },
      { to: '/dashboard/sandbox', label: 'Sandbox', icon: FlaskConical, tour: 'nav-sandbox' },
      { to: '/dashboard/logs', label: 'Request Logs', icon: ScrollText, tour: 'nav-logs' },
    ],
  },
  {
    title: 'Resources',
    items: [
      { to: '/docs', label: 'API Documentation', icon: BookOpen, tour: 'nav-docs' },
      { to: '/dashboard/usage', label: 'Usage', icon: Gauge, tour: 'nav-usage' },
      { to: '/dashboard/settings', label: 'Account Settings', icon: Settings, tour: 'nav-settings' },
      { to: '/admin', label: 'Admin console', icon: ShieldCheck, tour: 'nav-admin', adminOnly: true },
    ],
  },
]

/** Admin console navigation (all under /admin). */
export const adminNav: ShellNavSection[] = [
  {
    items: [
      { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true, tour: 'nav-admin-overview' },
      { to: '/admin/accounts', label: 'Accounts', icon: Users, tour: 'nav-admin-accounts' },
      { to: '/admin/businesses', label: 'Businesses', icon: Building2 },
      { to: '/admin/devices', label: 'Devices', icon: Smartphone },
      { to: '/admin/emails', label: 'Emails', icon: Mail, tour: 'nav-admin-emails' },
    ],
  },
  {
    title: 'Observability',
    items: [
      { to: '/admin/errors', label: 'Error center', icon: Siren, tour: 'nav-admin-errors' },
      { to: '/admin/logs', label: 'Request logs', icon: ScrollText },
      { to: '/admin/deliveries', label: 'Deliveries', icon: Send },
      { to: '/admin/system', label: 'System health', icon: HeartPulse },
    ],
  },
  {
    title: 'Commerce',
    items: [
      { to: '/admin/plans', label: 'Plans', icon: CreditCard },
      { to: '/admin/promotions', label: 'Promotions', icon: TicketPercent },
    ],
  },
  {
    title: 'Platform',
    items: [
      { to: '/admin/branding', label: 'Branding', icon: Palette, tour: 'nav-admin-branding' },
      { to: '/admin/releases', label: 'App releases', icon: PackageOpen, tour: 'nav-admin-releases' },
      { to: '/admin/settings', label: 'Platform settings', icon: SlidersHorizontal },
      { to: '/admin/origins', label: 'Allowed origins', icon: Globe2 },
    ],
  },
]

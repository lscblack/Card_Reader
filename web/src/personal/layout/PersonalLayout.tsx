import { useMemo } from 'react'
import { Link, Outlet } from 'react-router'
import { Activity, Building2, Contact, CreditCard, LayoutDashboard, LifeBuoy, Nfc, QrCode, Settings } from 'lucide-react'
import { DashboardShell, type ShellNavSection } from '@/layouts/DashboardShell'
import { useTour } from '@/tours'
import { useInvites, usePCards } from '../hooks/queries'
import { PERSONAL_TOUR_ID, personalTourSteps } from './tour'

/** Personal dashboard chrome (`/me/*`). Notifications and the help menu come from the shared shell. */
export function PersonalLayout() {
  const invites = useInvites()
  const cards = usePCards()
  const pending = invites.data?.filter((i) => i.status === 'pending').length ?? 0
  const primary = cards.data?.find((c) => c.is_primary) ?? cards.data?.[0]
  const steps = useMemo(() => personalTourSteps(), [])
  useTour(PERSONAL_TOUR_ID, steps, { ready: !!cards.data })

  const nav: ShellNavSection[] = [
    {
      items: [
        { to: '/me', label: 'Overview', icon: LayoutDashboard, end: true },
        { to: '/me/cards', label: 'My Cards', icon: CreditCard },
        { to: '/me/physical-cards', label: 'Physical cards', icon: Nfc },
        { to: '/me/contacts', label: 'Contacts', icon: Contact },
        { to: '/me/activity', label: 'Activity', icon: Activity },
        { to: '/me/share', label: 'Share', icon: QrCode },
      ],
    },
    {
      title: 'Account',
      items: [
        {
          to: '/me/invites',
          label: 'Business invites',
          icon: Building2,
          badge: pending ? <span className="rounded-full bg-accent-solid px-1.5 text-[11px] font-semibold text-accent-fg">{pending}</span> : undefined,
        },
        { to: '/me/settings', label: 'Settings', icon: Settings },
        { to: '/support', label: 'Help & support', icon: LifeBuoy },
      ],
    },
  ]
  return (
    <DashboardShell
      nav={nav}
      homeTo="/me"
      settingsPath="/me/settings"
      sidebarTop={
        primary ? (
          <Link to={`/me/cards/${primary.id}`} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[12px] font-semibold" style={{ background: primary.design.primary, color: '#fff' }}>
              {primary.fields.full_name.charAt(0).toUpperCase() || '•'}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13.5px] font-semibold">{primary.fields.full_name}</span>
              <span className="block truncate text-[11.5px] text-subtle">Primary card · {primary.label}</span>
            </span>
          </Link>
        ) : undefined
      }
    >
      <Outlet />
    </DashboardShell>
  )
}
